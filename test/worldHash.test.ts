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
import { sectorizeWorld } from '../src/game/sectorize.ts'

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

test('las polilíneas cuentan — los cables llevaban etiqueta y no entraban en el hash', () => {
  const line = (shift: number) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 10 + shift, 4, 2, 20, 4, 2], 3))
    return tagGroup(new THREE.LineSegments(geo, new THREE.LineBasicMaterial()), 'wires')
  }

  const base = semanticFingerprint(sceneOf(line(0)))
  // The bug this pins: `isMesh || isPoints` skipped LineSegments entirely, so
  // a tagged group could report nothing and still look accounted for.
  assert.ok(base.groups.wires, 'la polilínea etiquetada tiene que producir un grupo')
  assert.equal(base.counts.wires, 1)
  assert.notEqual(semanticFingerprint(sceneOf(line(1))).groups.wires, base.groups.wires)
  assert.ok(worldFingerprint(sceneOf(line(0))).total !== worldFingerprint(new THREE.Scene()).total)
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

// ————————————————————————————————————————————————————————————————
// The sectoriser itself, not just the property it relies on.
//
// The tests above fix that the semantic fingerprint is blind to how instances
// are parcelled up. These fix that `sectorizeWorld` — the pass that actually
// does the parcelling — keeps its side of that bargain: same instances, same
// tag, same hash, whatever N is.
// ————————————————————————————————————————————————————————————————

test('sectorizar el anillo NO mueve el hash semántico, para 1, 4, 6 y 8', () => {
  // Instances spread right around a ring, which is the case the pass exists for.
  const ringPool = (group: string, n: number, radius: number) => {
    const mesh = new THREE.InstancedMesh(BOX, MAT, n)
    const o = new THREE.Object3D()
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      o.position.set(Math.cos(a) * radius, (i % 5) * 0.4, Math.sin(a) * radius)
      o.rotation.set(0, a, 0)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    return tagGroup(mesh, group)
  }

  const reference = semanticFingerprint(sceneOf(ringPool('houses', 120, 4000), ringPool('poles', 90, 4200)), CANONICAL_SCENARIO)

  for (const sectors of [1, 4, 6, 8]) {
    const scene = sceneOf(ringPool('houses', 120, 4000), ringPool('poles', 90, 4200))
    const report = sectorizeWorld(scene, { sectors })
    const after = semanticFingerprint(scene, CANONICAL_SCENARIO)
    assert.equal(after.total, reference.total, `con ${sectors} sectores el hash semántico se movió`)
    assert.deepEqual(after.counts, reference.counts, `con ${sectors} sectores cambiaron los recuentos`)
    if (sectors > 1) assert.ok(report.split.length === 2, `con ${sectors} sectores deberían haberse partido los dos pools`)
  }
})

test('sectorizar deja en paz lo dinámico y lo que no lleva etiqueta', () => {
  const plain = new THREE.InstancedMesh(BOX, MAT, 60)
  const o = new THREE.Object3D()
  for (let i = 0; i < 60; i++) {
    o.position.set(Math.cos(i) * 3000, 0, Math.sin(i) * 3000)
    o.updateMatrix()
    plain.setMatrixAt(i, o.matrix)
  }
  plain.instanceMatrix.needsUpdate = true

  const dyn = plain.clone()
  dyn.userData.dynamic = true
  tagGroup(dyn, 'consist')

  const scene = sceneOf(plain, dyn)
  const report = sectorizeWorld(scene, { sectors: 8 })

  assert.equal(report.split.length, 0, 'no debería haber partido ninguno de los dos')
  assert.equal(report.skipped.length, 2)
  assert.ok(report.skipped.some((s) => s.reason.includes('dinámico')))
  assert.ok(report.skipped.some((s) => s.reason.includes('sin nombre semántico')))
})

test('un pool que ya es local no se parte: pagaría draw calls sin ganar culling', () => {
  const local = new THREE.InstancedMesh(BOX, MAT, 40)
  const o = new THREE.Object3D()
  for (let i = 0; i < 40; i++) {
    o.position.set((i % 8) * 5, 0, Math.floor(i / 8) * 5)
    o.updateMatrix()
    local.setMatrixAt(i, o.matrix)
  }
  local.instanceMatrix.needsUpdate = true
  const scene = sceneOf(tagGroup(local, 'station-props'))

  const report = sectorizeWorld(scene, { sectors: 8 })
  assert.equal(report.split.length, 0)
  assert.match(report.skipped[0].reason, /ya es local/)
})
