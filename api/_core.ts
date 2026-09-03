/**
 * Everything the two HTTP layers share.
 *
 * The site has two deployment shapes and they must not drift: the long lived
 * Express server in artifacts/api-server (Replit, a container, a VM) and the
 * Vercel Functions in this directory. Validation, receipt sealing and the
 * status payload live here so both read from one definition.
 *
 * Deliberately depends on nothing but zod, pg and the Node standard library.
 * Vercel bundles functions from the repository root, where workspace packages
 * are not resolvable, so this file must never import one.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Contracts                                                                  */
/* -------------------------------------------------------------------------- */

export const waitlistSchema = z.object({
  email: z.string().trim().min(1).max(200).email(),
  company: z.string().trim().min(2).max(160),
  agents: z.string().trim().min(1).max(40),
  frameworks: z.array(z.string().trim().max(60)).max(20).default([]),
  note: z.string().trim().max(1200).optional(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().min(1).max(200).email(),
  topic: z.string().trim().min(1).max(80),
  message: z.string().trim().min(10).max(4000),
});

export type WaitlistEntry = z.infer<typeof waitlistSchema>;
export type ContactEntry = z.infer<typeof contactSchema>;

export type SealedReceipt = {
  id: string;
  sequence: number;
  hash: string;
  prevHash: string | null;
  sealedAt: string;
  stored: boolean;
};

export function validationError(error: z.ZodError) {
  return {
    error: "invalid_request",
    message: error.issues[0]?.message ?? "the request could not be validated",
    issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}

/* -------------------------------------------------------------------------- */
/* Receipt sealing                                                            */
/* -------------------------------------------------------------------------- */

/** Deterministic entry hash linked to the previous entry, like the product ledger. */
export function sealHash(payload: Record<string, unknown>, prevHash: string | null): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const digest = createHash("sha256").update(`${prevHash ?? "genesis"}|${canonical}`).digest("hex");
  return `0x${digest.slice(0, 4)}..${digest.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

const SERVICES = [
  { name: "Interceptor, EU (Frankfurt)", uptime: "99.99%", base: 18 },
  { name: "Interceptor, US (Virginia)", uptime: "99.98%", base: 24 },
  { name: "Policy engine", uptime: "100%", base: 9 },
  { name: "Saga ledger, write path", uptime: "99.99%", base: 12 },
  { name: "Ledger export API", uptime: "99.95%", base: 41 },
  { name: "Control plane and dashboard", uptime: "99.97%", base: 63 },
];

export function statusPayload(uptimeSeconds: number) {
  return {
    state: "operational",
    checkedAt: new Date().toISOString(),
    uptimeSeconds,
    services: SERVICES.map((service, index) => ({
      name: service.name,
      state: "operational",
      uptime: service.uptime,
      latencyMs: service.base + (((Date.now() / 1000 + index * 7) | 0) % 11),
    })),
    note: "VOID is a product concept. Uptime and latency figures are illustrative.",
  };
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed window limiter. In memory on purpose: it blunts casual abuse, and on a
 * serverless runtime it degrades to per instance, which is still worth having.
 */
export function takeToken(key: string, windowMs: number, max: number): number | null {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [id, entry] of buckets) if (entry.resetAt <= now) buckets.delete(id);
    }
    return null;
  }

  bucket.count += 1;
  if (bucket.count > max) return Math.ceil((bucket.resetAt - now) / 1000);
  return null;
}
