import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Track } from './Track'
import { makeScuffedPanelTexture } from './signage'

// ————————————————————————————————————————————————————————————————
// The train itself, seen from outside. Until now the player drove a camera:
// there was no vehicle in the world at all, which is why the doors could be
// "implied" and the passengers boarded thin air.
//
// The shape is the old Japanese commuter EMU — flat cab front with rounded
// corners, a two-pane windscreen, round headlights low on the skirt, a
// destination board above, and a single bright body colour with no livery
// beyond a band. Doors on BOTH sides, because half the ritual is that only
// the correct side opens.
//
// Draw-call budget is the constraint that shapes everything here: the three
// cars share one geometry (instanced), both cab noses share another, and all
// 24 door leaves are one instanced mesh whose matrices are rewritten as the
// doors slide. Six draw calls for the whole train, and it is hidden outright
// in cab view so it costs nothing at all in the default camera.
// ————————————————————————————————————————————————————————————————

export const CAR_COUNT = 3
export const CAR_LEN = 18.4
const CAR_GAP = 0.6
export const CAR_PITCH = CAR_LEN + CAR_GAP
/** Half-width of the body shell. */
export const HALF_W = 2.15
/** Floor sits level with the platform slab (City's PLATFORM_TOP). */
export const FLOOR_Y = 1.2
export const ROOF_Y = 4.35
const ROOF_CAP_Y = 4.62
export const WALL_T = 0.16
/** Clear width of one doorway; each of its two leaves is half that. */
const DOOR_W = 1.55
const LEAF_W = DOOR_W / 2
const DOOR_TOP = 3.62
/** Doorway centres within a car. */
const CAR_DOOR_ZS = [-4.6, 4.6]
/** Nose length ahead of the leading car's body. */
export const NOSE_LEN = 1.5

/**
 * The windscreen, as ONE set of numbers.
 *
 * These used to be literals inside `buildNoseGlass`, which was fine while the
 * only thing that knew about the windscreen was the thing that drew it from
 * outside. The cab interior has to agree with it pane for pane — that
 * agreement is the whole point of sitting inside this train rather than a
 * generic box — so the numbers live here and both sides read them.
 *
 * One panoramic pane. It was two panes with a centre pillar — the classic
 * JNR commuter face — but a real driver sits OFFSET from a pillar like that,
 * and this cab pins the eye to the axis (off-centre made the track read as
 * crooked), which planted the pillar exactly on the vanishing point. It was
 * slimmed from 0.56 to 0.16 and it still owned the horizon, so it is gone:
 * the view won over the prototype (Rubén, 2026-07-30).
 */
export const WINDSCREEN = {
  /** Pane centre height above the rail head. */
  centreY: 3.12,
  /**
   * The glass must end at |x| ≤ 1.76: the nose is a rounded box of shoulder
   * radius 0.34, and an earlier widening pushed the edge to 2.11 — 0.14 PAST
   * the shoulder — and the windscreen flew off the side of the train. This
   * span is the two old panes' outer edges, so the jambs did not move.
   */
  paneW: HALF_W * 1.634,
  paneH: 1.35,
  /** Glass plane, measured from the nose's mounting face. */
  z: NOSE_LEN + 0.01,
  get outer() {
    return this.paneW / 2
  },
  get top() {
    return this.centreY + this.paneH / 2
  },
  get bottom() {
    return this.centreY - this.paneH / 2
  },
} as const

/** Destination board over the windscreen, on the outside of the nose. */
export const NOSE_BOARD = { y: 4.02, w: HALF_W * 1.05, h: 0.42 } as const

/**
 * How far back into the leading car the cab reaches. Saloon glazing has to
 * stop here — behind this line is passenger space, ahead of it is the driver.
 */
export const CAB_LEN_IN_CAR = 2.3

/**
 * 運転士側窓 — the cab's sliding side window, the one a Japanese driver leans
 * out of to watch the platform.
 *
 * Shared for the same reason `WINDSCREEN` is. The interior cuts this opening in
 * its side wall and the nose carries the matching glass, so the window a driver
 * looks through is the window you can see from the platform. Z is measured
 * forward from the nose's mounting face, which is where `buildNose` works.
 */
export const CAB_SIDE_WINDOW = { z0: 0.04, z1: 1.3, y0: 2.565, y1: 3.655 } as const

/** Car centres along the consist, front car first (+Z is the direction of travel). */
export const CAR_OFFSETS = Array.from({ length: CAR_COUNT }, (_, i) => ((CAR_COUNT - 1) / 2 - i) * CAR_PITCH)

/**
 * Every doorway's position along the consist, in local Z, sorted back to
 * front. The platform passengers queue at these — they are the real doors
 * now, not an assumption about where doors might be.
 */
export const DOOR_ZS: number[] = CAR_OFFSETS.flatMap((c) => CAR_DOOR_ZS.map((d) => c + d)).sort((a, b) => a - b)

export const CONSIST_LEN = CAR_COUNT * CAR_LEN + (CAR_COUNT - 1) * CAR_GAP

/**
 * The driver's eye, inside the leading cab just behind the windscreen — which
 * is where Rubén wants it and where it belongs now that there is a train to be
 * inside of. The consequence is deliberate: with the consist centred on the
 * platform (what lines the doorways up with the queues), a perfect stop leaves
 * the cab at the platform's LEADING end, alongside the attendant standing at
 * the stopping mark. That attendant is now the visual reference you stop by,
 * exactly as on the real thing.
 */
export const CAB_OFFSET = CONSIST_LEN / 2 - 0.7

/** Uguisu green — the loop's own colour, matching the HUD's line diagram. */
const BODY_COLOR = 0x8fc31f
const BAND_COLOR = 0xf2f4ef
const SKIRT_COLOR = 0x2b2f36

/**
 * Merge that survives mixed inputs. RoundedBoxGeometry comes back NON-indexed
 * while BoxGeometry is indexed, and mergeGeometries silently returns null when
 * the two are mixed — which showed up as a car with no geometry at all and a
 * null-deref inside the renderer. Normalise first, then merge.
 */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.some((p) => !p.index) ? parts.map((p) => (p.index ? p.toNonIndexed() : p)) : parts
  const merged = mergeGeometries(list, false)
  if (!merged) throw new Error('TrainConsist: incompatible geometries in merge')
  return merged
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/**
 * One car's painted shell: skirt, side walls broken by the doorways, ends and
 * roof. Built once and instanced three times.
 */
function buildCarShell(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const halfLen = CAR_LEN / 2

  // Underframe skirt — slightly narrower so the body reads as overhanging it.
  parts.push(box(HALF_W * 2 - 0.25, 0.36, CAR_LEN, 0, FLOOR_Y - 0.18, 0))

  // Side walls, segmented around the two doorways.
  const cuts: [number, number][] = []
  let from = -halfLen
  for (const dz of CAR_DOOR_ZS) {
    cuts.push([from, dz - DOOR_W / 2])
    from = dz + DOOR_W / 2
  }
  cuts.push([from, halfLen])
  for (const side of [-1, 1]) {
    for (const [a, b] of cuts) {
      const len = b - a
      if (len <= 0.01) continue
      parts.push(box(WALL_T, ROOF_Y - FLOOR_Y, len, side * HALF_W, (FLOOR_Y + ROOF_Y) / 2, (a + b) / 2))
    }
    // Header panel over each doorway, so the opening is a door-shaped hole
    // rather than a slot running to the roof.
    for (const dz of CAR_DOOR_ZS) {
      parts.push(box(WALL_T, ROOF_Y - DOOR_TOP, DOOR_W, side * HALF_W, (DOOR_TOP + ROOF_Y) / 2, dz))
    }
  }

  // Car ends (the outer ones get covered by a nose).
  for (const end of [-1, 1]) {
    parts.push(box(HALF_W * 2 - WALL_T, ROOF_Y - FLOOR_Y, WALL_T, 0, (FLOOR_Y + ROOF_Y) / 2, end * halfLen))
  }

  // Curved roof: a rounded slab is what separates an old EMU from a shoebox.
  const roof = new RoundedBoxGeometry(HALF_W * 2 - 0.1, 0.5, CAR_LEN - 0.06, 2, 0.22)
  roof.translate(0, ROOF_CAP_Y - 0.25, 0)
  parts.push(roof)

  return merge(parts)
}

/** The white waist band that runs the length of the car under the windows. */
function buildCarBand(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    parts.push(box(0.06, 0.26, CAR_LEN - 0.1, side * (HALF_W + WALL_T / 2 + 0.03), FLOOR_Y + 0.58, 0))
  }
  return merge(parts)
}

/** Windows plus the dark interior box seen through them and through open doors. */
function buildCarGlass(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const halfLen = CAR_LEN / 2
  const winY = 2.86
  const winH = 1.45
  // Interior shell, inset so it never z-fights the walls.
  parts.push(box(HALF_W * 2 - 0.34, ROOF_Y - FLOOR_Y - 0.2, CAR_LEN - 0.34, 0, (FLOOR_Y + ROOF_Y) / 2, 0))
  const segs: [number, number][] = []
  let from = -halfLen + 0.5
  for (const dz of CAR_DOOR_ZS) {
    segs.push([from, dz - DOOR_W / 2 - 0.35])
    from = dz + DOOR_W / 2 + 0.35
  }
  // The last segment stops well short of the front end. That end of the LEAD
  // car is the driver's cab, and saloon windows used to run right over it: from
  // outside you saw passenger glazing along 1.25 m of what is, from the inside,
  // the cab's blind rear bulkhead. The geometry is shared by all three cars, so
  // the setback costs nothing and gives every car a more believable end panel.
  segs.push([from, halfLen - CAB_LEN_IN_CAR])
  for (const side of [-1, 1]) {
    for (const [a, b] of segs) {
      const len = b - a
      if (len <= 0.4) continue
      parts.push(box(0.07, winH, len, side * (HALF_W + WALL_T / 2 + 0.03), winY, (a + b) / 2))
    }
  }
  return merge(parts)
}

/** One sliding leaf: a panel with its own little window. */
function buildDoorLeaf(): THREE.BufferGeometry {
  return merge([box(0.1, DOOR_TOP - FLOOR_Y, LEAF_W, 0, (FLOOR_Y + DOOR_TOP) / 2, 0)])
}

/** The dark pane set into each door leaf, drawn with the window material. */
function buildDoorGlass(): THREE.BufferGeometry {
  return merge([box(0.06, 0.95, LEAF_W - 0.22, 0.04, 2.86, 0)])
}

/** The cab nose: rounded front, windscreen recess, headlight and board mounts. */
function buildNose(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const nose = new RoundedBoxGeometry(HALF_W * 2, ROOF_Y - FLOOR_Y + 0.3, NOSE_LEN, 3, 0.34)
  nose.translate(0, (FLOOR_Y + ROOF_Y) / 2 + 0.12, NOSE_LEN / 2)
  parts.push(nose)
  // Skirt under the nose, deeper than the car's — the classic heavy front.
  parts.push(box(HALF_W * 2 - 0.3, 0.75, NOSE_LEN * 0.9, 0, FLOOR_Y - 0.34, NOSE_LEN * 0.45))
  return merge(parts)
}

/** Windscreen glass + the destination board, both dark. */
function buildNoseGlass(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  // Panoramic windscreen — the face of the thing. The cab interior builds its
  // own frame from these same numbers.
  parts.push(box(WINDSCREEN.paneW, WINDSCREEN.paneH, 0.1, 0, WINDSCREEN.centreY, WINDSCREEN.z))
  // Destination board above the screen, and the route board under it.
  parts.push(box(NOSE_BOARD.w, NOSE_BOARD.h, 0.1, 0, NOSE_BOARD.y, WINDSCREEN.z))
  // 運転士側窓 on each flank. The cab cuts this same opening in its interior
  // wall, so the window the driver leans out of is a window that exists on the
  // outside of the train too — it used to be a hole into a solid block. Free:
  // this geometry is already an InstancedMesh over the two noses.
  {
    const w = CAB_SIDE_WINDOW
    const len = w.z1 - w.z0
    const h = w.y1 - w.y0
    for (const side of [-1, 1]) {
      parts.push(box(0.07, h, len, side * (HALF_W + 0.02), (w.y0 + w.y1) / 2, w.z0 + len / 2))
    }
  }
  return merge(parts)
}

function buildBogie(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [box(HALF_W * 1.5, 0.42, 2.6, 0, 0.72, 0)]
  const wheel = new THREE.CylinderGeometry(0.43, 0.43, 0.16, 12)
  wheel.rotateZ(Math.PI / 2)
  for (const z of [-0.95, 0.95]) {
    for (const x of [-0.78, 0.78]) {
      const w = wheel.clone()
      w.translate(x, 0.43, z)
      parts.push(w)
    }
  }
  return merge(parts)
}

const M = new THREE.Matrix4()
const Q = new THREE.Quaternion()
const P = new THREE.Vector3()
const S = new THREE.Vector3(1, 1, 1)
const UP = new THREE.Vector3(0, 1, 0)
const FWD = new THREE.Vector3()
// update() runs every frame in the two outside views. These three exist so it
// allocates nothing: pointAt/tangentAt would each hand back a fresh Vector3
// per car, and the bogie and nose maths used to build a throwaway Matrix4 per
// placement — around a thousand short-lived objects a second between them.
const PT = new THREE.Vector3()
const TAN = new THREE.Vector3()
const M2 = new THREE.Matrix4()
const CAR_MATRICES: THREE.Matrix4[] = Array.from({ length: CAR_COUNT }, () => new THREE.Matrix4())

export class TrainConsist {
  private group = new THREE.Group()
  private shells: THREE.InstancedMesh
  private bands: THREE.InstancedMesh
  private glass: THREE.InstancedMesh
  private noses: THREE.InstancedMesh
  private noseGlass: THREE.InstancedMesh
  private bogies: THREE.InstancedMesh
  private leaves: THREE.InstancedMesh
  private doorGlass: THREE.InstancedMesh
  private lamps: THREE.InstancedMesh
  private glassMat: THREE.MeshStandardMaterial
  private lampMat: THREE.MeshStandardMaterial
  private track: Track
  /** Per-leaf identity: [carIndex, side(-1|1), doorwayZ, leafDirection]. */
  private leafDefs: { car: number; side: number; z: number; dir: number }[] = []

  constructor(scene: THREE.Scene, track: Track) {
    this.track = track

    const panel = makeScuffedPanelTexture('#8fc31f')
    panel.repeat.set(2, 1)
    const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, map: panel, roughness: 0.52, metalness: 0.18 })
    const bandMat = new THREE.MeshStandardMaterial({ color: BAND_COLOR, roughness: 0.6 })
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.22, metalness: 0.55, emissive: 0xffd9a0, emissiveIntensity: 0 })
    const skirtMat = new THREE.MeshStandardMaterial({ color: SKIRT_COLOR, roughness: 0.75, metalness: 0.3 })
    // Doors a shade paler than the body: on the real thing they are a
    // different panel, and it makes the opening legible at a distance.
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xa9d84a, roughness: 0.5, metalness: 0.2 })
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe6b0, emissiveIntensity: 1.2, roughness: 0.4 })

    this.shells = new THREE.InstancedMesh(buildCarShell(), bodyMat, CAR_COUNT)
    this.bands = new THREE.InstancedMesh(buildCarBand(), bandMat, CAR_COUNT)
    this.glass = new THREE.InstancedMesh(buildCarGlass(), this.glassMat, CAR_COUNT)
    this.noses = new THREE.InstancedMesh(buildNose(), bodyMat, 2)
    this.noseGlass = new THREE.InstancedMesh(buildNoseGlass(), this.glassMat, 2)
    this.bogies = new THREE.InstancedMesh(buildBogie(), skirtMat, CAR_COUNT * 2)

    const lamp = new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10)
    lamp.rotateX(Math.PI / 2)
    this.lamps = new THREE.InstancedMesh(lamp, this.lampMat, 4)

    // 3 cars × 2 sides × 2 doorways × 2 leaves.
    for (let c = 0; c < CAR_COUNT; c++) {
      for (const side of [-1, 1]) {
        for (const dz of CAR_DOOR_ZS) {
          for (const dir of [-1, 1]) {
            this.leafDefs.push({ car: c, side, z: CAR_OFFSETS[c] + dz, dir })
          }
        }
      }
    }
    this.leaves = new THREE.InstancedMesh(buildDoorLeaf(), doorMat, this.leafDefs.length)
    this.doorGlass = new THREE.InstancedMesh(buildDoorGlass(), this.glassMat, this.leafDefs.length)

    for (const m of [this.shells, this.bands, this.glass, this.noses, this.noseGlass, this.bogies, this.leaves, this.doorGlass, this.lamps]) {
      m.frustumCulled = false
      this.group.add(m)
    }
    // Only the big silhouette casts: every extra caster is a second draw call
    // in the shadow pass, and nobody can tell a door leaf's shadow from the
    // car's. The phone's frame budget is tighter than that detail is worth.
    this.shells.castShadow = true
    this.noses.castShadow = true
    // A 56 m body would self-shadow into a mess at this shadow-map size, and
    // the train is the one object the player never sees a shadow of anyway.
    this.shells.receiveShadow = true
    this.group.visible = false
    // The train is placed by the simulation, not by the world seed: tagging
    // the group keeps all nine of its meshes out of the world fingerprint's
    // static total (see worldHash.ts — the flag is inherited).
    this.group.userData.dynamic = true
    scene.add(this.group)
  }

  get visible() {
    return this.group.visible
  }

  setVisible(v: boolean) {
    this.group.visible = v
  }

  /** World matrix of a car, for cameras that want to ride along. Car 0 is the front. */
  carMatrix(i: number): THREE.Matrix4 {
    return CAR_MATRICES[THREE.MathUtils.clamp(i, 0, CAR_COUNT - 1)]
  }

  /**
   * Places every car along the track and slides the doors. Cars are placed
   * INDIVIDUALLY: over 18 m the track's bend is invisible, but over the whole
   * 56 m consist a single rigid body would visibly cut the corners.
   */
  update(progress: number, doorsOpenAmount: number, doorSide: 'left' | 'right', nightFactor: number) {
    // Lit interior after dark, seen through the windows and the open doors.
    this.glassMat.emissiveIntensity = nightFactor * 0.55
    this.lampMat.emissiveIntensity = 0.5 + nightFactor * 1.6
    if (!this.group.visible) return

    const len = this.track.getLength()
    for (let i = 0; i < CAR_COUNT; i++) {
      const t = THREE.MathUtils.euclideanModulo(progress + CAR_OFFSETS[i] / len, 1)
      const point = this.track.pointAt(t, PT)
      const tangent = this.track.tangentAt(t, TAN).normalize()
      FWD.copy(point).add(tangent)
      // Object convention: +Z faces the target (see Passengers' station frames).
      M.lookAt(FWD, point, UP)
      Q.setFromRotationMatrix(M)
      CAR_MATRICES[i].compose(point, Q, S)
      this.shells.setMatrixAt(i, CAR_MATRICES[i])
      this.bands.setMatrixAt(i, CAR_MATRICES[i])
      this.glass.setMatrixAt(i, CAR_MATRICES[i])
      // Bogies sit under the car ends, in the car's own frame.
      for (let b = 0; b < 2; b++) {
        P.set(0, 0, (b === 0 ? -1 : 1) * (CAR_LEN / 2 - 3.1))
        M.copy(CAR_MATRICES[i]).multiply(M2.makeTranslation(P.x, P.y, P.z))
        this.bogies.setMatrixAt(i * 2 + b, M)
      }
    }
    this.shells.instanceMatrix.needsUpdate = true
    this.bands.instanceMatrix.needsUpdate = true
    this.glass.instanceMatrix.needsUpdate = true
    this.bogies.instanceMatrix.needsUpdate = true

    // Noses on the outer ends of the outer cars: front faces forward, rear is
    // turned around so the train has a cab at both ends like the real thing.
    for (let n = 0; n < 2; n++) {
      const carIdx = n === 0 ? 0 : CAR_COUNT - 1
      const zLocal = (n === 0 ? 1 : -1) * (CAR_LEN / 2)
      M.makeTranslation(0, 0, zLocal)
      if (n === 1) M.multiply(M2.makeRotationY(Math.PI))
      M.premultiply(CAR_MATRICES[carIdx])
      this.noses.setMatrixAt(n, M)
      this.noseGlass.setMatrixAt(n, M)
      // Two round headlights low on each nose.
      for (const x of [-1, 1]) {
        M.makeTranslation(x * HALF_W * 0.55, FLOOR_Y + 0.05, zLocal + (n === 0 ? NOSE_LEN : -NOSE_LEN))
        if (n === 1) M.multiply(M2.makeRotationY(Math.PI))
        M.premultiply(CAR_MATRICES[carIdx])
        this.lamps.setMatrixAt(n * 2 + (x > 0 ? 1 : 0), M)
      }
    }
    this.noses.instanceMatrix.needsUpdate = true
    this.noseGlass.instanceMatrix.needsUpdate = true
    this.lamps.instanceMatrix.needsUpdate = true

    // Only the platform side opens. `side` here is the same convention the
    // platforms use: left doors sit on +X of the car's own frame.
    const openSide = doorSide === 'left' ? 1 : -1
    for (let i = 0; i < this.leafDefs.length; i++) {
      const d = this.leafDefs[i]
      const open = d.side === openSide ? doorsOpenAmount : 0
      const slide = d.dir * (LEAF_W / 2 + open * (LEAF_W + 0.02))
      const zLocal = d.z - CAR_OFFSETS[d.car] + slide
      // Open leaves tuck just inside the body so they read as pocketed.
      const xLocal = d.side * (HALF_W + 0.01 - open * 0.12)
      M.makeTranslation(xLocal, 0, zLocal)
      M.premultiply(CAR_MATRICES[d.car])
      this.leaves.setMatrixAt(i, M)
      // The pane rides with its leaf, pushed a hair further out.
      M.makeTranslation(xLocal + d.side * 0.03, 0, zLocal)
      M.premultiply(CAR_MATRICES[d.car])
      this.doorGlass.setMatrixAt(i, M)
    }
    this.leaves.instanceMatrix.needsUpdate = true
    this.doorGlass.instanceMatrix.needsUpdate = true
  }
}
