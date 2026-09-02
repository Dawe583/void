import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * A small fixed window limiter for the public form endpoints. It is in memory
 * on purpose: the marketing API runs as a single process, and the goal is to
 * blunt casual abuse, not to be a distributed quota system.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}|${req.ip ?? "unknown"}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "rate_limited",
        message: `too many requests, try again in ${retryAfter} seconds`,
      });
      return;
    }

    next();
  };
}

/** Drops expired buckets so the map cannot grow without bound. */
export function startRateLimitSweeper(intervalMs = 60_000) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
