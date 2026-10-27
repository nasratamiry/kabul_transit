import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Django dev server behind the /api proxy. scripts/run_all_checks overrides it so the checks run
// on their own ports, next to a developer's servers on :8000 / :5173.
const apiTarget = process.env.KC_API_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: app changes don't invalidate the cached libraries.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|cookie|set-cookie-parser|scheduler)[\\/]/,
            },
            { name: 'date', test: /node_modules[\\/](jalali-moment|moment)[\\/]/ },
            // Only the dashboard chart needs these; fetched lazily with it.
            {
              name: 'charts',
              test: /node_modules[\\/](recharts|recharts-scale|victory-vendor|d3-[a-z-]+|internmap|react-smooth|lodash|decimal\.js-light|eventemitter3|fast-equals|tiny-invariant)[\\/]/,
            },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Same-origin through the proxy, so Vite's own CORS layer is not needed — and it would
    // answer every OPTIONS request itself (204, empty), hiding DRF's field/choice metadata.
    cors: false,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/media': { target: apiTarget, changeOrigin: true },
    },
  },
});
