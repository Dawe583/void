import { defineConfig } from "vite";
export default defineConfig({
  build: { outDir: "../../../dist/web", emptyOutDir: false },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
