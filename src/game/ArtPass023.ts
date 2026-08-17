import * as THREE from 'three'
import type { Track } from './Track'
import { PLATFORM_GEOM } from './City'
import { worldStream } from './Rng'
import type { Season } from './Seasons'
import { tagGroup } from './worldHash'
import {
  artFrameAt,
  artStationFrame,
  artStationSide,
  artTrianglesOf,
  GeometryBatch,
  makeArtMaterial,
  type ArtBatchKind,
} from './ArtKit'
import { enforceArt023Budget, type Art023Report } from './art023Contract'

/**
 * 0.2.3 green vertical slice: Nishiki's close market opens into Nara.
 *
 * It replaces Nara's twenty loose legacy tree meshes with four fused batches:
 * the essential station shell, a non-shadow-casting park edge, amber practicals
 * and a winter overlay. Nothing here allocates or rebuilds during update().
 */

const NISHIKI = 3
const NARA = 4
const SIDE = artStationSide(NARA)
const BAY = 14
const STATION_LEN = PLATFORM_GEOM.len
const INNER = PLATFORM_GEOM.inner
const OUTER = PLATFORM_GEOM.outer
const MID = (INNER + OUTER) / 2

const P = {
  timber: 0x3b2b20,
  timberWarm: 0x634633,
  plaster: 0xd7c9aa,
  stone: 0x77766e,
  stoneDark: 0x535952,
  kawara: 0x2e3b3b,
  green: 0x486b43,
  greenDark: 0x294b35,
  moss: 0x71864f,
  deer: 0x8b6746,
  deerDark: 0x4e392b,
  warm: 0xffbd68,
} as const

function sx(x: number) {
  return SIDE * x
}

function addNaraStation(
  opaque: GeometryBatch,
  lights: GeometryBatch,
  snow: GeometryBatch,
  frame: THREE.Matrix4,
) {
  // Five honest structural bays keep the 70 m railway scale. Stone bases,
  // timber posts and deep eaves are the hierarchy; ornament stays secondary.
  for (let bay = 0; bay < 5; bay++) {
    const z = -STATION_LEN / 2 + BAY / 2 + bay * BAY
    for (const x of [INNER + 1.55, OUTER - 0.65]) {
      opaque.box(frame, [sx(x), 1.4, z], [0.82, 0.4, 0.86], P.stone)
      opaque.box(frame, [sx(x), 3.95, z], [0.44, 4.7, 0.46], P.timber)
    }
    opaque.box(frame, [sx(MID), 6.18, z], [12.9, 0.34, 0.38], P.timberWarm)
    opaque.box(frame, [sx(MID), 5.82, z], [11.6, 0.16, 0.18], P.timber)
    // Rafter ends are broad enough to read in motion and are baked into the
    // same station draw instead of becoming repeated child meshes.
    for (const x of [2.0, 4.6, 7.2, 9.8, 12.4, 15.0]) {
      opaque.box(frame, [sx(x), 6.48, z], [0.16, 0.16, BAY - 0.35], P.timber)
    }
    lights.box(frame, [sx(7.1), 5.92, z - 3.7], [2.4, 0.1, 0.22], P.warm)
    lights.box(frame, [sx(7.1), 5.92, z + 3.7], [2.4, 0.1, 0.22], P.warm)
  }

  // Wide paired kawara planes hide the generic flat canopy without sharing
  // its plane. A shorter raised roof over the middle forms the Nara-specific
  // irimoya-like silhouette: low, open, but unmistakable from the cab.
  opaque.box(frame, [sx(5.0), 7.64, 0], [8.4, 0.28, 72.4], P.kawara, [0, 0, SIDE * 0.22])
  opaque.box(frame, [sx(12.8), 7.64, 0], [8.4, 0.28, 72.4], P.kawara, [0, 0, -SIDE * 0.22])
  opaque.cylinder(frame, [sx(8.9), 8.56, 0], [0.34, 72.9, 0.34], P.kawara, 8, [Math.PI / 2, 0, 0])
  opaque.box(frame, [sx(6.65), 9.02, 2], [5.0, 0.25, 31], P.kawara, [0, 0, SIDE * 0.27])
  opaque.box(frame, [sx(11.15), 9.02, 2], [5.0, 0.25, 31], P.kawara, [0, 0, -SIDE * 0.27])
  opaque.cylinder(frame, [sx(8.9), 9.7, 2], [0.27, 31.4, 0.27], P.kawara, 8, [Math.PI / 2, 0, 0])
  snow.box(frame, [sx(5.0), 7.8, 0], [8.1, 0.035, 72.0], 0xe9eef0, [0, 0, SIDE * 0.22])
  snow.box(frame, [sx(12.8), 7.8, 0], [8.1, 0.035, 72.0], 0xe9eef0, [0, 0, -SIDE * 0.22])
  snow.box(frame, [sx(6.65), 9.17, 2], [4.76, 0.035, 30.7], 0xf1f3f1, [0, 0, SIDE * 0.27])
  snow.box(frame, [sx(11.15), 9.17, 2], [4.76, 0.035, 30.7], 0xf1f3f1, [0, 0, -SIDE * 0.27])

  // An open waiting pavilion and timetable: enough human scale for a real
  // railway stop, deliberately no torii, pagoda or platform shrine dressing.
  opaque.box(frame, [sx(11.7), 1.55, 11], [4.8, 0.7, 15.5], P.stoneDark)
  for (const z of [4.2, 10.9, 17.7]) {
    opaque.box(frame, [sx(13.8), 3.45, z], [0.3, 3.45, 0.32], P.timber)
    opaque.box(frame, [sx(9.6), 3.45, z], [0.3, 3.45, 0.32], P.timber)
  }
  opaque.box(frame, [sx(11.7), 5.22, 11], [5.2, 0.24, 15.8], P.timberWarm)
  opaque.box(frame, [sx(13.95), 3.45, 11], [0.18, 2.9, 12.0], P.plaster)
  for (const z of [6.2, 8.1, 10, 11.9, 13.8, 15.7]) {
    opaque.box(frame, [sx(9.42), 3.25, z], [0.16, 2.7, 0.13], P.timber)
  }
  opaque.box(frame, [sx(9.38), 2.05, 11], [0.16, 0.13, 11.8], P.timber)
  opaque.box(frame, [sx(9.38), 3.1, 11], [0.16, 0.13, 11.8], P.timber)
  opaque.box(frame, [sx(7.2), 2.05, -15], [3.6, 0.28, 0.85], P.timberWarm)
  opaque.box(frame, [sx(7.2), 3.35, -15], [3.2, 1.85, 0.18], P.plaster)
  opaque.box(frame, [sx(7.2), 4.36, -15], [3.5, 0.18, 0.25], P.timber)
}

function addStoneLantern(batch: GeometryBatch, frame: THREE.Matrix4, z: number, scale = 1) {
  batch.box(frame, [0, 0.22 * scale, z], [0.9 * scale, 0.44 * scale, 0.9 * scale], P.stoneDark)
  batch.cylinder(frame, [0, 1.05 * scale, z], [0.38 * scale, 1.45 * scale, 0.38 * scale], P.stone, 8)
  batch.box(frame, [0, 1.78 * scale, z], [1.18 * scale, 0.22 * scale, 1.18 * scale], P.stone)
  batch.box(frame, [0, 2.18 * scale, z], [0.76 * scale, 0.65 * scale, 0.76 * scale], P.stoneDark)
  batch.box(frame, [0, 2.58 * scale, z], [1.28 * scale, 0.18 * scale, 1.28 * scale], P.stone)
  batch.box(frame, [0, 2.79 * scale, z], [0.28 * scale, 0.28 * scale, 0.28 * scale], P.stoneDark)
}

function addDeer(batch: GeometryBatch, frame: THREE.Matrix4, z: number, flip: 1 | -1, scale = 1) {
  batch.box(frame, [0, 1.32 * scale, z], [1.65 * scale, 0.82 * scale, 0.68 * scale], P.deer)
  batch.box(frame, [flip * 0.68 * scale, 1.82 * scale, z], [0.42 * scale, 1.15 * scale, 0.42 * scale], P.deer, [0, 0, -flip * 0.28])
  batch.box(frame, [flip * 0.98 * scale, 2.35 * scale, z], [0.7 * scale, 0.48 * scale, 0.48 * scale], P.deer)
  for (const x of [-0.55, 0.5]) {
    batch.cylinder(frame, [x * scale, 0.65 * scale, z - 0.2 * scale], [0.13 * scale, 1.25 * scale, 0.13 * scale], P.deerDark, 6)
    batch.cylinder(frame, [x * scale, 0.65 * scale, z + 0.2 * scale], [0.13 * scale, 1.25 * scale, 0.13 * scale], P.deerDark, 6)
  }
  batch.box(frame, [-flip * 0.9 * scale, 1.55 * scale, z], [0.52 * scale, 0.18 * scale, 0.22 * scale], P.deerDark, [0, 0, flip * 0.45])
}

function buildNaraEdge(opaque: GeometryBatch, lights: GeometryBatch, snow: GeometryBatch, track: Track) {
  const rng = worldStream('art023-nara-edge')
  const a = track.markerFor(NISHIKI).tFraction
  const b = track.markerFor(NARA).tFraction
  const span = ((b - a + 1) % 1) || 0.01

  // A short authored park edge occupies only the middle of the 600 m link.
  // Both station footprints and the final approach into Nara remain empty.
  for (let i = 0; i < 7; i++) {
    const t = (a + span * (0.25 + 0.34 * ((i + 0.5) / 7))) % 1
    const frame = artFrameAt(track, t, SIDE * (16.8 + (i % 2) * 0.7), (rng() - 0.5) * 0.05)
    opaque.box(frame, [0, 0.3, 0], [0.7, 0.6, 9.8], P.stoneDark)
    for (const z of [-4.35, 0, 4.35]) {
      opaque.box(frame, [0, 1.35, z], [0.28, 1.9, 0.3], P.timber)
    }
    opaque.box(frame, [0, 1.85, 0], [0.25, 0.18, 9.1], P.timberWarm)
    opaque.box(frame, [0, 1.16, 0], [0.18, 0.13, 9.1], P.timber)
  }

  // Six low-poly cedars replace the ten two-mesh legacy lollipops. Layered
  // faceted crowns hold a vertical rhythm while leaving most of the sky open.
  for (let i = 0; i < 6; i++) {
    const t = (a + span * (0.27 + 0.29 * ((i + 0.5) / 6))) % 1
    const frame = artFrameAt(track, t, SIDE * (26 + rng() * 10), (rng() - 0.5) * 0.2)
    const h = 7.5 + rng() * 3.8
    opaque.cylinder(frame, [0, h * 0.36, 0], [0.55, h * 0.72, 0.55], P.timber, 8)
    opaque.cylinder(frame, [0, h * 0.64, 0], [4.3, h * 0.34, 4.3], P.greenDark, 8)
    opaque.cylinder(frame, [0, h * 0.82, 0], [3.05, h * 0.3, 3.05], P.green, 8)
    opaque.cylinder(frame, [0, h * 0.98, 0], [1.8, h * 0.24, 1.8], P.moss, 8)
    snow.cylinder(frame, [0, h * 1.075, 0], [1.45, 0.16, 1.45], 0xe7ecec, 8)
  }

  for (let i = 0; i < 4; i++) {
    const t = (a + span * (0.3 + i * 0.075)) % 1
    const frame = artFrameAt(track, t, SIDE * 21.5)
    addStoneLantern(opaque, frame, 0, 0.82 + (i % 2) * 0.08)
    lights.box(frame, [0, 1.95, 0], [0.5, 0.38, 0.5], P.warm)
    snow.box(frame, [0, 2.42, 0], [0.92, 0.08, 0.92], 0xe9eeee)
  }

  // Deer stay behind the fence and entirely outside the railway/platform
  // footprint. Their static silhouettes cost no animation or update work.
  for (const [i, flip] of ([1, -1, 1] as const).entries()) {
    const t = (a + span * (0.32 + i * 0.095)) % 1
    const frame = artFrameAt(track, t, SIDE * (23.5 + (i % 2) * 1.5), (rng() - 0.5) * 0.16)
    addDeer(opaque, frame, 0, flip, 0.86 + i * 0.06)
  }
}

export type ArtPass023Report = Art023Report

export class ArtPass023 {
  readonly report: ArtPass023Report
  private readonly snowMeshes: THREE.Mesh[] = []
  private readonly lightMaterials: THREE.MeshStandardMaterial[] = []

  constructor(scene: THREE.Scene, track: Track) {
    const stationOpaque = new GeometryBatch()
    const edgeOpaque = new GeometryBatch()
    const lights = new GeometryBatch()
    const snow = new GeometryBatch()

    addNaraStation(stationOpaque, lights, snow, artStationFrame(track, NARA))
    buildNaraEdge(edgeOpaque, lights, snow, track)

    let meshes = 0
    let triangles = 0
    const finish = (name: string, kind: ArtBatchKind, batch: GeometryBatch, castShadow: boolean) => {
      const geometry = batch.finish()
      if (!geometry) return
      const material = makeArtMaterial(kind)
      const mesh = tagGroup(new THREE.Mesh(geometry, material), `art023-nara-${name}`)
      mesh.castShadow = castShadow
      mesh.receiveShadow = kind === 'opaque' || kind === 'snow'
      if (kind === 'snow') {
        mesh.visible = false
        this.snowMeshes.push(mesh)
      }
      if (kind === 'light') this.lightMaterials.push(material)
      scene.add(mesh)
      meshes++
      triangles += artTrianglesOf(geometry)
    }

    finish('station-opaque', 'opaque', stationOpaque, true)
    finish('edge-opaque', 'opaque', edgeOpaque, false)
    finish('light', 'light', lights, false)
    finish('snow', 'snow', snow, false)

    this.report = {
      family: 'green',
      stations: ['nara'],
      meshes,
      triangles,
      designDrawsDay: meshes - this.snowMeshes.length,
      designDrawsWinter: meshes,
      textures: 0,
      lights: 0,
      legacyMeshesReplaced: 20,
    }
    enforceArt023Budget(
      this.report,
      import.meta.env.DEV,
      (message) => console.error(`[ArtPass023] PRESUPUESTO EXCEDIDO; producción continúa: ${message}`),
    )
    if (import.meta.env?.DEV) console.info(`[ArtPass023] ${JSON.stringify(this.report)}`)
  }

  setSeason(season: Season) {
    const winter = season === 'winter'
    for (const mesh of this.snowMeshes) mesh.visible = winter
  }

  update(nightFactor: number) {
    const glow = 0.12 + THREE.MathUtils.smoothstep(nightFactor, 0.08, 0.82) * 0.9
    for (const material of this.lightMaterials) material.emissiveIntensity = glow
  }
}
