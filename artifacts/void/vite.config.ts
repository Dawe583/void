import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// PORT only affects the dev and preview servers, BASE_PATH only matters when the
// site is served from a subdirectory. Both default so that a plain `vite build`
// works on any CI, Vercel included, without extra configuration.
const rawPort = process.env.PORT ?? '5173';
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:8080';

const apiProxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // The reversibility registry is one file read by three consumers: this
      // bundle, the Vercel Function and the Express route. Aliasing rather than
      // copying is what stops the site and the API from drifting.
      '@shared': path.resolve(import.meta.dirname, '..', '..', 'api'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    // Keep the framework, the animation runtime and the charting library in
    // their own chunks so a route change never re-downloads them.
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ['motion/react'],
          charts: ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // In production the platform router sends /api to the API service. Locally
    // the two run on separate ports, so proxy the same path here.
    proxy: apiProxy,
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: apiProxy,
  },
});
