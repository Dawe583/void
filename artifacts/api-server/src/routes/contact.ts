import { Router, type IRouter } from "express";
import { z } from "zod";
import { rateLimit } from "../lib/rate-limit";
import { saveContact } from "../lib/storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().min(1).max(200).email(),
  topic: z.string().trim().min(1).max(80),
  message: z.string().trim().min(10).max(4000),
});

router.post("/contact", rateLimit({ windowMs: 60_000, max: 4 }), async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: parsed.error.issues[0]?.message ?? "the request could not be validated",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  try {
    const result = await saveContact(parsed.data);
    res.status(201).json(result);
  } catch (error) {
    logger.error({ err: error }, "contact request failed");
    res.status(500).json({ error: "server_error", message: "the message could not be delivered" });
  }
});

export default router;
