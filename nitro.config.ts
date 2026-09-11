import { defineConfig } from "nitro";
export default defineConfig({
  modules: ["workflow/nitro"],
  preset: "vercel",
  vercel: { entryFormat: "node" },
  routes: { "/api/**": { handler: "./cloud/server.mjs", format: "node" } },
  publicAssets: [{ dir: "./dist/web", baseURL: "/" }],
});
