#!/usr/bin/env node
import { createServer } from "node:http";

const streams = new Set();

function result(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolList() {
  return {
    tools: [
      {
        name: "echo",
        description: "Returns the text argument unchanged.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      {
        name: "orders_delete",
        description: "Destructive test tool that deletes matching orders.",
        inputSchema: {
          type: "object",
          properties: { where: { type: "string" } },
          required: ["where"],
        },
      },
    ],
  };
}

function callTool(id, params) {
  if (!isObject(params) || typeof params.name !== "string") {
    return failure(id, -32602, "tools/call params.name is required");
  }
  const args = isObject(params.arguments) ? params.arguments : {};
  if (params.name === "echo") {
    const text = typeof args.text === "string" ? args.text : "";
    return result(id, { content: [{ type: "text", text }] });
  }
  if (params.name === "orders_delete") {
    const where = typeof args.where === "string" ? args.where : "";
    const count = where.includes("status") ? 2 : 1;
    return result(id, { content: [{ type: "text", text: `deleted ${count}` }], count });
  }
  return failure(id, -32601, `unknown tool ${params.name}`);
}

function handle(message) {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return failure(null, -32600, "invalid JSON-RPC message");
  }
  if (!("id" in message)) return null;
  if (message.method === "initialize") {
    return result(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "void-e2e-http-fixture", version: "1.0.0" },
    });
  }
  if (message.method === "tools/list") return result(message.id, toolList());
  if (message.method === "tools/call") return callTool(message.id, message.params);
  return failure(message.id, -32601, `method not found: ${message.method}`);
}

const server = createServer((req, res) => {
  res.setHeader("mcp-session-id", "void-e2e-http");
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": ready\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify(failure(null, -32601, "method not allowed")));
    return;
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    try {
      const reply = handle(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "void-e2e-http" });
      res.end(reply === null ? "" : JSON.stringify(reply));
    } catch (error) {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "void-e2e-http" });
      res.end(JSON.stringify(failure(null, -32700, error instanceof Error ? error.message : String(error))));
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("HTTP fixture did not bind");
  process.stdout.write(`http://127.0.0.1:${address.port}\n`);
});

function close() {
  for (const stream of streams) stream.end();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", close);
process.on("SIGINT", close);
