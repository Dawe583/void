import { takeToken, validationError, waitlistSchema } from "./_core";
import { clientKey, harden, methodNotAllowed, readJson, type Req, type Res } from "./_http";
import { saveWaitlist } from "./_store";

export default async function handler(req: Req, res: Res) {
  harden(res);

  if (req.method !== "POST") {
    methodNotAllowed(res, "POST");
    return;
  }

  const retryAfter = takeToken(clientKey(req, "waitlist"), 60_000, 5);
  if (retryAfter !== null) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "rate_limited",
      message: `too many requests, try again in ${retryAfter} seconds`,
    });
    return;
  }

  const parsed = waitlistSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    res.status(400).json(validationError(parsed.error));
    return;
  }

  try {
    res.status(201).json(await saveWaitlist({ ...parsed.data, source: "web" }));
  } catch (error) {
    console.error("waitlist request failed", error);
    res.status(500).json({ error: "server_error", message: "the request could not be sealed" });
  }
}
