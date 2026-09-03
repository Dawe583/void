import { harden, methodNotAllowed, type Req, type Res } from "./_http";
import { counts } from "./_store";

export default async function handler(req: Req, res: Res) {
  harden(res);
  if (req.method !== "GET") {
    methodNotAllowed(res, "GET");
    return;
  }
  res.status(200).json({
    ...(await counts()),
    protectedActions: 18_422,
    reversibleCoverage: 0.734,
    note: "Product metrics are illustrative. Request counts are real for this deployment.",
  });
}
