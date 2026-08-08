import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Chemins relatifs : l'application est servie telle quelle, sans hypothèse
  // sur le chemin de publication.
  base: './',

  plugins: [
    VitePWA({
      // Surtout pas `autoUpdate` : la prise de contrôle d'un nouveau service
      // worker recharge la page, et en pleine partie cela renvoie sur l'écran de
      // reprise pendant que le temps continue de couler. En `prompt` sans
      // interface de confirmation, la mise à jour attend simplement la prochaine
      // ouverture à froid.
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'myChess — pendule',
        short_name: 'myChess',
        description: 'Pendule d’échecs posée à plat entre deux joueurs.',
        lang: 'fr',
        start_url: './',
        scope: './',
        // Posée à plat entre deux joueurs : ni barre d'adresse, ni rotation.
        display: 'fullscreen',
        orientation: 'portrait',
        background_color: '#101014',
        theme_color: '#101014',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,json}'],
      },
      // Un service worker en développement sert facilement une version périmée
      // et fait perdre du temps de diagnostic pour rien.
      devOptions: { enabled: false },
    }),
  ],

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
