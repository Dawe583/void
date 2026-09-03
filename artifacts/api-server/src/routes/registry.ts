import { Router, type IRouter } from "express";
import { handleRegistry } from "@shared/_registry_http";

const router: IRouter = Router();

router.get("/registry", (req, res) => {
  const result = handleRegistry(req.query as Record<string, string | string[] | undefined>);
  if (result.status === 200) {
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  }
  res.status(result.status).json(result.body);
});

export default router;
