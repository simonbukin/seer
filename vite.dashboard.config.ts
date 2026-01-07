import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  root: 'src/dashboard',
  publicDir: false,
  server: {
    https: {
      key: readFileSync(resolve(__dirname, 'localhost+2-key.pem')),
      cert: readFileSync(resolve(__dirname, 'localhost+2.pem')),
    },
    port: 5173,
    strictPort: true,
    open: true,
  },
  build: {
    outDir: '../../dist/dashboard',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'src/dashboard/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
