import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),

    // Les TV webOS 4.x tournent sous Chromium 53 (ni ES modules, ni AbortController).
    // Les apps webOS étant servies en file://, Vite force de toute façon le bundle
    // legacy sur toutes les TV : on ne génère donc QUE celui-là (renderModernChunks:
    // false) — un seul bundle SystemJS/ES5 pour toutes les générations de TV, et plus
    // de double montage de React sur les TV récentes.
    legacy({
      targets: ['chrome >= 53'],
      renderModernChunks: false,
      // TanStack Query v5 fait `new AbortController()` sans garde → écran noir sur
      // webOS 4.x. core-js ne polyfille pas cette API (DOM), il faut l'ajouter.
      additionalLegacyPolyfills: ['abortcontroller-polyfill/dist/polyfill-patch-fetch'],
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Les apps webOS sont servies depuis le système de fichiers — pas de base path
  base: './',

  // Chromium 53 ne comprend ni `inset`, ni `gap` flex, ni les sélecteurs modernes :
  // on demande à esbuild d'abaisser le CSS au même niveau que le JS.
  build: {
    outDir: 'dist',
    cssTarget: 'chrome53',
    // Inline les petits assets pour que l'app fonctionne en file://
    assetsInlineLimit: 4096,
    // hls.js est volumineux — attendu sur TV
    chunkSizeWarningLimit: 1000,
  },

  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
