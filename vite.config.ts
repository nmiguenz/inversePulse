import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Service worker propio (push notifications) + precache inyectado por Workbox
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null, // lo registramos a mano desde src/pwa.ts
      includeAssets: ['icons/*.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'IOL Portfolio Monitor',
        short_name: 'IOL Monitor',
        description: 'Monitor inteligente de inversiones con alertas automáticas',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#06060A',
        theme_color: '#8B5CF6',
        orientation: 'portrait',
        lang: 'es-AR',
        categories: ['finance', 'productivity'],
        icons: [
          { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png' },
          { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
          { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png' },
          { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Recharts es pesado y solo se usa en el dashboard: va en su propio
        // chunk para que el resto del bundle (y el precache del SW) no lo cargue.
        manualChunks: {
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true, // accesible desde el celular en la LAN
  },
})
