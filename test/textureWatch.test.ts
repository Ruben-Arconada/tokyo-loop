import test from 'node:test'
import assert from 'node:assert/strict'
import { TextureUploadWatch } from '../src/game/textureWatch.ts'

// ————————————————————————————————————————————————————————————————
// The counter itself, not a stand-in for it.
//
// The previous round of tests fed PerfLog a baseline that was correct by
// construction, so they could not see that the thing PRODUCING the baseline
// was broken: it only looked at textures while recording, which meant it read
// zero at the moment recording began and then discovered every already-resident
// texture on the first frame — a fabricated spike, in the first frame, naming
// the exact suspect under investigation.
//
// Hence a real unit with an injected "is it uploaded yet" predicate, so the
// integration can be exercised without a GL context.
// ————————————————————————————————————————————————————————————————

/** A stand-in texture; `up` flips when the fake GPU has taken it. */
type Tex = { uuid: string; up: boolean }
const tex = (uuid: string, up = false): Tex => ({ uuid, up })

function watch() {
  return new TextureUploadWatch<Tex>((t) => t.up)
}

test('lo que ya estaba en la GPU cuenta en la BASE, no como subida nueva', () => {
  const w = watch()
  const yaSubidas = [tex('a', true), tex('b', true)]
  const pendiente = tex('c')
  for (const t of [...yaSubidas, pendiente]) w.watch(t)

  // This is the poll that would happen long before anyone presses record.
  const base = w.poll()
  assert.equal(base, 2, 'las dos residentes se contabilizan al mirar, no al grabar')

  // Now the lap starts with `base` as its baseline, and only real uploads move it.
  pendiente.up = true
  assert.equal(w.poll() - base, 1, 'solo la que subió de verdad')
})

test('sin sondear nunca, la base sería CERO y el primer fotograma inventaría un pico', () => {
  const w = watch()
  for (const t of [tex('a', true), tex('b', true), tex('c', true)]) w.watch(t)

  // The bug, reproduced: read the total without ever polling and you get 0...
  assert.equal(w.total, 0)
  // ...and then the first poll of the lap reports three uploads that happened
  // before it started. This is why Game polls on every frame, recording or not.
  assert.equal(w.poll(), 3)
})

test('una textura destruida y recreada SÍ cuenta otra vez', () => {
  const w = watch()
  const primera = tex('destino-1')
  w.watch(primera)
  primera.up = true
  const base = w.poll()

  // updateLever disposes the destination roll and builds a new one per station.
  w.forget(primera)
  const segunda = tex('destino-2')
  w.watch(segunda)
  assert.equal(w.poll(), base, 'aún no ha llegado a la GPU')
  segunda.up = true
  assert.equal(w.poll(), base + 1, 'el total residente no vería esto: una se va y otra llega')
})

test('una textura destruida sin haberse dibujado nunca se olvida y no queda colgada', () => {
  const w = watch()
  const nuncaDibujada = tex('huerfana')
  w.watch(nuncaDibujada)
  assert.equal(w.waiting, 1)
  w.forget(nuncaDibujada)
  assert.equal(w.waiting, 0, 'sin esto, el bucle la miraría cada fotograma para siempre')
  assert.equal(w.poll(), 0)
})

test('cuando todo ha llegado, sondear deja de costar', () => {
  const w = watch()
  const todas = [tex('a'), tex('b'), tex('c')]
  for (const t of todas) w.watch(t)
  assert.equal(w.waiting, 3)
  for (const t of todas) t.up = true
  w.poll()
  // The per-frame cost of the instrument has to fall to nothing, or the
  // recorder becomes a reason a frame is slow.
  assert.equal(w.waiting, 0)
  assert.equal(w.poll(), 3)
})

test('vigilar dos veces la misma textura no la cuenta dos veces', () => {
  const w = watch()
  const t = tex('a')
  w.watch(t)
  w.watch(t)
  t.up = true
  assert.equal(w.poll(), 1)
})
