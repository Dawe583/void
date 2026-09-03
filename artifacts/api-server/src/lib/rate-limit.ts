import type { NextFunction, Request, Response } from "express";
import { takeToken } from "@shared/_core";

/**
 * Express adapter over the shared fixed window limiter, so the server and the
 * Vercel Functions enforce the same budget from the same implementation.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const retryAfter = takeToken(`${req.path}|${req.ip ?? "unknown"}`, windowMs, max);

    if (retryAfter === null) {
      next();
      return;
    }

    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "rate_limited",
      message: `too many requests, try again in ${retryAfter} seconds`,
    });
  };
}
