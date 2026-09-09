import type { UpstreamProcess } from "./stdio.ts";

const HTTP_DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;

type TimerHandle = unknown;

type HttpClock = {
  readonly setTimeout: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimeout: (handle: TimerHandle) => void;
};

type HttpEvents = {
  readonly onMessage: (line: string) => void;
  readonly onClose: (code: number | null, signal: NodeJS.Signals | null) => void;
  readonly onError: (err: Error) => void;
};

type Fetch = typeof fetch;

export type HttpTransportOptions = {
  readonly events?: HttpEvents;
  readonly maxBufferSize?: number;
  readonly reconnectDelayMs?: number;
  readonly clock?: HttpClock;
  readonly fetch?: Fetch;
  readonly headers?: Readonly<Record<string, string>>;
};

export class HttpUpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpUpstreamError";
    this.status = status;
  }
}

const defaultClock: HttpClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const noopEvents: HttpEvents = {
  onMessage() {},
  onClose() {},
  onError() {},
};

function hasUnref(handle: TimerHandle): handle is { unref: () => void } {
  return typeof handle === "object" && handle !== null && "unref" in handle;
}

export function upstreamHttp(url: URL, options: HttpTransportOptions = {}): UpstreamProcess {
  const clock = options.clock ?? defaultClock;
  const fetchFn = options.fetch ?? fetch;
  const events = options.events ?? noopEvents;
  const maxBufferSize = options.maxBufferSize ?? HTTP_DEFAULT_MAX_BUFFER_SIZE;
  const reconnectDelayMs = options.reconnectDelayMs ?? 250;
  const baseHeaders = options.headers ?? {};
  const postControllers = new Set<AbortController>();
  let sessionId: string | null = null;
  let closed = false;
  let streamController: AbortController | null = null;
  let reconnectTimer: TimerHandle | null = null;

  const headersFor = (accept: string): Headers => {
    const headers = new Headers(baseHeaders);
    headers.set("accept", accept);
    if (sessionId !== null) {
      headers.set("mcp-session-id", sessionId);
    }
    return headers;
  };

  const rememberSession = (headers: Headers): void => {
    const next = headers.get("mcp-session-id");
    if (next !== null && next !== "") {
      sessionId = next;
    }
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = clock.setTimeout(() => {
      reconnectTimer = null;
      openStream();
    }, reconnectDelayMs);
    if (hasUnref(reconnectTimer)) {
      reconnectTimer.unref();
    }
  };

  const report = (error: unknown): void => {
    if (!closed) {
      events.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const handleResponse = async (response: Response): Promise<void> => {
    rememberSession(response.headers);
    if (!response.ok) {
      throw new HttpUpstreamError(response.status, `HTTP upstream returned ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("text/event-stream")) {
      await readSse(response, maxBufferSize, events.onMessage);
      return;
    }

    const text = await readText(response, maxBufferSize);
    if (text.trim() !== "") {
      events.onMessage(text);
    }
  };

  const openStream = (): void => {
    if (closed || streamController !== null) {
      return;
    }

    const controller = new AbortController();
    streamController = controller;
    void (async () => {
      try {
        const response = await fetchFn(url, {
          method: "GET",
          headers: headersFor("text/event-stream"),
          signal: controller.signal,
        });
        await handleResponse(response);
      } catch (error) {
        if (!closed && !isAbortError(error)) {
          report(error);
        }
      } finally {
        if (streamController === controller) {
          streamController = null;
        }
        scheduleReconnect();
      }
    })();
  };

  openStream();

  return {
    send(line: string): void {
      if (closed) {
        throw new Error("HTTP upstream is closed");
      }

      const controller = new AbortController();
      postControllers.add(controller);
      void (async () => {
        try {
          const headers = headersFor("application/json, text/event-stream");
          headers.set("content-type", "application/json");
          const response = await fetchFn(url, {
            method: "POST",
            headers,
            body: line,
            signal: controller.signal,
          });
          await handleResponse(response);
        } catch (error) {
          if (!closed && !isAbortError(error)) {
            report(error);
          }
        } finally {
          postControllers.delete(controller);
        }
      })();
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      if (reconnectTimer !== null) {
        clock.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      streamController?.abort();
      streamController = null;
      for (const controller of postControllers) {
        controller.abort();
      }
      postControllers.clear();
      events.onClose(null, null);
    },
    onStderr(): () => void {
      return () => {};
    },
  };
}

async function readText(response: Response, maxBufferSize: number): Promise<string> {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  for (;;) {
    const next = await reader.read();
    if (next.done === true) {
      break;
    }
    size += next.value.byteLength;
    if (size > maxBufferSize) {
      await reader.cancel();
      throw new HttpUpstreamError(response.status, `HTTP upstream response exceeded ${maxBufferSize} bytes`);
    }
    text += decoder.decode(next.value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function readSse(response: Response, maxBufferSize: number, onMessage: (line: string) => void): Promise<void> {
  if (response.body === null) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let eventSize = 0;

  const assertSize = (size: number): void => {
    if (size > maxBufferSize) {
      throw new HttpUpstreamError(response.status, `HTTP upstream response exceeded ${maxBufferSize} bytes`);
    }
  };

  const acceptLine = (line: string): void => {
    assertSize(Buffer.byteLength(line, "utf8"));
    if (line === "") {
      if (dataLines.length > 0) {
        onMessage(dataLines.join("\n"));
        dataLines = [];
        eventSize = 0;
      }
      return;
    }

    if (line.startsWith("data:")) {
      const value = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      // Empty data lines still occupy array slots and output separators.
      eventSize += Buffer.byteLength(value, "utf8") + 1;
      assertSize(eventSize);
      dataLines.push(value);
    }
  };

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done === true) {
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          break;
        }
        let line = buffer.slice(0, newline);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        buffer = buffer.slice(newline + 1);
        acceptLine(line);
      }
      assertSize(Buffer.byteLength(buffer, "utf8"));
    }

    buffer += decoder.decode();
    if (buffer !== "") {
      acceptLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
    }
    acceptLine("");
  } catch (error) {
    // A hostile source must not keep supplying bytes after the parser refuses it.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
