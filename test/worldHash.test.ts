import * as THREE from 'three'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  semanticFingerprint,
  worldFingerprint,
  semanticDiff,
  tagGroup,
  isCanonicalScenario,
  CANONICAL_SCENARIO,
  type WorldScenario,
} from '../src/game/worldHash.ts'

// ————————————————————————————————————————————————————————————————
// The contract the ring sectorisation is about to lean on, as a test instead
// of a console ritual.
//
// These checks used to exist only as dev-only handles poked by hand in the
// browser, which meant the guarantee was real exactly as long as somebody
// remembered to re-poke it. Splitting a pool across eight sectors is the kind
// of refactor that is easy to get 99% right, and the 1% is a tree that
// quietly moved — so the guarantee has to be executable.
//
// Synthetic scenes on purpose: the full world needs canvas textures and a GL
// context, so a Node test cannot build it. What IS testable here is the
// property that matters — that the semantic hash sees a SET of instances and
// not the meshes they happen to be parcelled into.
// ————————————————————————————————————————————————————————————————

const BOX = new THREE.BoxGeometry(1, 1, 1)
const MAT = new THREE.MeshBasicMaterial()

/** One deterministic instance per index: a distinct position, scale and colour. */
function instanceAt(i: number): { matrix: THREE.Matrix4; color: THREE.Color } {
  const o = new THREE.Object3D()
  o.position.set(i * 3.25, Math.sin(i) * 12, i * -1.5)
  o.rotation.set(0, i * 0.37, 0)
  o.scale.setScalar(1 + (i % 7) * 0.11)
  o.updateMatrix()
  return { matrix: o.matrix.clone(), color: new THREE.Color().setHSL((i % 10) / 10, 0.5, 0.5) }
}

/** An instanced pool holding exactly the given indices, declared as `group`. */
function pool(indices: number[], group: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(BOX, MAT, Math.max(indices.length, 1))
  mesh.count = indices.length
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(indices.length, 1) * 3), 3)
  indices.forEach((src, slot) => {
    const { matrix, color } = instanceAt(src)
    mesh.setMatrixAt(slot, matrix)
    mesh.setColorAt(slot, color)
  })
  return tagGroup(mesh, group)
}

/** Splits 0..n-1 into `sectors` contiguous chunks — the shape a ring partition has. */
function split(n: number, sectors: number): number[][] {
  const out: number[][] = Array.from({ length: sectors }, () => [])
  for (let i = 0; i < n; i++) out[Math.floor((i / n) * sectors)].push(i)
  return out
}

/**
 * Deals the same indices round-robin instead of in contiguous runs.
 *
 * This exists because the contiguous split alone does NOT test what it looks
 * like it tests: chunk the instances in ascending order and they come back out
 * of a traversal in that same order, so a fingerprint that had forgotten to
 * sort its records as a SET still passed. Verified by mutation — deleting the
 * sort left the contiguous check green and only this one went red.
 */
function deal(n: number, sectors: number): number[][] {
  const out: number[][] = Array.from({ length: sectors }, () => [])
  for (let i = 0; i < n; i++) out[i % sectors].push(i)
  return out
}

function sceneOf(...objects: THREE.Object3D[]): THREE.Scene {
  const scene = new THREE.Scene()
  for (const o of objects) scene.add(o)
  return scene
}

const N = 64
const ALL = Array.from({ length: N }, (_, i) => i)

test('la partición no cambia el hash semántico: 1, 2 y 8 sectores dan lo mismo', () => {
  const whole = semanticFingerprint(sceneOf(pool(ALL, 'trees')))
  const halves = semanticFingerprint(sceneOf(...split(N, 2).map((ix) => pool(ix, 'trees'))))
  const eighths = semanticFingerprint(sceneOf(...split(N, 8).map((ix) => pool(ix, 'trees'))))
  // Round-robin as well as contiguous: see `deal` — the contiguous case alone
  // is a weaker check than it looks.
  const interleaved = semanticFingerprint(sceneOf(...deal(N, 8).map((ix) => pool(ix, 'trees'))))

  assert.equal(halves.total, whole.total)
  assert.equal(eighths.total, whole.total)
  assert.equal(interleaved.total, whole.total)
  assert.equal(eighths.groups.trees, whole.groups.trees)
  assert.equal(interleaved.groups.trees, whole.groups.trees)
  // The count rides inside the hash, so a split that dropped or duplicated an
  // instance could not come out looking identical.
  assert.equal(eighths.counts.trees, N)
})

test('tampoco importa el ORDEN de los sectores ni cuál lleva qué', () => {
  const forward = semanticFingerprint(sceneOf(...split(N, 8).map((ix) => pool(ix, 'trees'))))
  const backward = semanticFingerprint(sceneOf(...split(N, 8).reverse().map((ix) => pool(ix, 'trees'))))
  // Same instances, dealt to sectors in reverse: still one world.
  const shuffled = semanticFingerprint(
    sceneOf(...split(N, 8).map((_, s, all) => pool(all[all.length - 1 - s], 'trees'))),
  )

  assert.equal(backward.total, forward.total)
  assert.equal(shuffled.total, forward.total)
})

test('perder una instancia se ve en el recuento y en el hash', () => {
  const whole = semanticFingerprint(sceneOf(pool(ALL, 'trees')))
  const missing = semanticFingerprint(sceneOf(pool(ALL.slice(0, N - 1), 'trees')))

  assert.equal(missing.counts.trees, N - 1)
  assert.notEqual(missing.groups.trees, whole.groups.trees)
})

test('mover un árbol un milímetro cambia el hash; moverlo una micra no', () => {
  const base = semanticFingerprint(sceneOf(pool(ALL, 'trees')))

  const nudged = pool(ALL, 'trees')
  const m = new THREE.Matrix4()
  nudged.getMatrixAt(3, m)
  m.elements[12] += 0.001 // one millimetre: the quantum the fingerprint resolves
  nudged.setMatrixAt(3, m)
  assert.notEqual(semanticFingerprint(sceneOf(nudged)).groups.trees, base.groups.trees)

  // Float noise below the quantum must NOT register, or every FMA reordering
  // in three would read as "the world changed".
  const noisy = pool(ALL, 'trees')
  noisy.getMatrixAt(3, m)
  m.elements[12] += 0.0000001
  noisy.setMatrixAt(3, m)
  assert.equal(semanticFingerprint(sceneOf(noisy)).groups.trees, base.groups.trees)
})

test('cambiar un color cambia solo su grupo, y el diff lo nombra', () => {
  const before = semanticFingerprint(sceneOf(pool(ALL, 'trees'), pool(ALL, 'houses')))

  const repainted = pool(ALL, 'trees')
  repainted.setColorAt(9, new THREE.Color(0x123456))
  const after = semanticFingerprint(sceneOf(repainted, pool(ALL, 'houses')))

  assert.deepEqual(semanticDiff(before, after), ['trees'])
  assert.equal(after.groups.houses, before.groups.houses)
})

test('lo dinámico queda fuera, y la marca se hereda del padre', () => {
  const parent = new THREE.Group()
  parent.userData.dynamic = true
  parent.add(pool(ALL, 'trees'))

  const fp = semanticFingerprint(sceneOf(parent))
  // Tagging the GROUP has to be enough: marking mesh by mesh is how the
  // consist's nine meshes got forgotten once already.
  assert.equal(fp.groups.trees, undefined)
  assert.equal(fp.total, semanticFingerprint(new THREE.Scene()).total)
})

test('el nombre de reserva sale de la geometría, nunca del orden de recorrido', () => {
  const a = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), MAT)
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), MAT)
  const one = semanticFingerprint(sceneOf(a, b))
  const other = semanticFingerprint(sceneOf(b.clone(), a.clone()))

  assert.deepEqual(one.untagged.sort(), other.untagged.sort())
  assert.equal(one.total, other.total)
  // And they stay VISIBLE as untagged: a fallback name must never pass for a
  // declared one when a refactor is about to trust it.
  assert.equal(one.untagged.length, 2)
})

test('el hash estructural SÍ cambia con la partición — es su trabajo', () => {
  const whole = worldFingerprint(sceneOf(pool(ALL, 'trees')))
  const eighths = worldFingerprint(sceneOf(...split(N, 8).map((ix) => pool(ix, 'trees'))))

  // The pair is the point: "same world, built differently" is a state only
  // two hashes can express, and sectorising is exactly that state.
  assert.notEqual(eighths.total, whole.total)
  assert.equal(
    semanticFingerprint(sceneOf(...split(N, 8).map((ix) => pool(ix, 'trees')))).total,
    semanticFingerprint(sceneOf(pool(ALL, 'trees'))).total,
  )
})

test('un hash sin escenario canónico se marca como no canónico', () => {
  const off: WorldScenario = { ...CANONICAL_SCENARIO, season: 'winter' }

  assert.ok(isCanonicalScenario(CANONICAL_SCENARIO))
  assert.ok(!isCanonicalScenario(off))
  // Season is not decoration: it repaints twelve instance-colour buffers, so
  // a reference captured on a profile left in winter is a different number.
  assert.ok(!isCanonicalScenario(null))
  assert.ok(!isCanonicalScenario({ ...CANONICAL_SCENARIO, seed: 'otro-mundo' }))
  assert.ok(!isCanonicalScenario({ ...CANONICAL_SCENARIO, weatherAuto: true }))

  const scene = sceneOf(pool(ALL, 'trees'))
  assert.equal(semanticFingerprint(scene, CANONICAL_SCENARIO).canonical, true)
  assert.equal(semanticFingerprint(scene, off).canonical, false)
  assert.equal(worldFingerprint(scene, off).canonical, false)
  // No scenario at all is the synthetic case these tests run in, and it is
  // never canonical — nothing here is a capture of the real world.
  assert.equal(semanticFingerprint(scene).scenario, null)
})
