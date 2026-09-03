import { Router, type IRouter } from "express";
import { contactSchema, validationError } from "@shared/_core";
import { saveContact } from "@shared/_store";
import { rateLimit } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/contact", rateLimit({ windowMs: 60_000, max: 4 }), async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json(validationError(parsed.error));
    return;
  }

  try {
    res.status(201).json(await saveContact(parsed.data));
  } catch (error) {
    logger.error({ err: error }, "contact request failed");
    res.status(500).json({ error: "server_error", message: "the message could not be delivered" });
  }
});

export default router;
