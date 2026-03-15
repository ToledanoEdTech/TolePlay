import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // If VITE_HMR_PORT is set, use it to avoid "port already in use" when multiple dev servers run.
      hmr: process.env.DISABLE_HMR !== 'true'
        ? (process.env.VITE_HMR_PORT ? { port: Number(process.env.VITE_HMR_PORT) } : true)
        : false,
    },
  };
});
