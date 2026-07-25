import { defineConfig } from 'vite'

// Served from https://<user>.github.io/tokyo-loop/ in production (GitHub Pages
// project site), so assets need that base path; local dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tokyo-loop/' : '/',
  build: {
    // The three.js vendor chunk is ~569 kB minified and cannot meaningfully
    // shrink — raise the warning bar so a clean build reads as clean.
    chunkSizeWarningLimit: 620,
    // Code-split (RC gate item): three.js is ~2/3 of the bundle and changes
    // only when the dependency bumps — in its own chunk, a gameplay-only
    // deploy leaves the heavy vendor chunk cached on every returning phone,
    // and the two files download in parallel on a cold start.
    rollupOptions: {
      output: {
        // Rolldown (vite 8) only takes the function form.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
        },
      },
    },
  },
}))
