import './style.css'
import * as THREE from 'three'
import { Game } from './game/Game'
import { audio } from './audio/AudioEngine'

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
}

// PWA: register the service worker only on the deployed build — in dev it
// would fight Vite's module server and cache stale HMR chunks.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
