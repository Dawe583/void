import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response } from "express";
import { logger } from "./logger";

/**
 * Serves the built marketing site from the same process as the API.
 *
 * The hosting platform can route /api and / to separate services, in which case
 * this never finds a build and stays out of the way. Pointing a bare domain at
 * one Node process is the simpler deployment, and this makes that work,
 * including deep links like /docs/policy which need the SPA fallback.
 */
export function mountStaticSite(app: Express) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["STATIC_DIR"],
    path.resolve(here, "../../void/dist/public"),
    path.resolve(here, "../../../void/dist/public"),
    path.resolve(process.cwd(), "artifacts/void/dist/public"),
  ].filter(Boolean) as string[];

  const publicDir = candidates.find((dir) => existsSync(path.join(dir, "index.html")));

  if (!publicDir) {
    logger.info("no static build found, running as an API only service");
    return;
  }

  logger.info({ publicDir }, "serving the marketing site");

  // Fingerprinted assets are immutable, everything else must revalidate.
  app.use(
    express.static(publicDir, {
      index: false,
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        }
      },
    }),
  );

  // Client routed pages fall back to the shell.
  app.get(/.*/, (req: Request, res: Response, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.sendFile(path.join(publicDir, "index.html"));
  });
}
