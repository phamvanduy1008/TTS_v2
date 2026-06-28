import path from 'path';

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.VITE_DESKTOP === '1' ? './' : '/',
  plugins: [
    tailwindcss(),
    vue(),
    {
      name: 'static-asset-headers',
      configureServer(server) {
        server.middlewares.use('/onnx-runtime', (req, res, next) => {
          if (req.url.includes('?import')) {
            req.url = req.url.replace('?import', '');
          }

          if (req.url.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Access-Control-Allow-Origin', '*');
          }

          next();
        });

        server.middlewares.use('/tts-model', (_req, res, next) => {
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
  },
  assetsInclude: ['**/*.wasm'],
  logLevel: 'info',
});
