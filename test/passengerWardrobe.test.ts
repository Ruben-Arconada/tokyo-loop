import test from 'node:test'
import assert from 'node:assert/strict'
import { PASSENGER_UMBRELLAS, passengerUmbrellaColor } from '../src/game/passengerWardrobe.ts'

test('el LOD 3D no inventa paraguas en seco', () => {
  for (let row = 0; row < PASSENGER_UMBRELLAS.length; row++) {
    assert.equal(passengerUmbrellaColor(row, false), null)
  }
})

test('en mojado conserva exactamente los arquetipos del sprite', () => {
  const carrying = PASSENGER_UMBRELLAS
    .map((_, row) => passengerUmbrellaColor(row, true) === null ? -1 : row)
    .filter((row) => row >= 0)
  assert.deepEqual(carrying, [0, 1, 2, 4, 6, 7])
})
