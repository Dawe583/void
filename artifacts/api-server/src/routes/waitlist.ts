import { Router, type IRouter } from "express";
import { z } from "zod";
import { rateLimit } from "../lib/rate-limit";
import { saveWaitlist } from "../lib/storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const waitlistSchema = z.object({
  email: z.string().trim().min(1).max(200).email(),
  company: z.string().trim().min(2).max(160),
  agents: z.string().trim().min(1).max(40),
  frameworks: z.array(z.string().trim().max(60)).max(20).default([]),
  note: z.string().trim().max(1200).optional(),
});

router.post("/waitlist", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const parsed = waitlistSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: parsed.error.issues[0]?.message ?? "the request could not be validated",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  try {
    const receipt = await saveWaitlist({ ...parsed.data, source: "web" });
    res.status(201).json(receipt);
  } catch (error) {
    logger.error({ err: error }, "waitlist request failed");
    res.status(500).json({ error: "server_error", message: "the request could not be sealed" });
  }
});

export default router;
