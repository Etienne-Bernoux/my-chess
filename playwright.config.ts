import { defineConfig, devices } from '@playwright/test'

/**
 * Ces tests couvrent la **géométrie** de l'écran, pas l'ergonomie. Ils prouvent
 * qu'une zone est atteignable, qu'un tap arrive sur la bonne cible, qu'une
 * couleur change vraiment. Ils ne prouvent pas qu'un retour est *perceptible* ni
 * qu'un timbre est *distinguable* — ça reste à valider au téléphone, et aucun
 * booléen ne le remplacera.
 *
 * Ils tournent contre le build de production servi par `vite preview`, pas
 * contre le serveur de développement : c'est ce qui sera réellement installé.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      // Le cadre réel : un téléphone posé à plat, en portrait, au doigt.
      name: 'android-portrait',
      use: { ...devices['Pixel 7'] },
    },
    {
      // Un écran court met la grille sous tension — c'est là que la bande
      // centrale et les cadrans se disputent la hauteur.
      name: 'short-viewport',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 412, height: 480 },
      },
    },
  ],

  webServer: {
    // `--host 127.0.0.1` n'est pas décoratif : sans lui, `vite preview` écoute
    // sur `::1` alors que Playwright interroge `127.0.0.1`, et l'attente expire
    // sur un serveur pourtant démarré. On force IPv4 des deux côtés.
    command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
