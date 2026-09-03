import { Router, type IRouter } from "express";
import { validationError, waitlistSchema } from "@shared/_core";
import { saveWaitlist } from "@shared/_store";
import { rateLimit } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/waitlist", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const parsed = waitlistSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json(validationError(parsed.error));
    return;
  }

  try {
    res.status(201).json(await saveWaitlist({ ...parsed.data, source: "web" }));
  } catch (error) {
    logger.error({ err: error }, "waitlist request failed");
    res.status(500).json({ error: "server_error", message: "the request could not be sealed" });
  }
});

export default router;
