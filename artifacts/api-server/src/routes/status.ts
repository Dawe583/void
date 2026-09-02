import { Router, type IRouter } from "express";
import { counts } from "../lib/storage";

const router: IRouter = Router();

const SERVICES = [
  { name: "Interceptor, EU (Frankfurt)", uptime: "99.99%", base: 18 },
  { name: "Interceptor, US (Virginia)", uptime: "99.98%", base: 24 },
  { name: "Policy engine", uptime: "100%", base: 9 },
  { name: "Saga ledger, write path", uptime: "99.99%", base: 12 },
  { name: "Ledger export API", uptime: "99.95%", base: 41 },
  { name: "Control plane and dashboard", uptime: "99.97%", base: 63 },
];

const startedAt = Date.now();

/**
 * Live service view for the status page. Latency figures are illustrative for a
 * product concept, but the endpoint itself is real and reflects this process.
 */
router.get("/status", (_req, res) => {
  const checkedAt = new Date().toISOString();
  const services = SERVICES.map((service, index) => ({
    name: service.name,
    state: "operational",
    uptime: service.uptime,
    latencyMs: service.base + ((Date.now() / 1000 + index * 7) % 11 | 0),
  }));

  res.json({
    state: "operational",
    checkedAt,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    services,
    note: "VOID is a product concept. Uptime and latency figures are illustrative.",
  });
});

router.get("/stats", async (_req, res) => {
  const totals = await counts();
  res.json({
    ...totals,
    protectedActions: 18_422,
    reversibleCoverage: 0.734,
    note: "Product metrics are illustrative. Request counts are real for this deployment.",
  });
});

export default router;
