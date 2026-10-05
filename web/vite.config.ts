import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The console talks to the backend over absolute paths (/message, /api/*,
// /config ...). When VITE_BACKEND_URL is set the client sends requests to that
// absolute origin directly; otherwise this dev proxy forwards same-origin
// requests so CORS is not needed during development.
//
// The mock API layer (src/api/mock) short-circuits these calls when
// VITE_USE_MOCK !== 'false', so the dev server also works with no backend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const BACKEND = env.VITE_BACKEND_URL || 'http://localhost:9899';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: BACKEND, changeOrigin: true },
        '/message': { target: BACKEND, changeOrigin: true },
        '/upload': { target: BACKEND, changeOrigin: true },
        '/uploads': { target: BACKEND, changeOrigin: true },
        '/poll': { target: BACKEND, changeOrigin: true },
        '/stream': { target: BACKEND, changeOrigin: true },
        '/cancel': { target: BACKEND, changeOrigin: true },
        '/config': { target: BACKEND, changeOrigin: true },
        '/auth': { target: BACKEND, changeOrigin: true },
        '/preview': { target: BACKEND, changeOrigin: true },
        '/mcp': { target: BACKEND, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
    },
  };
});
