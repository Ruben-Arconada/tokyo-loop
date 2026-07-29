import * as THREE from 'three'

/**
 * Cuts the ring's instanced pools into angular sectors so the frustum can
 * throw most of them away.
 *
 * ── Why there is anything to win here ───────────────────────────────────────
 * Measured in the cab at Yokohama: 89 InstancedMeshes, 28,720 instances,
 * 663k triangles — and 78 of the 89 pools drawn IN FULL. Frustum culling is
 * on and works correctly; the problem is that it has nothing to bite on. Each
 * pool spans the entire 12,675-unit loop, so its bounding sphere encloses the
 * whole world and always intersects the frustum. The camera sees perhaps a
 * quarter of the ring and pays for all of it.
 *
 * ── How this is done, and why it is done LAST ───────────────────────────────
 * As a post-pass over a finished scene, not as a change to sixty-odd build
 * sites. Every pool is read back, its instances bucketed by angle around the
 * loop's centre, and the mesh replaced by N smaller ones sharing the same
 * geometry and material. That keeps the change reversible, keeps every builder
 * untouched, and means the experiment can be switched off entirely.
 *
 * ── The contract this must not break ────────────────────────────────────────
 * `AGENTS.md` is explicit: the SEMANTIC hash must come out identical and the
 * structural one will change, and that is correct. The semantic fingerprint
 * groups instances by the name the builder declared, sorts them as a SET and
 * digests the count — so every sector piece MUST inherit its parent's
 * `semanticGroup`, and `test/worldHash.test.ts` already fixes exactly that
 * property for 1, 2 and 8 sectors, contiguous and round-robin.
 *
 * What this deliberately does NOT touch is written down in `skipped`: anything
 * that is not a plain InstancedMesh. `Points`, `Line` and InstancedBufferGeometry
 * (the sakura cards) are digested by the world hash as ONE record holding the
 * whole buffer, so partitioning them WOULD move the semantic hash. They have to
 * be flattened first, and that is a separate job.
 */

export interface SectorizeOptions {
  /** How many angular sectors. 1 disables the pass entirely. */
  sectors: number
  /** Pools smaller than this are left alone — splitting them costs more in draw calls than it saves. */
  minInstances?: number
  /**
   * Pools whose instances all sit within this radius are LOCAL already, so
   * culling handles them and cutting them up would only add draw calls.
   */
  minSpanRadius?: number
}

export interface SectorizeReport {
  sectors: number
  /** Pools that were cut, and into how many live pieces. */
  split: { group: string; instances: number; pieces: number }[]
  /** Pools left whole, with the reason. */
  skipped: { group: string; reason: string; instances: number }[]
  meshesBefore: number
  meshesAfter: number
  instancesMoved: number
}

const M = new THREE.Matrix4()

/** Angular sector of a world position, measured around the loop's centre. */
function sectorOf(x: number, z: number, sectors: number): number {
  const a = Math.atan2(z, x) + Math.PI // 0..2π
  const s = Math.floor((a / (Math.PI * 2)) * sectors)
  return Math.min(sectors - 1, Math.max(0, s))
}

export function sectorizeWorld(scene: THREE.Scene, opts: SectorizeOptions): SectorizeReport {
  const sectors = Math.max(1, Math.floor(opts.sectors))
  const minInstances = opts.minInstances ?? 24
  const minSpanRadius = opts.minSpanRadius ?? 600

  const report: SectorizeReport = { sectors, split: [], skipped: [], meshesBefore: 0, meshesAfter: 0, instancesMoved: 0 }
  if (sectors === 1) return report

  // Collect first: replacing meshes while traversing the tree they live in is
  // how you silently skip half of them.
  const pools: THREE.InstancedMesh[] = []
  scene.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) pools.push(o as THREE.InstancedMesh)
  })
  report.meshesBefore = pools.length

  for (const mesh of pools) {
    const group = (mesh.userData.semanticGroup as string | undefined) ?? ''
    const n = mesh.count

    if (mesh.userData.dynamic) {
      report.skipped.push({ group: group || '(dynamic)', reason: 'dinámico: lo coloca la simulación, no la semilla', instances: n })
      report.meshesAfter++
      continue
    }
    if (!group) {
      // Untagged means the semantic hash cannot follow it across the cut.
      report.skipped.push({ group: '(sin tagGroup)', reason: 'sin nombre semántico: el hash no puede seguirlo al partirlo', instances: n })
      report.meshesAfter++
      continue
    }
    if (n < minInstances) {
      report.skipped.push({ group, reason: `sólo ${n} instancias`, instances: n })
      report.meshesAfter++
      continue
    }

    // Read the instances once.
    const mats = new Float32Array(n * 16)
    mats.set(mesh.instanceMatrix.array.subarray(0, n * 16))
    const colors = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array.subarray(0, n * 3)) : null

    // How far apart do they actually sit? A pool that is already local gains
    // nothing from being cut and pays a draw call for the privilege.
    let cx = 0
    let cz = 0
    for (let i = 0; i < n; i++) {
      cx += mats[i * 16 + 12]
      cz += mats[i * 16 + 14]
    }
    cx /= n
    cz /= n
    let span = 0
    for (let i = 0; i < n; i++) {
      const dx = mats[i * 16 + 12] - cx
      const dz = mats[i * 16 + 14] - cz
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > span) span = d
    }
    if (span < minSpanRadius) {
      report.skipped.push({ group, reason: `ya es local (radio ${span.toFixed(0)})`, instances: n })
      report.meshesAfter++
      continue
    }

    // Bucket by angle.
    const buckets: number[][] = Array.from({ length: sectors }, () => [])
    for (let i = 0; i < n; i++) buckets[sectorOf(mats[i * 16 + 12], mats[i * 16 + 14], sectors)].push(i)

    const parent = mesh.parent!
    let pieces = 0
    for (let s = 0; s < sectors; s++) {
      const idx = buckets[s]
      if (idx.length === 0) continue
      const piece = new THREE.InstancedMesh(mesh.geometry, mesh.material, idx.length)
      for (let k = 0; k < idx.length; k++) {
        M.fromArray(mats, idx[k] * 16)
        piece.setMatrixAt(k, M)
      }
      piece.instanceMatrix.needsUpdate = true
      if (colors) {
        piece.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(idx.length * 3), 3)
        for (let k = 0; k < idx.length; k++) {
          piece.instanceColor.setXYZ(k, colors[idx[k] * 3], colors[idx[k] * 3 + 1], colors[idx[k] * 3 + 2])
        }
        piece.instanceColor.needsUpdate = true
      }
      piece.castShadow = mesh.castShadow
      piece.receiveShadow = mesh.receiveShadow
      piece.renderOrder = mesh.renderOrder
      piece.visible = mesh.visible
      // Same name, so the semantic fingerprint gathers the pieces back into
      // one set and comes out unchanged. This line IS the contract.
      piece.userData = { ...mesh.userData }
      piece.name = mesh.name ? `${mesh.name}#${s}` : ''
      parent.add(piece)
      pieces++
    }

    parent.remove(mesh)
    // Geometry and material are shared with the pieces — disposing them here
    // would take the pieces down with them. Only the per-instance buffers die.
    mesh.dispose()

    report.split.push({ group, instances: n, pieces })
    report.meshesAfter += pieces
    report.instancesMoved += n
  }

  return report
}

/** Reads `?sectors=N` from the URL. 1 (off) unless asked for. */
export function requestedSectors(): number {
  const raw = new URLSearchParams(window.location.search).get('sectors')
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 && n <= 32 ? n : 1
}
