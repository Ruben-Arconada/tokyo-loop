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
  opts: { programs?: number; texUploads?: number; prevTickMs?: number; gapMs?: number } = {},
) {
  log.record({
    frameMs,
    renderMs,
    // Default split: our callback took the render plus a little, and whatever
    // is left of the interval was spent outside it.
    prevTickMs: opts.prevTickMs ?? renderMs + 2,
    gapMs: opts.gapMs ?? Math.max(0, frameMs - (renderMs + 2)),
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
const PREV_TICK_MS = 3
const GAP_MS = 4
const NEW_PROGRAMS = 9
const NEW_TEXTURES = 10

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

test('ms, prevTickMs y gapMs describen el MISMO intervalo y cuadran', () => {
  const log = recorder(60)
  frame(log, 16.7, 15)
  // 320 ms de los que solo 8 son nuestro callback: el resto, fuera.
  frame(log, 320, 5, { prevTickMs: 8, gapMs: 312 })
  frame(log, 16.7, 15)

  const h = hitchesOf(log)
  assert.equal(h.length, 1)
  assert.equal(h[0][PREV_TICK_MS], 8)
  assert.equal(h[0][GAP_MS], 312)
  // La suma es la propiedad que hace comparables las tres columnas — sin ella
  // volvemos a mezclar fotogramas, que es el fallo que las trajo aquí.
  assert.ok(Math.abs(h[0][MS] - (h[0][PREV_TICK_MS] + h[0][GAP_MS])) <= 1)
})

test('un parón DENTRO de nuestro callback no se confunde con uno de fuera', () => {
  const log = recorder(60)
  frame(log, 16.7, 15)
  // Aquí el callback anterior SÍ tardó 300 ms y el hueco fue normal.
  frame(log, 320, 5, { prevTickMs: 300, gapMs: 20 })

  const h = hitchesOf(log)
  assert.equal(h[0][PREV_TICK_MS], 300)
  assert.ok(h[0][GAP_MS] < 50, 'el hueco pequeño dice que el tiempo se fue en nuestro código')
})

test('el retraso de un temporizador separa a la víctima del culpable', () => {
  const log = recorder(60)
  // A callback that ran when it was due: it cannot have been waiting behind
  // a block, so if a stall follows it, it is a candidate for having caused it.
  log.bookLag('a:tmr-culprit', 1.4)
  // One that ran 320 ms late: it was stuck behind the block. Whatever the tag
  // on the hitch says, this one is a witness.
  log.bookLag('a:tmr-victim', 318)

  const costs = JSON.parse(log.export()).costs
  assert.equal(costs['lag:a:tmr-culprit'][2], 1.4)
  assert.ok(costs['lag:a:tmr-victim'][2] > 300)
  // The distinction is the whole point: a tag alone cannot make it, because a
  // hitch collects marks from a window reaching past its own start.
  assert.ok(costs['lag:a:tmr-victim'][2] > costs['lag:a:tmr-culprit'][2] * 100)
})

test('el retraso no se contabiliza si no se está grabando', () => {
  const log = new PerfLog()
  log.bookLag('a:tmr-x', 500)
  log.start({ prueba: true }, { programs: 0, textures: 0, texUploads: 0 })
  const costs = JSON.parse(log.export()).costs
  assert.equal(costs['lag:a:tmr-x'], undefined)
})
