import test from 'node:test'
import assert from 'node:assert/strict'
import { ART023_BUDGET, assertArt023Budget, enforceArt023Budget, type Art023Report } from '../src/game/art023Contract.ts'

const report = (patch: Partial<Art023Report> = {}): Art023Report => ({
  family: 'green',
  stations: ['nara'],
  meshes: 4,
  triangles: ART023_BUDGET.triangles,
  designDrawsDay: ART023_BUDGET.drawsDay,
  designDrawsWinter: ART023_BUDGET.drawsWinter,
  textures: 0,
  lights: 0,
  legacyMeshesReplaced: 20,
  ...patch,
})

test('the exact 0.2.3 mobile budget is accepted', () => {
  assert.doesNotThrow(() => assertArt023Budget(report()))
})

test('every art-cost axis is guarded independently', () => {
  for (const patch of [
    { designDrawsDay: ART023_BUDGET.drawsDay + 1 },
    { designDrawsWinter: ART023_BUDGET.drawsWinter + 1 },
    { triangles: ART023_BUDGET.triangles + 1 },
    { textures: 1 },
    { lights: 1 },
    { legacyMeshesReplaced: 19 },
  ]) {
    assert.throws(() => assertArt023Budget(report(patch)))
  }
})

test('production reports a violation without replacing the playable scene', () => {
  const messages: string[] = []
  assert.equal(enforceArt023Budget(report({ textures: 1 }), false, (message) => messages.push(message)), false)
  assert.equal(messages.length, 1)
})
