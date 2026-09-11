// Loopback-only UI QA against the real cloud store. Never used in deployment.
import express from "express";
import { readFile } from "node:fs/promises";
Object.assign(
  process.env,
  JSON.parse(await readFile(".env.cloud-secrets", "utf8")),
);
process.env.VOID_LOCAL_TEST = "1";
const { default: api } = await import("../../cloud/server.mjs");
const app = express();
app.use((req, res, next) => {
  if (
    req.headers.host !== "127.0.0.1:8084" ||
    (req.headers.origin && req.headers.origin !== "http://127.0.0.1:8084")
  )
    return res.sendStatus(403);
  if (!["GET", "HEAD"].includes(req.method)) return res.sendStatus(405);
  req.headers.authorization = `Bearer ${process.env.VOID_CONTROL_TOKEN}`;
  next();
});
app.use("/api", (req, res, next) => {
  req.url = "/api" + req.url;
  return api(req, res, next);
});
app.use(express.static("apps/control-plane/web"));
app.listen(8084, "127.0.0.1", () =>
  console.log("Cloud UI QA at http://127.0.0.1:8084"),
);
