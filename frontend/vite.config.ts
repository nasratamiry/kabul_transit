import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
            { name: 'date', test: /node_modules[\\/](jalali-moment|moment)[\\/]/ },
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
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
});
