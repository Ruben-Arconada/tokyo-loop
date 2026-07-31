import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAB0212_BUDGET,
  assertCab0212Budget,
  enforceCab0212Budget,
  type Cab0212Report,
} from '../src/game/cab0212Contract.ts'

const CAB_OK: Cab0212Report = {
  draws: CAB0212_BUDGET.draws,
  triangles: CAB0212_BUDGET.triangles,
  textures: CAB0212_BUDGET.textures,
  lights: 0,
  unlit: true,
}

test('el contrato acepta una cabina unlit dentro del presupuesto 0.2.1.2', () => {
  assert.doesNotThrow(() => assertCab0212Budget(CAB_OK))
})

test('draws, triángulos, texturas y luces no pueden crecer en silencio', () => {
  assert.throws(() => assertCab0212Budget({ ...CAB_OK, draws: CAB0212_BUDGET.draws + 1 }), /draws/)
  assert.throws(() => assertCab0212Budget({ ...CAB_OK, triangles: CAB0212_BUDGET.triangles + 1 }), /triángulos/)
  assert.throws(() => assertCab0212Budget({ ...CAB_OK, textures: CAB0212_BUDGET.textures + 1 }), /texturas/)
  assert.throws(() => assertCab0212Budget({ ...CAB_OK, lights: 1 }), /luces/)
  assert.throws(() => assertCab0212Budget({ ...CAB_OK, unlit: false }), /unlit/)
})

test('una infracción avisa y conserva producción, pero rompe desarrollo', () => {
  const broken = { ...CAB_OK, triangles: CAB0212_BUDGET.triangles + 1 }
  assert.throws(() => enforceCab0212Budget(broken, true), /triángulos/)

  const warnings: string[] = []
  assert.equal(enforceCab0212Budget(broken, false, (message) => { warnings.push(message) }), false)
  assert.deepEqual(warnings, [`CabInterior0212: ${broken.triangles} triángulos > ${CAB0212_BUDGET.triangles}`])
})
