import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { comlink } from 'vite-plugin-comlink';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
   const env = loadEnv(mode, process.cwd(), '');
   return {
      plugins: [
         comlink(),
         react(),
         VitePWA({
            // 'prompt' will show a toast letting the user decide when to reload the app
            registerType: 'autoUpdate',
            // This will generate the manifest.json for you
            manifest: {
               name: 'Pluton Backup',
               short_name: 'Pluton',
               description: 'A modern backup and restore solution.',
               theme_color: '#575aff', // Matches your primary color
               background_color: '#f5f8ff',
               display: 'standalone',
               scope: '/',
               id: '/',
               start_url: '/',
               orientation: 'portrait',
               icons: [
                  {
                     src: 'icons/icon-72x72.png',
                     sizes: '72x72',
                     type: 'image/png',
                  },
                  {
                     src: 'icons/icon-96x96.png',
                     sizes: '96x96',
                     type: 'image/png',
                  },
                  {
                     src: 'icons/icon-128x128.png',
                     sizes: '128x128',
                     type: 'image/png',
                  },
                  {
                     src: 'icons/icon-144x144.png',
                     sizes: '144x144',
                     type: 'image/png',
                  },
                  {
                     src: 'icons/icon-192x192.png',
                     sizes: '192x192',
                     type: 'image/png',
                     purpose: 'any',
                  },
                  {
                     src: 'icons/icon-512x512.png',
                     sizes: '512x512',
                     type: 'image/png',
                     purpose: 'maskable',
                  },
               ],
               screenshots: [
                  {
                     src: 'screenshots/screenshot-desktop.png',
                     sizes: '1280x720',
                     type: 'image/png',
                     form_factor: 'wide',
                     label: 'Pluton Dashboard View',
                  },
                  {
                     src: 'screenshots/screenshot-mobile.png',
                     sizes: '390x844',
                     type: 'image/png',
                     label: 'Mobile Plan View',
                  },
               ],
            },

            // Caching strategies (powered by Workbox)
            workbox: {
               // This will cache all your assets (JS, CSS, images, fonts)
               globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
            },

            // For development testing
            devOptions: {
               enabled: true,
            },
         }),
      ],
      resolve: {
         // alias: {
         //    '@': path.resolve(__dirname, 'src'),
         // },
      },
      css: {
         preprocessorOptions: {
            scss: {
               api: 'modern', // or "modern"
            },
         },
      },
      server: {
         host: true,
         port: Number(env.WEB_PORT),
         strictPort: true,
      },
      preview: {
         host: true,
         port: Number(env.WEB_PORT),
         strictPort: true,
      },
   };
});
