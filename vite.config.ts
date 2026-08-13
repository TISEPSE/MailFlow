import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://v2.tauri.app/reference/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Tauri lit la sortie de Vite ; le port doit correspondre a `devUrl`
  // dans tauri.conf.json et ne jamais glisser silencieusement.
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Le backend Rust a son propre rechargement, pilote par la CLI Tauri.
      ignored: ['**/src-tauri/**'],
    },
  },

  // Seules ces variables d'environnement sont exposees au bundle frontend.
  // Rien de ce qui commence par VITE_ ne doit contenir de secret : le bundle
  // est distribue tel quel dans l'application.
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  // Laisse visible la sortie de la CLI Tauri pendant le developpement.
  clearScreen: false,

  build: {
    // Aligne la cible sur les moteurs des webviews : WebKit sur macOS et Linux.
    target: 'safari15',
    // Les builds de debogage gardent un bundle lisible pour le diagnostic ;
    // les builds de release sont minifies par oxc (defaut de Vite 8).
    sourcemap: process.env.TAURI_ENV_DEBUG === 'true',
    minify: process.env.TAURI_ENV_DEBUG !== 'true',
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
