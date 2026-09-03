import { harden, type Req, type Res } from "./_http";

export default function handler(_req: Req, res: Res) {
  harden(res);
  res.status(200).json({ status: "ok" });
}
