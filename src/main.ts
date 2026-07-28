import './style.css'
import * as THREE from 'three'
import { Game } from './game/Game'
import { audio } from './audio/AudioEngine'
import {
  worldFingerprint,
  fingerprintDiff,
  semanticFingerprint,
  semanticDiff,
  tagGroup,
  describeScenario,
  isCanonicalScenario,
  CANONICAL_SCENARIO,
} from './game/worldHash'
import { WORLD_SEED } from './game/Rng'
import { SEASONS } from './game/Seasons'
import { compareToReference, summariseReferences, CAPTURE_RECIPE } from './game/worldReferences'

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
  //
  // Both hashes are taken WITH the scenario (seed + season + weather + auto)
  // and shout when it is not the canonical one — a reference captured on a
  // profile left in winter is a different number, and the only thing worse
  // than no reference is one that looks right.
  const warnIfOffCanon = () => {
    if (isCanonicalScenario(game.scenario)) return
    console.warn(
      `[worldHash] Escenario NO canónico: ${describeScenario(game.scenario)}.\n` +
        `Canónico: ${describeScenario(CANONICAL_SCENARIO)}. Recarga con ?canon para fijarlo — ` +
        `este hash NO se puede comparar con las referencias del repo.`,
    )
  }
  ;(window as unknown as Record<string, unknown>).__worldHash = () => {
    warnIfOffCanon()
    return worldFingerprint(game.scene, game.scenario)
  }
  ;(window as unknown as Record<string, unknown>).__fingerprintDiff = fingerprintDiff
  // The partition-blind twin: `__semanticHash()` groups instances by the name
  // their builder declares and hashes each group as an unordered SET, so
  // splitting a pool across sectors leaves it unchanged. That is the check
  // sectorising has to pass — the structural hash above cannot answer it.
  ;(window as unknown as Record<string, unknown>).__semanticHash = () => {
    warnIfOffCanon()
    return semanticFingerprint(game.scene, game.scenario)
  }
  ;(window as unknown as Record<string, unknown>).__semanticDiff = semanticDiff
  // Raw handles so the harness can hash a SYNTHETIC scene: the partition
  // tests build the same instances split 1/2/8 ways and demand one answer.
  ;(window as unknown as Record<string, unknown>).__semanticOf = semanticFingerprint
  ;(window as unknown as Record<string, unknown>).__tag = tagGroup
  ;(window as unknown as Record<string, unknown>).__seed = WORLD_SEED

  // `__checkWorld()` — the whole verification in one call: walks the four
  // seasons, hashes each, and compares against the table baked into
  // worldReferences.ts. This is the browser half of the check (the partition
  // properties themselves are a real test, in test/worldHash.test.ts); it
  // lives here because building the actual world needs canvas and GL, which
  // a node runner has not got.
  ;(window as unknown as Record<string, unknown>).__checkWorld = () => {
    if (!isCanonicalScenario(game.scenario)) {
      console.error(
        `[worldHash] ${describeScenario(game.scenario)} no es el escenario canónico. ${CAPTURE_RECIPE}`,
      )
      return null
    }
    const before = game.scenario.season
    const results = SEASONS.map((s) => {
      game.setSeasonForCapture(s.id)
      return compareToReference(s.id, semanticFingerprint(game.scene).total, worldFingerprint(game.scene).total)
    })
    // Put the world back the way it was found, so a check is never a change.
    game.setSeasonForCapture(before)
    console.table(results)
    console.log(summariseReferences(results))
    return results
  }
}

// PWA: register the service worker only on the deployed build — in dev it
// would fight Vite's module server and cache stale HMR chunks.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
