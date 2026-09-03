import { Router, type IRouter } from "express";
import { statusPayload } from "@shared/_core";
import { counts } from "@shared/_store";

const router: IRouter = Router();

const startedAt = Date.now();

router.get("/status", (_req, res) => {
  res.json(statusPayload(Math.floor((Date.now() - startedAt) / 1000)));
});

router.get("/stats", async (_req, res) => {
  res.json({
    ...(await counts()),
    protectedActions: 18_422,
    reversibleCoverage: 0.734,
    note: "Product metrics are illustrative. Request counts are real for this deployment.",
  });
});

export default router;
