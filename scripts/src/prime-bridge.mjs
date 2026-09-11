// Outbound-only worker. No listening port and no public copy of local credentials.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
export function primeArguments(job, sessionDir, cwd) {
  if (
    !/^[a-f0-9-]{36}$/.test(job.id) ||
    !Number.isSafeInteger(job.generation) ||
    job.generation < 1 ||
    typeof job.prompt !== "string" ||
    !job.prompt.trim() ||
    job.prompt.length > 32000 ||
    !/^[a-zA-Z0-9][\w-]{0,99}$/.test(job.provider) ||
    !/^[a-zA-Z0-9][^\s]{0,199}$/.test(job.model)
  )
    throw new Error("Invalid prime job.");
  return [
    "--mode",
    "json",
    "-p",
    "--offline",
    "--cwd",
    cwd,
    "--session-dir",
    sessionDir,
    ...(job.continuation ? ["--continue"] : []),
    "--provider",
    job.provider,
    "--model",
    job.model,
    "--append-system-prompt",
    "This run was requested by the user through VOID. Never expose credentials. Local tools are not automatically reversible by VOID. Report actual results and do not claim captured Undo for local or external changes.",
    "--",
    job.prompt,
  ];
}
export function primeEvent(value) {
  if (
    value.type === "tool_execution_start" &&
    typeof value.toolName === "string"
  )
    return {
      type: "tool",
      name: value.toolName.replace(/[^\w .:/@+-]/g, "_").slice(0, 160),
    };
  if (value.type === "message_end" && value.message?.role === "assistant") {
    const m = value.message;
    return {
      type: "answer",
      text: (m.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
      failed: m.stopReason === "error" || m.stopReason === "aborted",
      error: m.errorMessage,
    };
  }
}
export async function runBridge(config) {
  if (new URL(config.origin).protocol !== "https:" && !config.test)
    throw new Error("HTTPS required.");
  const settings = JSON.parse(
    await readFile(join(homedir(), ".prime/agent/settings.json"), "utf8"),
  );
  const tools = [
    "prime-agent: native Python kernel and shell and installed skills",
    ...Object.keys(settings.mcpServers ?? {}).map((name) => `MCP: ${name}`),
  ];
  const secretValues = [config.token, config.workerToken];
  for (const path of [
    ".prime/agent/auth.json",
    ".local/share/opencode/auth.json",
    ".prime/agent/models.json",
    ".prime/config.json",
  ]) {
    try {
      const data = JSON.parse(await readFile(join(homedir(), path), "utf8"));
      const collect = (v) => {
        if (!v || typeof v !== "object") return;
        for (const [k, x] of Object.entries(v)) {
          if (
            typeof x === "string" &&
            /key|token|secret/i.test(k) &&
            x.length >= 16
          )
            secretValues.push(x);
          else collect(x);
        }
      };
      collect(data);
    } catch {}
  }
  const redact = (text) =>
    secretValues
      .reduce(
        (s, key) => (key ? s.replaceAll(key, "[redacted]") : s),
        String(text),
      )
      .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/g, "[redacted database URL]");
  const request = async (path, body) => {
    const response = await fetch(new URL(path, config.origin), {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${config.token}`,
        "x-void-worker-token": config.workerToken,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
    return response.json();
  };
  await mkdir(config.sessions, { recursive: true, mode: 0o700 });
  while (true) {
    try {
      const { job } = await request("/api/prime/claim", { tools });
      if (!job) {
        await delay(10000);
        continue;
      }
      const sessionDir = join(config.sessions, job.id);
      const args = primeArguments(job, sessionDir, config.cwd);
      if (config.verifyOnly)
        args.unshift(
          "--no-tools",
          "--no-extensions",
          "--no-skills",
          "--no-context-files",
        );
      await mkdir(sessionDir, { recursive: true, mode: 0o700 });
      // Persist before spawning. A worker crash must never cause automatic replay.
      await writeFile(
        join(sessionDir, `claim-${job.generation}.json`),
        JSON.stringify({ claim: job.claim }),
        { flag: "wx", mode: 0o600 },
      );
      const child = spawn(config.executable, args, {
        cwd: config.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let buffer = "",
        answer = "",
        failed = false,
        errors = "",
        send = Promise.resolve(),
        stopping = false;
      const post = (body) =>
        request(`/api/prime/jobs/${job.id}`, {
          claim: job.claim,
          generation: job.generation,
          ...body,
        });
      const stop = () => {
        if (stopping) return;
        stopping = true;
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {}
        setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, 5000).unref();
      };
      const heartbeat = setInterval(() => {
        send = send
          .then(() => post({ type: "heartbeat" }))
          .then((r) => {
            if (r.cancel) stop();
          })
          .catch(() => {
            failed = true;
            stop();
          });
      }, 10000);
      const timeout = setTimeout(
        () => {
          failed = true;
          stop();
        },
        30 * 60 * 1000,
      );
      const terminate = () => stop();
      process.once("SIGTERM", terminate);
      process.once("SIGINT", terminate);
      child.stdout.on("data", (data) => {
        buffer += data;
        if (buffer.length > 2 * 1024 * 1024) {
          failed = true;
          stop();
          return;
        }
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const item = primeEvent(JSON.parse(line));
            if (item?.type === "answer") {
              answer = redact(item.text || item.error || "");
              failed ||= item.failed;
            }
            if (item?.type === "tool")
              send = send
                .then(() => post(item))
                .catch(() => {
                  failed = true;
                  stop();
                });
          } catch {}
        }
      });
      child.stderr.on("data", (data) => {
        errors = redact(errors + data).slice(-4000);
      });
      const code = await new Promise((resolve) => {
        child.once("error", () => resolve(1));
        child.once("close", resolve);
      });
      clearInterval(heartbeat);
      clearTimeout(timeout);
      process.removeListener("SIGTERM", terminate);
      process.removeListener("SIGINT", terminate);
      await send;
      await post({
        type: "complete",
        text: (answer || errors || "prime-agent returned no answer.").slice(
          0,
          16000,
        ),
        failed: failed || code !== 0 || !answer,
      });
      if (stopping) return;
    } catch (error) {
      console.error(redact(error.message));
      await delay(10000);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const config = JSON.parse(
    await readFile(process.argv[2] ?? ".env.prime-bridge", "utf8"),
  );
  await runBridge(config);
}
