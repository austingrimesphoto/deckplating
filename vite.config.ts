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
      includeAssets: [
        'apple-touch-icon.png',
        'deckplate-coverage-app-icon.png',
        'deckplate-coverage-app-icon-192.png',
        'deckplate-coverage-app-icon-512.png',
        'deckplate-coverage-page-background.png',
      ],
      manifest: false,
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        runtimeCaching: [],
      },
    }),
  ],
});
