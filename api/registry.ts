import { handleRegistry, paramsFromUrl } from "./_registry_http";
import { harden, methodNotAllowed, type Req, type Res } from "./_http";

export default function handler(req: Req, res: Res) {
  harden(res);
  if (req.method !== "GET") {
    methodNotAllowed(res, "GET");
    return;
  }

  const params = req.query && Object.keys(req.query).length > 0 ? req.query : paramsFromUrl(req.url);
  const result = handleRegistry(params);

  if (result.status === 200) {
    // Static content keyed by the registry version, so it is safe to cache hard
    // at the edge. harden() defaults to no-store for the form endpoints.
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  }
  res.status(result.status).json(result.body);
}
