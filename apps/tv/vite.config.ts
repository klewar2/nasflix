import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // WebOS apps are served from the file system — no base path needed
  base: './',
  build: {
    outDir: 'dist',
    // Inline small assets so the app works from file://
    assetsInlineLimit: 4096,
    // HLS.js is large — expected on TV
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', changeOrigin: true, ws: true },
    },
  },
});
