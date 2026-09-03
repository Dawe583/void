/**
 * The small amount of plumbing a Vercel Function needs that Express gave us for
 * free: body parsing, the client address, security headers and JSON replies.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export type Req = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
export type Res = ServerResponse & {
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

export function harden(res: Res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store");
}

export function clientKey(req: Req, route: string): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : (forwarded ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  return `${route}|${ip}`;
}

/** Vercel parses JSON bodies for us, but never assume it: fall back to the stream. */
export async function readJson(req: Req): Promise<unknown> {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    }
    return req.body;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) return null;
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export function methodNotAllowed(res: Res, allowed: string) {
  res.setHeader("Allow", allowed);
  res.status(405).json({ error: "method_not_allowed", message: `use ${allowed}` });
}
