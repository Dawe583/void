import { statusPayload } from "./_core";
import { harden, methodNotAllowed, type Req, type Res } from "./_http";

const bootedAt = Date.now();

export default function handler(req: Req, res: Res) {
  harden(res);
  if (req.method !== "GET") {
    methodNotAllowed(res, "GET");
    return;
  }
  res.status(200).json(statusPayload(Math.floor((Date.now() - bootedAt) / 1000)));
}
