import { defineConfig } from 'vite'

// Served from https://<user>.github.io/tokyo-loop/ in production (GitHub Pages
// project site), so assets need that base path; local dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tokyo-loop/' : '/',
}))
