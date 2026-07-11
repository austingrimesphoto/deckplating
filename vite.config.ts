import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 850,
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((dep) => !dep.includes('maplibre-')),
    },
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom'],
          pwa: ['workbox-window'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: false,
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,webmanifest}'],
        globIgnores: [
          'assets/maplibre-*.js',
          'assets/maplibre-gl-*.{js,css}',
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [],
      },
    }),
  ],
});
