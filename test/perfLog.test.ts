import test from 'node:test'
import assert from 'node:assert/strict'
import { PerfLog } from '../src/game/PerfLog.ts'

// ————————————————————————————————————————————————————————————————
// The alignment contract.
//
// This file exists because the first version of the freeze instrumentation
// was off by one frame and nobody could have seen it from the output. The
// interval a frame reports is measured at the TOP of the tick, so it covers
// the previous frame's work, while the GPU resource counts are read after
// THIS frame's render. Pairing them booked a 320 ms compiling render as "a
// normal frame that linked two programs", followed by "a 320 ms frame that
// linked none" — so the column added to prove compilation would have
// disproved it, every single time, on a device we only get to measure once
// in a while.
//
// The rule these tests hold down: whatever caused a slow render must appear
// in the SAME record as that render.
// ————————————————————————————————————————————————————————————————

/** A recorder with a known GPU baseline, as `start()` takes it from the renderer. */
function recorder(programs = 60, texUploads = 0) {
  const log = new PerfLog()
  log.start({ prueba: true }, { programs, textures: 40, texUploads })
  return log
}

/** One frame. `frameMs` is the interval BEFORE it; `renderMs` is its own render. */
function frame(
  log: PerfLog,
  frameMs: number,
  renderMs: number,
  opts: { programs?: number; texUploads?: number } = {},
) {
  log.record({
    frameMs,
    renderMs,
    draws: 100,
    tris: 400_000,
    speedKmh: 95,
    progress: 0.5,
    stationIdx: 7,
    programs: opts.programs ?? 60,
    textures: 40,
    texUploads: opts.texUploads ?? 0,
    shadowPass: false,
  })
}

function hitchesOf(log: PerfLog): number[][] {
  return JSON.parse(log.export()).hitches
}

// Column indices, named so the assertions read as claims rather than arithmetic.
const MS = 1
const RENDER_MS = 2
const NEW_PROGRAMS = 7
const NEW_TEXTURES = 8

test('un render lento y los programas que enlazó caen en el MISMO registro', () => {
  const log = recorder(60)
  frame(log, 16.7, 15, { programs: 60 })
  // The compiling render: 320 ms, and two programs linked during it.
  frame(log, 16.7, 320, { programs: 62 })
  // The next frame's INTERVAL is what contains those 320 ms — the trap.
  frame(log, 320, 15, { programs: 62 })
  frame(log, 16.7, 15, { programs: 62 })

  const h = hitchesOf(log)
  assert.equal(h.length, 1, 'un solo tirón: el eco del fotograma siguiente no se cuenta aparte')
  assert.equal(h[0][RENDER_MS], 320)
  assert.equal(h[0][NEW_PROGRAMS], 2, 'los programas tienen que ir CON su render, no con el fotograma siguiente')
})

test('lo mismo para una subida de textura', () => {
  const log = recorder(60, 3)
  frame(log, 16.7, 15, { texUploads: 3 })
  frame(log, 16.7, 320, { texUploads: 4 })
  frame(log, 320, 15, { texUploads: 4 })

  const h = hitchesOf(log)
  assert.equal(h.length, 1)
  assert.equal(h[0][NEW_TEXTURES], 1)
  assert.equal(h[0][NEW_PROGRAMS], 0, 'una subida de textura no puede leerse como compilación')
})

test('un parón FUERA del render se sigue viendo, y sin recursos', () => {
  const log = recorder(60)
  frame(log, 16.7, 15)
  // Speech, storage, GC — anything that blocks between renders.
  frame(log, 320, 15)
  frame(log, 16.7, 15)

  const h = hitchesOf(log)
  assert.equal(h.length, 1, 'suprimir el eco no puede tragarse un parón real')
  assert.equal(h[0][MS], 320)
  assert.ok(h[0][RENDER_MS] < 50, 'el render fue normal: el parón estaba en otra parte')
  assert.equal(h[0][NEW_PROGRAMS], 0)
  assert.equal(h[0][NEW_TEXTURES], 0)
})

test('la línea base viene de start(), así que el primer render no se traga sus compilaciones', () => {
  const log = recorder(60)
  // The very first frame of the lap compiles — the likeliest frame of all to.
  frame(log, 16.7, 320, { programs: 64 })

  const h = hitchesOf(log)
  assert.equal(h[0][NEW_PROGRAMS], 4)
  const summary = JSON.parse(log.export()).summary
  assert.equal(summary.programs0, 60, 'la base es la del renderer al empezar, no la del primer fotograma')
  assert.equal(summary.programsEnd, 64)
})

test('los tirones se ordenan por el PEOR de los dos relojes', () => {
  const log = recorder(60)
  // A slow render (ordinary interval by construction) and a plain slow frame.
  frame(log, 16.7, 300, { programs: 61 })
  frame(log, 300, 15, { programs: 61 })
  frame(log, 60, 15)
  frame(log, 16.7, 15)

  const h = hitchesOf(log)
  // Sorting on the interval alone would have put the 60 ms blip above the
  // 300 ms render — and the cap would eventually drop the evidence.
  assert.equal(h[0][RENDER_MS], 300)
  assert.equal(h[1][MS], 60)
})

test('el resumen distingue textura RESIDENTE de textura SUBIDA', () => {
  const log = recorder(60, 5)
  // The destination roll is disposed and rebuilt: one leaves, one arrives, so
  // the resident count never moves — but a NEW upload did happen.
  frame(log, 16.7, 15, { texUploads: 5 })
  frame(log, 16.7, 15, { texUploads: 6 })

  const s = JSON.parse(log.export()).summary
  assert.equal(s.textures0, s.texturesEnd, 'el total residente se queda plano, que es justo el punto ciego')
  assert.equal(s.texUploads0, 5)
  assert.equal(s.texUploadsEnd, 6)
})
