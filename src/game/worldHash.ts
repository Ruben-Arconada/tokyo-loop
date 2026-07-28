import * as THREE from 'three'
// Explicit `.ts` on this one specifier (the rest of the codebase goes
// extensionless, bundler-style): it is the only runtime import this module
// has, and node's ESM resolver — which runs the partition tests in test/ —
// will not guess an extension. Vite resolves it either way.
import { DEFAULT_WORLD_SEED } from './Rng.ts'
import type { Season, Weather } from './Seasons'

// ————————————————————————————————————————————————————————————————
// Fingerprints of the GENERATED world, for checking that seeding actually
// works. Deliberately NOT pixel comparison: WebGL output legitimately differs
// between GPUs, drivers, antialiasing settings and font rasterizers even when
// the world is byte-identical, so "same screenshot" is not a determinism test.
// What must be reproducible is the DATA we generate — where every instance
// sits, how big it is, what colour it was given.
//
// Everything is quantized before hashing: float noise in the last bits of a
// matrix (from an FMA reordering, say) must not change the answer, while a
// millimetre of real displacement must.
// ————————————————————————————————————————————————————————————————

/** Positions/scales to the millimetre, colours to ~1/1000 of a channel. */
const QUANT = 1000

// ————————————————————————————————————————————————————————————————
// WHICH world a fingerprint describes.
//
// The seed alone does not pin it down, and believing it did cost us a
// reference hash: season and weather are restored from localStorage at
// startup, and the season rewrites twelve instanceColor buffers on the way
// in. The same build, the same seed and a browser profile left on winter
// gives a different number than one left on spring — so a bare hash written
// down in a doc means nothing without the dress it was wearing.
//
// Hence: every fingerprint carries the scenario it was taken in, and there is
// one CANONICAL scenario that references are quoted in.
// ————————————————————————————————————————————————————————————————

export interface WorldScenario {
  seed: string
  season: Season
  weather: Weather
  /** Auto fronts OFF for a capture: a front rolling in mid-session would move the sky under the measurement. */
  weatherAuto: boolean
}

/** The scenario every reference hash in the docs is quoted in. */
export const CANONICAL_SCENARIO: WorldScenario = {
  seed: DEFAULT_WORLD_SEED,
  season: 'spring',
  weather: 'clear',
  weatherAuto: false,
}

/**
 * `?canon` starts the game in the canonical scenario whatever this browser
 * profile has stored. Without it, capturing a reference means remembering to
 * clear three localStorage keys by hand first — which is exactly the step that
 * gets skipped, and the reason a winter capture once got written down as the
 * spring reference.
 *
 * It only seeds the INITIAL state; changing season from the panel afterwards
 * still persists as usual.
 */
export const FORCE_CANONICAL: boolean =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('canon')

export function isCanonicalScenario(s: WorldScenario | null): boolean {
  return (
    !!s &&
    s.seed === CANONICAL_SCENARIO.seed &&
    s.season === CANONICAL_SCENARIO.season &&
    s.weather === CANONICAL_SCENARIO.weather &&
    s.weatherAuto === CANONICAL_SCENARIO.weatherAuto
  )
}

/** One line for logs and docs: `japan-loop-0.5-world-1 · spring · clear · auto:off`. */
export function describeScenario(s: WorldScenario | null): string {
  if (!s) return 'sin escenario (escena sintética)'
  return `${s.seed} · ${s.season} · ${s.weather} · auto:${s.weatherAuto ? 'on' : 'off'}`
}

/**
 * Is this object placed by something that moves during play? Checked up the
 * PARENTS too, so tagging one group covers everything under it — the train is
 * nine meshes and tagging them one by one is how the next one gets forgotten.
 *
 * Getting this wrong is not cosmetic: the consist and the camera-following sky
 * dome were landing in the "static" total, so the world's hash quietly changed
 * with the train's position. Every comparison still had to be made at the same
 * spot on the ring to mean anything, which is exactly the kind of hidden
 * precondition a determinism check must not have.
 */
function isDynamic(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (o.userData?.dynamic) return true
  }
  return false
}

/** FNV-1a over a stream of quantized integers, returned as 8 hex chars. */
class Digest {
  private h = 0x811c9dc5

  push(value: number) {
    // Quantize first, then fold the integer in four bytes at a time.
    let q = Math.round(value * QUANT) | 0
    for (let i = 0; i < 4; i++) {
      this.h ^= q & 0xff
      this.h = Math.imul(this.h, 0x01000193)
      q >>>= 8
    }
    return this
  }

  pushText(text: string) {
    for (let i = 0; i < text.length; i++) {
      this.h ^= text.charCodeAt(i)
      this.h = Math.imul(this.h, 0x01000193)
    }
    return this
  }

  get hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0')
  }
}

export interface WorldFingerprint {
  /** What was on when this was taken. `null` for synthetic scenes built by the tests. */
  scenario: WorldScenario | null
  /** False means "do not write this number down as a reference" — see CANONICAL_SCENARIO. */
  canonical: boolean
  /** One hash per generated mesh of the STATIC world, keyed by creation order + what it is. */
  parts: Record<string, string>
  /** Everything static folded together — the single number to compare between loads. */
  total: string
  /**
   * Meshes tagged `userData.dynamic`: passengers, the precipitation curtain,
   * the consist, the camera-following sky dome and the cloud ring. They are
   * placed by live systems — some deliberately still on Math.random(), the
   * clouds reseeded per weather change — so they change between loads BY
   * DESIGN and must stay out of the total; otherwise the world's determinism
   * check could never pass. Reported anyway, so the day one of them gets
   * pinned down it is visible here.
   */
  dynamicParts: Record<string, string>
}

/**
 * Walks the scene in creation order and fingerprints every mesh that carries
 * generated placement: instance matrices and instance colours for instanced
 * pools, and the world transform for plain meshes.
 *
 * The keys are `NN.GeometryType.count`, where NN is traversal order. That is
 * stable for a given build, which is all the comparison needs — it answers
 * "did THIS pool move?", which is the question when checking that touching one
 * system left the others alone.
 */
export function worldFingerprint(scene: THREE.Scene, scenario: WorldScenario | null = null): WorldFingerprint {
  const parts: Record<string, string> = {}
  const dynamicParts: Record<string, string> = {}
  const totalDigest = new Digest()
  let index = 0

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh & { isInstancedMesh?: boolean; isPoints?: boolean; count?: number; instanceMatrix?: THREE.BufferAttribute; instanceColor?: THREE.BufferAttribute | null }
    const isDrawable = (mesh as unknown as { isMesh?: boolean }).isMesh || mesh.isPoints
    if (!isDrawable || !mesh.geometry) return

    const d = new Digest()
    const kind = mesh.geometry.type
    d.pushText(kind)
    const bucket = isDynamic(mesh) ? dynamicParts : parts

    if (mesh.userData?.seedTable) {
      // Point clouds whose rendered positions are rewritten every frame (the
      // drifting petals): hashing the live buffer would just measure what
      // second it is. The SEED TABLE behind the animation is the generated
      // data, so that is what gets fingerprinted.
      const seeds = mesh.userData.seedTable as Float32Array
      d.pushText('seedTable')
      for (let i = 0; i < seeds.length; i++) d.push(seeds[i])
      bucket[`${String(index).padStart(2, '0')}.seeded.${seeds.length}`] = d.hex
    } else if (mesh.isPoints) {
      // A static point cloud — the star field. Its positions ARE the data.
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      d.push(arr.length)
      for (let i = 0; i < arr.length; i++) d.push(arr[i])
      bucket[`${String(index).padStart(2, '0')}.points.${pos.count}`] = d.hex
    } else if (mesh.isInstancedMesh && mesh.instanceMatrix) {
      const count = mesh.count ?? 0
      d.push(count)
      const m = mesh.instanceMatrix.array as Float32Array
      // Only the live instances: the buffer is allocated to a cap and the
      // tail is uninitialised, which is not part of the world.
      for (let i = 0; i < count * 16; i++) d.push(m[i])
      if (mesh.instanceColor) {
        const c = mesh.instanceColor.array as Float32Array
        for (let i = 0; i < count * 3; i++) d.push(c[i])
      }
      bucket[`${String(index).padStart(2, "0")}.${kind}.${count}`] = d.hex
    } else if ((mesh.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) {
      // The blossom cards live here: an InstancedBufferGeometry carries its
      // per-instance data in ATTRIBUTES, not in an instanceMatrix, so the
      // branch above would have missed the whole canopy system.
      const geo = mesh.geometry as THREE.InstancedBufferGeometry
      const count = geo.instanceCount
      d.push(count)
      for (const name of Object.keys(geo.attributes).sort()) {
        const attr = geo.attributes[name] as THREE.BufferAttribute
        if (!(attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) continue
        d.pushText(name)
        const arr = attr.array as Float32Array
        const used = Math.min(arr.length, count * attr.itemSize)
        for (let i = 0; i < used; i++) d.push(arr[i])
      }
      bucket[`${String(index).padStart(2, "0")}.instanced.${count}`] = d.hex
    } else {
      // A plain mesh contributes its placement, not its vertices: the
      // geometry is authored, only where it ended up is generated.
      mesh.updateWorldMatrix(false, false)
      const e = mesh.matrixWorld.elements
      for (let i = 0; i < 16; i++) d.push(e[i])
      bucket[`${String(index).padStart(2, "0")}.${kind}`] = d.hex
    }
    // Only the static world folds into the total: a dynamic mesh in there
    // would make the number change on every load and prove nothing.
    if (bucket === parts) totalDigest.pushText(d.hex)
    index++
  })

  return { scenario, canonical: isCanonicalScenario(scenario), parts, total: totalDigest.hex, dynamicParts }
}

// ————————————————————————————————————————————————————————————————
// The SEMANTIC fingerprint, which is a different question from the structural
// one above and exists for one reason: sectorising the ring.
//
// The structural hash keys on traversal order and on how many instances each
// mesh holds, so splitting one 68-instance pool into eight sector pools of
// nine changes it even though not a single tree moved. It stays exactly as it
// is — it answers "is the scene built the same way?", which is still worth
// asking. This one answers "is the same WORLD there?", and to do that it must
// be blind to the partition: instances are flattened out of their meshes,
// grouped by an explicit NAME the builder declares, sorted into a stable set,
// and only then digested. Eight sectors or one pool, shuffled or not, the
// answer is the same.
// ————————————————————————————————————————————————————————————————

/**
 * Declares which world system a mesh's contents belong to. Sector pools carry
 * the SAME name as the single pool they were split from — that is the whole
 * mechanism. Returns the object so it can wrap a `scene.add(tag(mesh, '…'))`.
 */
export function tagGroup<T extends THREE.Object3D>(obj: T, group: string): T {
  obj.userData.semanticGroup = group
  return obj
}

/** Stable identity for a geometry, so two pools only merge if they really are the same thing. */
function geometryKey(geo: THREE.BufferGeometry): string {
  const params = (geo as THREE.BufferGeometry & { parameters?: Record<string, unknown> }).parameters
  return params ? `${geo.type}(${Object.values(params).join(',')})` : geo.type
}

/**
 * Fallback name for meshes whose builder has not declared a group yet. Derived
 * from the geometry, NEVER from traversal order — an order-derived name would
 * defeat the entire point. Reported in `untagged` so the gap stays visible
 * instead of quietly passing as a real group.
 */
function fallbackGroup(geo: THREE.BufferGeometry): string {
  return `untagged:${geometryKey(geo)}`
}

export interface SemanticFingerprint {
  /** What was on when this was taken. `null` for synthetic scenes built by the tests. */
  scenario: WorldScenario | null
  /** False means "do not write this number down as a reference" — see CANONICAL_SCENARIO. */
  canonical: boolean
  /** group name → hash of its instances as an unordered set. */
  groups: Record<string, string>
  /** group name → how many instances it holds. A split that loses or duplicates one shows up here. */
  counts: Record<string, number>
  total: string
  /** Groups still riding the geometry-derived fallback — tag these before trusting them across a refactor. */
  untagged: string[]
}

export function semanticFingerprint(scene: THREE.Scene, scenario: WorldScenario | null = null): SemanticFingerprint {
  /** group → one quantized record per instance, as strings so they can be sorted as a set. */
  const records = new Map<string, string[]>()
  const push = (group: string, parts: number[], prefix: string) => {
    const quantized = prefix + '|' + parts.map((v) => Math.round(v * QUANT) | 0).join(',')
    const list = records.get(group)
    if (list) list.push(quantized)
    else records.set(group, [quantized])
  }

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh & {
      isInstancedMesh?: boolean
      isPoints?: boolean
      count?: number
      instanceMatrix?: THREE.BufferAttribute
      instanceColor?: THREE.BufferAttribute | null
    }
    const drawable = (mesh as unknown as { isMesh?: boolean }).isMesh || mesh.isPoints
    if (!drawable || !mesh.geometry || isDynamic(mesh)) return

    const group = (findGroupName(mesh) ?? fallbackGroup(mesh.geometry)) as string
    const kind = geometryKey(mesh.geometry)

    if (mesh.isInstancedMesh && mesh.instanceMatrix) {
      const count = mesh.count ?? 0
      const m = mesh.instanceMatrix.array as Float32Array
      const c = mesh.instanceColor?.array as Float32Array | undefined
      for (let i = 0; i < count; i++) {
        const parts: number[] = []
        for (let k = 0; k < 16; k++) parts.push(m[i * 16 + k])
        if (c) for (let k = 0; k < 3; k++) parts.push(c[i * 3 + k])
        push(group, parts, kind)
      }
    } else if ((mesh.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) {
      const geo = mesh.geometry as THREE.InstancedBufferGeometry
      const names = Object.keys(geo.attributes)
        .filter((n) => (geo.attributes[n] as THREE.InstancedBufferAttribute).isInstancedBufferAttribute)
        .sort()
      for (let i = 0; i < geo.instanceCount; i++) {
        const parts: number[] = []
        for (const n of names) {
          const attr = geo.attributes[n] as THREE.BufferAttribute
          const arr = attr.array as Float32Array
          for (let k = 0; k < attr.itemSize; k++) parts.push(arr[i * attr.itemSize + k])
        }
        push(group, parts, kind + '{' + names.join(',') + '}')
      }
    } else if (mesh.userData?.seedTable) {
      const seeds = mesh.userData.seedTable as Float32Array
      push(group, Array.from(seeds), kind + '{seedTable}')
    } else if (mesh.isPoints) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      push(group, Array.from(pos.array as Float32Array), kind + '{points}')
    } else {
      mesh.updateWorldMatrix(false, false)
      push(group, Array.from(mesh.matrixWorld.elements), kind)
    }
  })

  const groups: Record<string, string> = {}
  const counts: Record<string, number> = {}
  const totalDigest = new Digest()
  for (const name of [...records.keys()].sort()) {
    const list = records.get(name)!
    // Sorted as a SET: which mesh an instance came out of, and in what order,
    // is exactly the information a partition changes and this must not see.
    list.sort()
    const d = new Digest()
    d.pushText(name)
    // The count rides inside the hash too, so a split that drops or
    // duplicates an instance cannot come out looking identical.
    d.push(list.length)
    for (const rec of list) d.pushText(rec)
    groups[name] = d.hex
    counts[name] = list.length
    totalDigest.pushText(name).pushText(d.hex)
  }

  return {
    scenario,
    canonical: isCanonicalScenario(scenario),
    groups,
    counts,
    total: totalDigest.hex,
    untagged: Object.keys(groups).filter((g) => g.startsWith('untagged:')),
  }
}

/** The nearest declared group name, walking up parents so tagging a group covers its children. */
function findGroupName(obj: THREE.Object3D): string | null {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    const name = o.userData?.semanticGroup
    if (typeof name === 'string') return name
  }
  return null
}

/** Names the groups whose contents differ — "did sectorising move anything?" in one line. */
export function semanticDiff(a: SemanticFingerprint, b: SemanticFingerprint): string[] {
  const names = new Set([...Object.keys(a.groups), ...Object.keys(b.groups)])
  return [...names].filter((n) => a.groups[n] !== b.groups[n]).sort()
}

/**
 * Names the parts that differ between two fingerprints — the readable form of
 * "changing the vegetation must not move the city".
 */
export function fingerprintDiff(a: WorldFingerprint, b: WorldFingerprint): string[] {
  const keys = new Set([...Object.keys(a.parts), ...Object.keys(b.parts)])
  return [...keys].filter((k) => a.parts[k] !== b.parts[k]).sort()
}
