import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { mountStaticSite } from "./lib/static-site";

const app: Express = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

/** Baseline hardening for a public API without adding another dependency. */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

app.use(cors());
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

app.use("/api", router);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found", message: "no such endpoint" });
});

mountStaticSite(app);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: error }, "unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "server_error", message: "something went wrong" });
});

export default app;
