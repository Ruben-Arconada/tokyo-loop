import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ART021_BUDGET,
  ART021_MODEL_LOD_DISTANCE,
  art021ModelMask,
  assertHybridArtBudget,
  assertStaticArtBudget,
  enforceHybridArtBudget,
  enforceStaticArtBudget,
  type Art021HybridReport,
  type Art021StaticReport,
} from '../src/game/art021Contract.ts'

const STATIC_OK: Art021StaticReport = {
  stations: ['susukino', 'nishiki'],
  meshes: 12,
  triangles: 49_128,
  designDrawsDay: 10,
  designDrawsWinter: 12,
}

const HYBRID_OK: Art021HybridReport = {
  figures: 26,
  draws: 6,
  triangles: 9_256,
  stations: [2, 3],
  wetUmbrellas: true,
}

test('el contrato acepta los informes reales de la rebanada 0.2.1', () => {
  assert.doesNotThrow(() => assertStaticArtBudget(STATIC_OK))
  assert.doesNotThrow(() => assertHybridArtBudget(HYBRID_OK))
})

test('un draw o triángulo de más pone rojo el contrato estático', () => {
  assert.throws(() => assertStaticArtBudget({ ...STATIC_OK, designDrawsDay: ART021_BUDGET.staticDrawsDay + 1 }), /draws de día/)
  assert.throws(() => assertStaticArtBudget({ ...STATIC_OK, triangles: ART021_BUDGET.staticTriangles + 1 }), /triángulos/)
})

test('la multitud híbrida no puede crecer en silencio', () => {
  assert.throws(() => assertHybridArtBudget({ ...HYBRID_OK, figures: 25 }), /figuras/)
  assert.throws(() => assertHybridArtBudget({ ...HYBRID_OK, draws: ART021_BUDGET.hybridDraws + 1 }), /draws/)
  assert.throws(() => assertHybridArtBudget({ ...HYBRID_OK, triangles: ART021_BUDGET.hybridTriangles + 1 }), /triángulos/)
  assert.throws(() => assertHybridArtBudget({ ...HYBRID_OK, wetUmbrellas: false }), /paraguas/)
})

test('un presupuesto excedido rompe dev pero producción avisa y conserva la escena', () => {
  const brokenHybrid = {
    ...HYBRID_OK,
    triangles: ART021_BUDGET.hybridTriangles + 1,
  }
  const brokenStatic = {
    ...STATIC_OK,
    triangles: ART021_BUDGET.staticTriangles + 1,
  }
  assert.throws(() => enforceHybridArtBudget(brokenHybrid, true), /triángulos/)
  assert.throws(() => enforceStaticArtBudget(brokenStatic, true), /triángulos/)

  const warnings: string[] = []
  assert.equal(enforceHybridArtBudget(brokenHybrid, false, (message) => { warnings.push(message) }), false)
  assert.equal(enforceStaticArtBudget(brokenStatic, false, (message) => { warnings.push(message) }), false)
  assert.equal(warnings.length, 2)
  assert.ok(warnings.every((message) => /triángulos/.test(message)))
})

test('el LOD devuelve los sprites a 300 m y activa solo la estación cercana', () => {
  const near = (ART021_MODEL_LOD_DISTANCE - 1) ** 2
  const far = (ART021_MODEL_LOD_DISTANCE + 1) ** 2
  assert.equal(art021ModelMask(far, far), 0)
  assert.equal(art021ModelMask(near, far), 1)
  assert.equal(art021ModelMask(far, near), 2)
  assert.equal(art021ModelMask(near, near), 3)
})
