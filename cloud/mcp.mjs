import { randomUUID } from "node:crypto";
export function validateEndpoint(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("Use an HTTPS tool endpoint without embedded credentials.");
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(":")
  )
    throw new Error("Use a public HTTPS tool endpoint.");
  return url.href;
}
export async function rpc(config, method, params, sessionId) {
  const id = randomUUID();
  const response = await fetch(config.url, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(sessionId
        ? { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-03-26" }
        : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(method.startsWith("notifications/") ? {} : { id }),
      method,
      params,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw new Error(`MCP endpoint returned HTTP ${response.status}.`);
  if (method.startsWith("notifications/")) return {};
  let bytes = 0,
    text = "",
    message;
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const streaming = response.headers
    .get("content-type")
    ?.includes("text/event-stream");
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 1048576) throw new Error("MCP response exceeds 1 MB.");
      text += decoder
        .decode(chunk.value, { stream: true })
        .replace(/\r\n/g, "\n");
      if (streaming) {
        let boundary;
        while ((boundary = text.indexOf("\n\n")) >= 0) {
          const frame = text.slice(0, boundary);
          text = text.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) {
            const parsed = JSON.parse(data);
            if (parsed.id === id) {
              message = parsed;
              break;
            }
          }
        }
        if (message) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!streaming) message = JSON.parse(text + decoder.decode());
  if (!message || message.id !== id || message.error)
    throw new Error("MCP request failed. Inspect the tool server.");
  return {
    result: message.result,
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
  };
}
export async function catalog(config) {
  const init = await rpc(config, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "void-cloud", version: "0.1.0" },
  });
  await rpc(config, "notifications/initialized", {}, init.sessionId);
  const listed = await rpc(config, "tools/list", {}, init.sessionId);
  if (!Array.isArray(listed.result?.tools) || listed.result.tools.length > 100)
    throw new Error("MCP tool catalog is invalid or too large.");
  return { tools: listed.result.tools, sessionId: listed.sessionId };
}
