import { defineConfig, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Emits the real `sw.js` from `src/sw-template.js`, baking in this build's
 * generation id and the exact list of files it produced.
 *
 * The worker used to precache by parsing index.html for script/href tags at
 * install time, with a cache name bumped by hand. Two problems followed:
 * forget the bump and every deploy piled its hashed assets into the same cache
 * forever, and a hand-written list can disagree with what the build actually
 * emitted. Generated here, the worker cannot fall out of step with the bundle,
 * and each build gets its own cache generation to sweep the previous one
 * against.
 *
 * Baked in rather than fetched: values the worker needs in order to serve a
 * request offline cannot themselves require the network. See the template.
 */
function swGeneration(): Plugin {
  return {
    name: 'sw-generation',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => /\.(js|css)$/.test(name))
        .sort()
      // The generation id comes from the asset names, which already carry
      // Vite's content hashes: same bundle in, same id out — so a rebuild
      // that changes nothing does not evict a working cache.
      const joined = files.join('|')
      let h = 0x811c9dc5
      for (let i = 0; i < joined.length; i++) {
        h ^= joined.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
      }
      const generation = (h >>> 0).toString(16).padStart(8, '0')
      const template = readFileSync(fileURLToPath(new URL('./src/sw-template.js', import.meta.url)), 'utf8')
      const source = template
        .replace('__GENERATION__', generation)
        .replace('__ASSETS__', JSON.stringify(files))
      if (source.includes('__GENERATION__') || source.includes('__ASSETS__')) {
        throw new Error('sw-generation: the template placeholders were not substituted')
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// Served from https://<user>.github.io/tokyo-loop/ in production (GitHub Pages
// project site), so assets need that base path; local dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tokyo-loop/' : '/',
  plugins: [swGeneration()],
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
