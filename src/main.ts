import './style.css'
import * as THREE from 'three'
import { Game } from './game/Game'
import { audio } from './audio/AudioEngine'
import { worldFingerprint, fingerprintDiff } from './game/worldHash'
import { WORLD_SEED } from './game/Rng'

const app = document.querySelector<HTMLDivElement>('#app')!
const game = new Game(app)

// Dev-only handles so tooling (and curious devs) can poke the running game
// from the console; stripped from production builds.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__game = game
  ;(window as unknown as Record<string, unknown>).__THREE = THREE
  // The audio singleton has no other reachable handle, and every sound in the
  // game is synthesized — reading gain nodes from the console is the only way
  // to check a mix without ears on the device.
  ;(window as unknown as Record<string, unknown>).__audio = audio
  // Determinism check: `__worldHash()` fingerprints the generated world so two
  // loads can be compared as DATA. Screenshots can't do this job — WebGL
  // output varies with GPU, driver and antialiasing even when the world is
  // identical. `?seed=` deals a different one.
  ;(window as unknown as Record<string, unknown>).__worldHash = () => worldFingerprint(game.scene)
  ;(window as unknown as Record<string, unknown>).__fingerprintDiff = fingerprintDiff
  ;(window as unknown as Record<string, unknown>).__seed = WORLD_SEED
}

// PWA: register the service worker only on the deployed build — in dev it
// would fight Vite's module server and cache stale HMR chunks.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
