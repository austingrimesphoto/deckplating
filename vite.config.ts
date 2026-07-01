import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
