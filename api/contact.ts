import { contactSchema, takeToken, validationError } from "./_core";
import { clientKey, harden, methodNotAllowed, readJson, type Req, type Res } from "./_http";
import { saveContact } from "./_store";

export default async function handler(req: Req, res: Res) {
  harden(res);

  if (req.method !== "POST") {
    methodNotAllowed(res, "POST");
    return;
  }

  const retryAfter = takeToken(clientKey(req, "contact"), 60_000, 4);
  if (retryAfter !== null) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "rate_limited",
      message: `too many requests, try again in ${retryAfter} seconds`,
    });
    return;
  }

  const parsed = contactSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    res.status(400).json(validationError(parsed.error));
    return;
  }

  try {
    res.status(201).json(await saveContact(parsed.data));
  } catch (error) {
    console.error("contact request failed", error);
    res.status(500).json({ error: "server_error", message: "the message could not be delivered" });
  }
}
