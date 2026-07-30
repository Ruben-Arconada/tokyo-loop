import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Track } from './Track'
import { groundHeightAt } from './Track'
import { STATIONS } from '../data/stations'
import { worldStream } from './Rng'
import { tagGroup } from './worldHash'
import type { Season } from './Seasons'
import { assertStaticArtBudget, type Art021StaticReport } from './art021Contract'

/**
 * 0.2.1 visual vertical slice.
 *
 * Susukino (dense/urban) and Nishiki (quiet/market) deliberately sit beside
 * each other on the loop. The pair is the art pipeline's proof that a district
 * can change its architecture — not merely its tint or its building height.
 *
 * Everything here is authored from reusable hard-surface modules, then merged
 * by material. A whole station is three draws (opaque/glass/light); a whole
 * near-track neighbourhood is two (opaque/light). Distant procedural dressing
 * remains the cheap backdrop it is good at being.
 */

const SUSUKINO = 2
const NISHIKI = 3
const PLATFORM_INNER = 3
const PLATFORM_OUTER = 14
const PLATFORM_MID = (PLATFORM_INNER + PLATFORM_OUTER) / 2
const STATION_LEN = 70
const BAY = 14

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_CYLINDER_6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)
const UNIT_CYLINDER_8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8)

type BatchKind = 'opaque' | 'glass' | 'light' | 'snow'

class GeometryBatch {
  private geometries: THREE.BufferGeometry[] = []
  private readonly dummy = new THREE.Object3D()
  private readonly world = new THREE.Matrix4()

  get empty() {
    return this.geometries.length === 0
  }

  add(
    base: THREE.BufferGeometry,
    parent: THREE.Matrix4,
    position: THREE.Vector3,
    scale: THREE.Vector3,
    color: number,
    rotation = new THREE.Euler(),
  ) {
    this.dummy.position.copy(position)
    this.dummy.scale.copy(scale)
    this.dummy.rotation.copy(rotation)
    this.dummy.updateMatrix()
    this.world.multiplyMatrices(parent, this.dummy.matrix)

    const geometry = base.clone()
    geometry.applyMatrix4(this.world)
    const count = geometry.getAttribute('position').count
    const c = new THREE.Color(color)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.geometries.push(geometry)
  }

  box(
    parent: THREE.Matrix4,
    xyz: [number, number, number],
    scale: [number, number, number],
    color: number,
    rotation?: [number, number, number],
  ) {
    this.add(
      UNIT_BOX,
      parent,
      new THREE.Vector3(...xyz),
      new THREE.Vector3(...scale),
      color,
      rotation ? new THREE.Euler(...rotation) : undefined,
    )
  }

  cylinder(
    parent: THREE.Matrix4,
    xyz: [number, number, number],
    scale: [number, number, number],
    color: number,
    sides: 6 | 8 = 8,
    rotation?: [number, number, number],
  ) {
    this.add(
      sides === 6 ? UNIT_CYLINDER_6 : UNIT_CYLINDER_8,
      parent,
      new THREE.Vector3(...xyz),
      new THREE.Vector3(...scale),
      color,
      rotation ? new THREE.Euler(...rotation) : undefined,
    )
  }

  finish() {
    if (this.geometries.length === 0) return null
    const merged = mergeGeometries(this.geometries, false)
    if (!merged) throw new Error('ArtPass021: incompatible geometry batch')
    for (const g of this.geometries) g.dispose()
    this.geometries.length = 0
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
  }
}

interface Palette {
  structure: number
  structure2: number
  wall: number
  wall2: number
  roof: number
  accent: number
  warm: number
}

const URBAN: Palette = {
  structure: 0x1b2026,
  structure2: 0x354047,
  wall: 0x596068,
  wall2: 0x837c72,
  roof: 0x243b34,
  accent: 0x9b376d,
  warm: 0xffc46a,
}

const MARKET: Palette = {
  structure: 0x30261f,
  structure2: 0x5c4432,
  wall: 0xc4b49a,
  wall2: 0x82705d,
  roof: 0x31383c,
  accent: 0xa34032,
  warm: 0xffc76c,
}

function frameAt(track: Track, t: number, sideOffset = 0, yaw = 0) {
  const p = track.pointAt(t)
  const tangent = track.tangentAt(t)
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  const pos = p.clone().addScaledVector(normal, sideOffset)
  const obj = new THREE.Object3D()
  obj.position.set(pos.x, sideOffset === 0 ? p.y : groundHeightAt(p.y, sideOffset), pos.z)
  obj.lookAt(obj.position.clone().add(tangent))
  obj.rotateY(yaw)
  obj.updateMatrixWorld(true)
  return obj.matrixWorld.clone()
}

function stationFrame(track: Track, stationIndex: number) {
  const marker = track.markerFor(stationIndex)
  return frameAt(track, marker.tFraction)
}

function stationSide(stationIndex: number) {
  return STATIONS[stationIndex].doorSide === 'left' ? 1 : -1
}

function addCrossBraces(batch: GeometryBatch, frame: THREE.Matrix4, x: number, z: number, color: number, side: number) {
  batch.box(frame, [x, 4.55, z], [0.13, 3.1, 0.13], color, [0, 0, side * 0.67])
  batch.box(frame, [x, 4.55, z], [0.13, 3.1, 0.13], color, [0, 0, -side * 0.67])
}

function addSusukinoStation(batches: Record<BatchKind, GeometryBatch>, frame: THREE.Matrix4) {
  const side = stationSide(SUSUKINO)
  const sx = (x: number) => side * x

  // Five explicitly repeated structural bays: the reference scale is encoded
  // here, not inferred from a little diorama.
  for (let bay = 0; bay < 5; bay++) {
    const z = -STATION_LEN / 2 + BAY / 2 + bay * BAY
    for (const x of [PLATFORM_INNER + 2.1, PLATFORM_OUTER - 0.75]) {
      batches.opaque.box(frame, [sx(x), 3.72, z], [0.48, 5.04, 0.58], URBAN.structure)
      batches.opaque.box(frame, [sx(x), 1.5, z], [0.75, 0.28, 0.85], URBAN.structure2)
    }
    batches.opaque.box(frame, [sx(PLATFORM_MID), 6.28, z], [12.8, 0.24, 0.28], URBAN.structure2)
    addCrossBraces(batches.opaque, frame, sx(PLATFORM_OUTER - 2.2), z, URBAN.structure2, side)

    // A folded canopy gives the station a silhouette from 300 m away. The old
    // flat roof remains below as waterproof backing, completely hidden here.
    batches.opaque.box(frame, [sx(5.1), 6.62, z], [7.0, 0.22, BAY - 0.18], URBAN.roof, [0, 0, side * 0.065])
    batches.opaque.box(frame, [sx(11.7), 6.72, z], [7.0, 0.22, BAY - 0.18], URBAN.roof, [0, 0, -side * 0.045])
    batches.snow.box(frame, [sx(5.1), 6.76, z], [6.8, 0.035, BAY - 0.28], 0xe7edf1, [0, 0, side * 0.065])
    batches.snow.box(frame, [sx(11.7), 6.86, z], [6.8, 0.035, BAY - 0.28], 0xe7edf1, [0, 0, -side * 0.045])

    // Under-canopy services read as a real place rather than an empty slab.
    batches.light.box(frame, [sx(7.2), 5.9, z - 3.8], [2.8, 0.1, 0.18], URBAN.warm)
    batches.light.box(frame, [sx(7.2), 5.9, z + 3.8], [2.8, 0.1, 0.18], URBAN.warm)
  }

  // Enclosed waiting room: set just outside the canopy footprint. The CCTV
  // mount lives at x=12.2,z=-22 and looks diagonally inward; placing this at
  // the old x=10.65 put the camera literally behind its wall.
  batches.opaque.box(frame, [sx(17.3), 1.55, -7], [5.2, 0.7, 12.0], URBAN.structure2)
  batches.opaque.box(frame, [sx(17.3), 4.85, -7], [5.4, 0.24, 12.2], URBAN.structure)
  for (const z of [-12.6, -9.8, -7, -4.2, -1.4]) {
    batches.opaque.box(frame, [sx(14.69), 3.1, z], [0.16, 3.1, 0.16], URBAN.structure)
    batches.opaque.box(frame, [sx(19.91), 3.1, z], [0.16, 3.1, 0.16], URBAN.structure)
  }
  batches.glass.box(frame, [sx(14.73), 3.05, -7], [0.06, 2.75, 11.2], 0xa9ced2)
  batches.glass.box(frame, [sx(19.87), 3.05, -7], [0.06, 2.75, 11.2], 0xa9ced2)

  // Full-height station access at the departure end: the vertical counterform
  // prevents all thirty stations from being the same horizontal canopy.
  batches.opaque.box(frame, [sx(18.2), 4.2, 27.5], [7.0, 8.4, 10.0], URBAN.wall)
  batches.opaque.box(frame, [sx(18.2), 8.65, 27.5], [7.8, 0.5, 10.8], URBAN.roof)
  batches.opaque.box(frame, [sx(14.55), 4.3, 27.5], [0.35, 7.2, 8.4], URBAN.structure)
  for (let floor = 0; floor < 3; floor++) {
    batches.glass.box(frame, [sx(14.34), 2.35 + floor * 2.05, 27.5], [0.08, 1.25, 6.9], 0x9fb8bc)
  }
  batches.light.box(frame, [sx(14.24), 6.9, 27.5], [0.08, 0.65, 5.5], URBAN.accent)
}

function addNishikiStation(batches: Record<BatchKind, GeometryBatch>, frame: THREE.Matrix4) {
  const side = stationSide(NISHIKI)
  const sx = (x: number) => side * x
  const roofAngle = 0.12

  for (let bay = 0; bay < 5; bay++) {
    const z = -STATION_LEN / 2 + BAY / 2 + bay * BAY
    for (const x of [PLATFORM_INNER + 2.0, PLATFORM_OUTER - 0.7]) {
      batches.opaque.box(frame, [sx(x), 3.7, z], [0.5, 5.0, 0.5], MARKET.structure2)
      batches.opaque.box(frame, [sx(x), 1.52, z], [0.8, 0.3, 0.8], MARKET.structure)
      batches.opaque.box(frame, [sx(x), 5.1, z], [0.18, 2.7, 0.18], MARKET.structure, [0, 0, side * 0.55])
    }
    batches.opaque.box(frame, [sx(PLATFORM_MID), 6.2, z], [13.2, 0.34, 0.36], MARKET.structure)

    // Paired tile planes form a long kirizuma roof. Broad eaves, visible
    // rafters and a ridge cap do the Japanese work through silhouette.
    batches.opaque.box(frame, [sx(5.2), 6.72, z], [7.2, 0.25, BAY + 0.5], MARKET.roof, [0, 0, side * roofAngle])
    batches.opaque.box(frame, [sx(11.8), 6.72, z], [7.2, 0.25, BAY + 0.5], MARKET.roof, [0, 0, -side * roofAngle])
    batches.opaque.cylinder(frame, [sx(8.5), 7.15, z], [0.28, BAY + 0.6, 0.28], MARKET.structure, 8, [Math.PI / 2, 0, 0])
    batches.snow.box(frame, [sx(5.2), 6.87, z], [7.0, 0.035, BAY + 0.25], 0xe8eceb, [0, 0, side * roofAngle])
    batches.snow.box(frame, [sx(11.8), 6.87, z], [7.0, 0.035, BAY + 0.25], 0xe8eceb, [0, 0, -side * roofAngle])

    for (const rz of [-5.2, -2.6, 0, 2.6, 5.2]) {
      batches.opaque.box(frame, [sx(PLATFORM_MID), 6.0, z + rz], [12.4, 0.13, 0.18], MARKET.structure2)
    }
    batches.light.box(frame, [sx(6.4), 5.25, z - 3.7], [0.48, 0.7, 0.48], MARKET.warm)
    batches.opaque.box(frame, [sx(6.4), 5.65, z - 3.7], [0.56, 0.12, 0.56], MARKET.structure)
  }

  // Shoji-inspired waiting enclosure. Frosted, not transparent: it remains a
  // mobile-friendly plane and never asks the renderer to sort an interior.
  batches.opaque.box(frame, [sx(17.0), 1.6, -7], [5.0, 0.8, 11.0], MARKET.structure)
  batches.opaque.box(frame, [sx(17.0), 4.75, -7], [5.2, 0.25, 11.2], MARKET.roof)
  batches.glass.box(frame, [sx(14.48), 3.05, -7], [0.08, 2.45, 10.4], 0xd6d1bd)
  for (let z = -11.5; z <= -2.5; z += 1.5) {
    batches.opaque.box(frame, [sx(14.4), 3.05, z], [0.13, 2.6, 0.13], MARKET.structure2)
  }
  for (const y of [2.25, 3.05, 3.85]) {
    batches.opaque.box(frame, [sx(14.38), y, -7], [0.14, 0.1, 10.3], MARKET.structure2)
  }

  // A small machiya entrance building stitches the platform into the market
  // lane. It is architecture, not a freestanding landmark ornament.
  batches.opaque.box(frame, [sx(18), 3.1, 27.5], [8.0, 6.2, 10.0], MARKET.wall)
  batches.opaque.box(frame, [sx(18), 1.8, 22.35], [8.4, 2.3, 0.35], MARKET.structure2)
  for (let x = -3.2; x <= 3.2; x += 0.8) {
    batches.opaque.box(frame, [sx(18 + x), 2.2, 22.1], [0.12, 2.8, 0.16], MARKET.structure)
  }
  batches.opaque.box(frame, [sx(15.8), 6.45, 27.5], [4.8, 0.28, 10.8], MARKET.roof, [0, 0, side * 0.18])
  batches.opaque.box(frame, [sx(20.2), 6.45, 27.5], [4.8, 0.28, 10.8], MARKET.roof, [0, 0, -side * 0.18])
  batches.light.box(frame, [sx(13.8), 3.55, 23], [0.48, 0.72, 0.48], MARKET.warm)
  batches.light.box(frame, [sx(22.2), 3.55, 23], [0.48, 0.72, 0.48], MARKET.warm)
}

function addUrbanBuilding(
  opaque: GeometryBatch,
  lights: GeometryBatch,
  frame: THREE.Matrix4,
  side: number,
  variant: number,
  rng: () => number,
) {
  const w = 8 + rng() * 5
  const d = 8 + rng() * 8
  const h = 15 + rng() * 22
  const body = [0x68717b, 0x86766b, 0x526474, 0x8b8176][variant % 4]
  const dark = [0x252d34, 0x372d34, 0x263b3f][variant % 3]
  // frameAt's local +X points opposite the radial normal. A building placed
  // at `side * offset` therefore faces the track on `side * width/2`.
  // Getting this sign wrong hid every authored balcony on the back wall.
  const face = side * w / 2

  if (variant % 4 === 0) {
    opaque.box(frame, [0, h / 2, 0], [w, h, d], body)
    opaque.box(frame, [side * 0.8, h + 2.4, 0], [w * 0.72, 4.8, d * 0.72], dark)
  } else if (variant % 4 === 1) {
    opaque.box(frame, [0, h * 0.32, 0], [w * 1.18, h * 0.64, d], body)
    opaque.box(frame, [side * 0.7, h * 0.78, 0], [w * 0.72, h * 0.92, d * 0.82], dark)
  } else if (variant % 4 === 2) {
    opaque.box(frame, [0, h / 2, -d * 0.22], [w, h, d * 0.58], body)
    opaque.box(frame, [side * 0.9, h * 0.42, d * 0.28], [w * 0.72, h * 0.84, d * 0.46], dark)
  } else {
    opaque.box(frame, [0, h / 2, 0], [w, h, d], body)
    opaque.box(frame, [-side * w * 0.38, h * 0.56, d * 0.32], [w * 0.3, h * 0.56, d * 0.34], dark)
  }

  // Balcony slabs, escape stair and service hardware occupy the facade that
  // the driver actually sees. This is the near-track detail layer the old
  // single scaled cube could never supply.
  for (let y = 4.5; y < h - 1.5; y += 3.3) {
    opaque.box(frame, [face + side * 0.28, y, 0], [0.55, 0.16, d * 0.82], dark)
    lights.box(frame, [face + side * 0.31, y + 1.0, -d * 0.18], [0.08, 1.15, d * 0.22], rng() < 0.7 ? 0xffc77a : 0xa6c6d5)
    lights.box(frame, [face + side * 0.31, y + 1.0, d * 0.18], [0.08, 1.15, d * 0.22], rng() < 0.7 ? 0xffc77a : 0xa6c6d5)
    // A straight approach mostly sees the buildings' END walls, not their
    // track-facing long facade. Dress both ends or the authored city turns
    // back into blank cuboids from the driver's actual camera.
    for (const zFace of [-1, 1]) {
      for (const xBand of [-0.24, 0.24]) {
        lights.box(
          frame,
          [xBand * w, y + 1.0, zFace * (d / 2 + 0.035)],
          [w * 0.24, 1.15, 0.07],
          rng() < 0.68 ? 0xffc77a : 0xa6c6d5,
        )
      }
      // Deep balcony lips catch light and break the slab silhouette from the
      // driver's approach; hairline facade bands did not survive at 300 m.
      opaque.box(frame, [0, y - 0.45, zFace * (d / 2 + 0.23)], [w * 0.86, 0.14, 0.5], dark)
      opaque.box(frame, [-w * 0.4, y + 0.12, zFace * (d / 2 + 0.46)], [0.09, 1.0, 0.09], dark)
      opaque.box(frame, [w * 0.4, y + 0.12, zFace * (d / 2 + 0.46)], [0.09, 1.0, 0.09], dark)
    }
  }
  if (variant % 2 === 0) {
    for (let s = 0; s < 7; s++) {
      opaque.box(frame, [face + side * 0.48, 2.1 + s * 0.72, -d * 0.35 + s * d * 0.1], [0.65, 0.12, d * 0.25], 0x20252a)
    }
  }
  for (let a = 0; a < 2; a++) {
    opaque.box(frame, [face + side * 0.48, 2.2 + a * 2.6, d * (a ? 0.28 : -0.28)], [0.65, 0.55, 1.0], 0xa1a5a2)
  }
  // Street-level commerce: broad warm openings and a shallow coloured awning
  // are legible long before individual windows.
  lights.box(frame, [face + side * 0.38, 1.55, 0], [0.1, 2.35, d * 0.58], 0xffb96a)
  opaque.box(frame, [face + side * 0.62, 2.9, 0], [0.85, 0.16, d * 0.7], variant % 3 === 0 ? URBAN.accent : URBAN.roof)
  for (const zFace of [-1, 1]) {
    lights.box(frame, [-w * 0.18, 1.55, zFace * (d / 2 + 0.09)], [w * 0.3, 2.35, 0.08], 0xffb96a)
    lights.box(frame, [w * 0.18, 1.55, zFace * (d / 2 + 0.09)], [w * 0.3, 2.35, 0.08], variant % 2 ? 0xa9d4dc : 0xffc58a)
    opaque.box(frame, [0, 2.9, zFace * (d / 2 + 0.15)], [w * 0.78, 0.16, 0.3], variant % 3 === 0 ? URBAN.accent : URBAN.roof)
    if (variant % 3 === 0) {
      lights.box(
        frame,
        [w * 0.39, h * 0.55, zFace * (d / 2 + 0.2)],
        [0.72, Math.min(7.5, h * 0.42), 0.08],
        variant % 2 ? 0x49c5cf : URBAN.accent,
      )
    }
    if (variant % 4 === 2) {
      opaque.box(
        frame,
        [-w * 0.12, h * 0.45, zFace * (d / 2 + 0.5)],
        [w * 0.58, 0.16, 0.16],
        0x20252a,
        [0, 0, zFace * 0.55],
      )
    }
  }
  opaque.box(frame, [side * w * 0.18, h + 0.55, 0], [w * 0.28, 1.1, d * 0.32], dark)
  opaque.cylinder(frame, [-side * w * 0.22, h + 1.0, d * 0.2], [1.05, 2.0, 1.05], 0x9aa4a4, 8)
  opaque.box(frame, [0, h + 2.5, 0], [0.11, 3.8, 0.11], 0x30383d)
}

function buildUrbanEdge(opaque: GeometryBatch, lights: GeometryBatch, track: Track) {
  const rng = worldStream('art021-susukino-edge')
  const a = track.markerFor(1).tFraction
  const b = track.markerFor(SUSUKINO).tFraction
  const span = ((b - a + 1) % 1) || 0.02

  for (let i = 0; i < 22; i++) {
    const lane = rng() < 0.5 ? 1 : -1
    const jitter = (rng() - 0.5) * 0.018
    // Stop the authored row before the station's 70 m footprint. The old
    // 0.98 endpoint put the final tower around the fixed CCTV mount.
    const t = (a + span * (0.28 + 0.46 * ((i + 0.5) / 22) + jitter)) % 1
    // The authored row owns the near field: close enough for balconies and
    // fire stairs to sweep past the side window, still clear of the 14 m
    // platform envelope.
    const offset = lane * (15.8 + rng() * 7.2)
    const frame = frameAt(track, t, offset, (rng() - 0.5) * 0.18)
    addUrbanBuilding(opaque, lights, frame, lane, i, rng)
  }

  // A continuous service edge makes the city touch the railway. Without it,
  // even detailed facades still floated as isolated props on an empty lawn.
  // Every cabinet, guard and pipe is baked into the two existing district
  // draws.
  for (let i = 0; i < 15; i++) {
    const side = i % 3 === 0 ? -1 : 1
    const t = (a + span * (0.31 + 0.42 * ((i + 0.5) / 15))) % 1
    const frame = frameAt(track, t, side * (12.4 + (i % 2) * 1.2))
    opaque.box(frame, [0, 0.48, 0], [0.28, 0.96, 7.2], 0x394148)
    for (const z of [-3.25, 0, 3.25]) {
      opaque.box(frame, [0, 1.35, z], [0.18, 1.75, 0.18], 0x252b30)
    }
    opaque.box(frame, [0, 1.7, 0], [0.14, 0.12, 6.8], 0x252b30)
    if (i % 2 === 0) {
      opaque.box(frame, [side * 0.55, 0.95, -1.7], [0.9, 1.9, 1.45], i % 4 ? 0x7f8582 : 0x52685d)
      opaque.box(frame, [side * 0.58, 1.96, -1.7], [0.98, 0.14, 1.53], 0x262d31)
      lights.box(frame, [side * 1.06, 1.15, -1.7], [0.04, 0.18, 0.32], 0xffa95d)
    }
  }
}

function addMachiya(
  opaque: GeometryBatch,
  lights: GeometryBatch,
  frame: THREE.Matrix4,
  side: number,
  variant: number,
  rng: () => number,
) {
  const w = 5.8 + rng() * 2.2
  // Real machiya are narrow and deep. More importantly for the moving cab,
  // this closes the empty-lawn gaps without adding a single building/draw.
  const d = 11.0 + rng() * 5.0
  const h = 5.0 + rng() * 1.1
  const face = side * w / 2
  const plaster = [0xd1b887, 0xb8916c, 0xddc9a0, 0xa88868][variant % 4]
  const timber = [0x3b281d, 0x553822, 0x292522][variant % 3]
  const roof = [0x34434a, 0x47433e, 0x2c3942][variant % 3]

  opaque.box(frame, [0, h / 2, 0], [w, h, d], plaster)
  opaque.box(frame, [face + side * 0.08, 1.4, 0], [0.22, 2.8, d * 0.9], timber)
  opaque.box(frame, [face + side * 0.16, 3.7, 0], [0.3, 0.22, d * 0.95], timber)

  // Paired kawara planes and long eaves; the ridge runs with the track.
  opaque.box(frame, [-w * 0.27, h + 0.36, 0], [w * 0.58, 0.25, d + 1.1], roof, [0, 0, 0.22])
  opaque.box(frame, [w * 0.27, h + 0.36, 0], [w * 0.58, 0.25, d + 1.1], roof, [0, 0, -0.22])
  opaque.cylinder(frame, [0, h + 0.95, 0], [0.22, d + 1.2, 0.22], roof, 8, [Math.PI / 2, 0, 0])

  // Lattice rhythm, noren and air conditioner: small, repeated signals of a
  // lived-in Japanese street rather than ornamental "Japan" pasted on top.
  // 0.96 m still reads as a dense machiya lattice at cab distance; the old
  // 0.55 m rhythm spent ~2k triangles on bars smaller than a phone pixel.
  for (let z = -d * 0.38; z <= d * 0.38; z += 0.96) {
    opaque.box(frame, [face + side * 0.22, 1.55, z], [0.12, 2.45, 0.1], timber)
  }
  for (const y of [0.55, 1.35, 2.15]) {
    opaque.box(frame, [face + side * 0.24, y, 0], [0.12, 0.1, d * 0.86], timber)
  }
  lights.box(frame, [face + side * 0.28, 3.75, -d * 0.18], [0.08, 1.15, d * 0.18], 0xffc16d)
  lights.box(frame, [face + side * 0.28, 3.75, d * 0.18], [0.08, 1.15, d * 0.18], 0xffc16d)
  // The cab sees the gable ends for most of the approach. Give them the same
  // timber lattice hierarchy as the long elevation.
  for (const zFace of [-1, 1]) {
    const z = zFace * (d / 2 + 0.04)
    // Ground-floor noren/shopfront blocks are large colour masses on the
    // approach, then reveal their lattice as the cab draws alongside.
    opaque.box(
      frame,
      [0, 1.35, z + zFace * 0.06],
      [w * 0.72, 2.35, 0.08],
      [0x7b2f2b, 0x2f4b5e, 0x7a5531, 0x46563b][variant % 4],
    )
    opaque.box(frame, [0, 2.65, z], [w * 0.84, 0.18, 0.12], timber)
    for (const x of [-0.32, -0.16, 0, 0.16, 0.32]) {
      opaque.box(frame, [x * w, 1.45, z], [0.11, 2.45, 0.12], timber)
    }
    lights.box(frame, [-w * 0.22, 3.75, z + zFace * 0.025], [w * 0.24, 1.05, 0.06], 0xffc16d)
    lights.box(frame, [w * 0.22, 3.75, z + zFace * 0.025], [w * 0.24, 1.05, 0.06], 0xffc16d)
    opaque.box(frame, [0, 2.72, z + zFace * 0.35], [w * 0.88, 0.16, 0.72], roof)
    for (const x of [-0.36, 0.36]) {
      opaque.box(frame, [x * w, 2.35, z + zFace * 0.3], [0.12, 0.8, 0.12], timber)
    }
  }
  opaque.box(frame, [face + side * 0.46, 1.5, d * 0.36], [0.65, 0.55, 1.0], 0xb8b7aa)
  if (variant % 3 === 0) {
    opaque.box(frame, [face + side * 0.42, 2.55, 0], [0.5, 0.8, d * 0.48], 0x923d32)
  }
}

function buildMarketEdge(opaque: GeometryBatch, lights: GeometryBatch, track: Track) {
  const rng = worldStream('art021-nishiki-edge')
  const a = track.markerFor(SUSUKINO).tFraction
  const b = track.markerFor(NISHIKI).tFraction
  const span = ((b - a + 1) % 1) || 0.02

  for (let i = 0; i < 24; i++) {
    const lane = rng() < 0.52 ? 1 : -1
    const jitter = (rng() - 0.5) * 0.022
    const t = (a + span * (0.2 + 0.53 * ((i + 0.5) / 24) + jitter)) % 1
    const offset = lane * (14.9 + rng() * 5.8)
    const frame = frameAt(track, t, offset, (rng() - 0.5) * 0.12)
    addMachiya(opaque, lights, frame, lane, i, rng)
  }

  // Low timber boundaries, stone plinths and warm shop markers close the
  // ground plane into a narrow Kyoto lane. This layer is deliberately lower
  // than the houses: it adds parallax and human scale without blocking their
  // roof silhouette.
  for (let i = 0; i < 17; i++) {
    const side = i % 4 < 2 ? 1 : -1
    const t = (a + span * (0.24 + 0.48 * ((i + 0.5) / 17))) % 1
    const frame = frameAt(track, t, side * (12.8 + (i % 3) * 0.7))
    opaque.box(frame, [0, 0.32, 0], [0.7, 0.64, 6.2], 0x807666)
    for (const z of [-2.75, -0.9, 0.95, 2.8]) {
      opaque.box(frame, [0, 1.12, z], [0.18, 1.65, 0.18], 0x3f3026)
    }
    opaque.box(frame, [0, 1.55, 0], [0.16, 0.12, 5.8], 0x3f3026)
    opaque.box(frame, [0, 1.02, 0], [0.12, 0.1, 5.8], 0x5c4432)
    if (i % 3 === 0) {
      opaque.box(frame, [side * 0.52, 1.25, 1.85], [0.72, 1.85, 0.22], i % 2 ? 0x8b3e31 : 0x33465a)
      lights.box(frame, [side * 0.65, 2.25, 1.85], [0.38, 0.55, 0.38], MARKET.warm)
    }
  }
}

function makeMaterial(kind: BatchKind) {
  if (kind === 'glass') {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.36,
      roughness: 0.28,
      metalness: 0.08,
      depthWrite: false,
    })
  }
  if (kind === 'light') {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      emissive: 0xffffff,
      emissiveIntensity: 0.22,
      roughness: 0.55,
    })
  }
  if (kind === 'snow') {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
    })
  }
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    // The canopies are deep and the game has one sun, not a forest of fill
    // lights. A tiny warm floor keeps timber/steel readable from the CCTV and
    // side window without adding real lights or flattening daylight.
    emissive: 0x705a48,
    emissiveIntensity: 0.085,
    roughness: 0.76,
    metalness: 0.08,
  })
}

function trianglesOf(geometry: THREE.BufferGeometry) {
  return geometry.index
    ? geometry.index.count / 3
    : geometry.getAttribute('position').count / 3
}

export type ArtPass021Report = Art021StaticReport

export class ArtPass021 {
  readonly report: ArtPass021Report
  private readonly snowMeshes: THREE.Mesh[] = []
  private readonly lightMaterials: THREE.MeshStandardMaterial[] = []

  constructor(scene: THREE.Scene, track: Track) {
    let meshes = 0
    let triangles = 0

    const finishSet = (
      name: string,
      build: (batches: Record<BatchKind, GeometryBatch>) => void,
    ) => {
      const batches: Record<BatchKind, GeometryBatch> = {
        opaque: new GeometryBatch(),
        glass: new GeometryBatch(),
        light: new GeometryBatch(),
        snow: new GeometryBatch(),
      }
      build(batches)
      for (const kind of ['opaque', 'glass', 'light', 'snow'] as const) {
        const geometry = batches[kind].finish()
        if (!geometry) continue
        const material = makeMaterial(kind)
        const mesh = tagGroup(new THREE.Mesh(geometry, material), `art021-${name}-${kind}`)
        // The canopy must shade its own platform. Thousands of sub-pixel
        // facade bars in the moving neighbourhood do not earn a second
        // shadow pass on mobile; they still receive the world's shadows.
        mesh.castShadow = kind === 'opaque' && name.endsWith('-station')
        mesh.receiveShadow = kind === 'opaque' || kind === 'snow'
        if (kind === 'glass') mesh.renderOrder = 2
        if (kind === 'snow') {
          mesh.visible = false
          this.snowMeshes.push(mesh)
        }
        if (kind === 'light') this.lightMaterials.push(material)
        scene.add(mesh)
        meshes++
        triangles += trianglesOf(geometry)
      }
    }

    finishSet('susukino-station', (b) => addSusukinoStation(b, stationFrame(track, SUSUKINO)))
    finishSet('nishiki-station', (b) => addNishikiStation(b, stationFrame(track, NISHIKI)))
    finishSet('susukino-edge', (b) => buildUrbanEdge(b.opaque, b.light, track))
    finishSet('nishiki-edge', (b) => buildMarketEdge(b.opaque, b.light, track))

    this.report = {
      stations: ['susukino', 'nishiki'],
      meshes,
      triangles,
      designDrawsDay: meshes - this.snowMeshes.length,
      designDrawsWinter: meshes,
    }
    assertStaticArtBudget(this.report)
    if (import.meta.env?.DEV) console.info(`[ArtPass021] ${JSON.stringify(this.report)}`)
  }

  setSeason(season: Season) {
    const winter = season === 'winter'
    for (const mesh of this.snowMeshes) mesh.visible = winter
  }

  update(nightFactor: number) {
    // Keep the authored amber/cyan/magenta hue. At 1.6 these panels clipped
    // to white under the game's tone mapping, turning Susukino into the same
    // monochrome window grid as the legacy skyline.
    const glow = 0.14 + THREE.MathUtils.smoothstep(nightFactor, 0.08, 0.82) * 0.82
    for (const material of this.lightMaterials) material.emissiveIntensity = glow
  }
}
