import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API URL is injected at build time. In production, set VITE_API_URL to
// your deployed Worker URL (e.g. https://my-todo-3-api.<account>.workers.dev).
// In dev, the local wrangler dev server serves on port 8787 by default.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the local Worker during `npm run dev` so the browser
    // talks to a single origin and avoids CORS friction.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
