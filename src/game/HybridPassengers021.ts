import * as THREE from 'three'
import {
  ART021_STATIONS,
  art021ModelMask,
  assertHybridArtBudget,
  type Art021HybridReport,
} from './art021Contract'

/**
 * The close-range half of the 0.2.1 crowd.
 *
 * The original hand-drawn billboards remain the correct LOD for the other 28
 * platforms. At Susukino and Nishiki, the twelve closest queue slots plus the
 * station attendant become small low-poly 3D figures. They read as volumes
 * through the cab side window, share six meshes/materials, and follow the same
 * position/mode attributes as the gameplay crowd — no decorative duplicates.
 */

export interface HybridStationFrame {
  origin: THREE.Vector3
  xAxis: THREE.Vector3
  zAxis: THREE.Vector3
  side: number
}

interface Figure {
  sourceIndex: number
  station: number
  last: THREE.Vector3
  yaw: number
}

const SLICE_STATIONS = ART021_STATIONS
const MODE_WALK = 1
const MODE_HIDDEN = 2
const STAFF_ROW = 8
const MODE_POSE = 3

const SKIN = ['#f0c8a8', '#f2cbab', '#f2cbab', '#edc4a0', '#e8bc9a', '#edc4a0', '#f2cbab', '#eec6a6', '#f0c8a8']
const HAIR = ['#26221f', '#3b2d24', '#2a2018', '#1e1a16', '#b9b4ac', '#3a2b20', '#443128', '#57422e', '#172034']
const TOP = ['#2c3444', '#6b7280', '#f1eee5', '#e6e4dc', '#5d4f3f', '#b3432e', '#7d5a68', '#d9d3c6', '#1e2a44']
const BOTTOM = ['#2c3444', '#4b5563', '#27324a', '#2b2f3a', '#57544c', '#33383f', '#3f3a44', '#56606a', '#172034']
const BAGS = ['#4a3527', '#8a4a4a', '#6d4a2f', '#3f5a63', '#000000', '#000000', '#8a6a42', '#a34d3f', '#000000']
const HAS_BAG = [true, true, true, true, false, false, true, true, false]
const BUILD = [0.88, 1.04, 0.92, 0.96, 1.08, 0.9, 1.0, 0.94, 1.0]
const COAT = [0.08, 0.02, 0.16, 0.13, 0.04, 0.18, 0.1, 0.14, 0.02]
const HAIR_SHAPE = [0.82, 0.68, 0.92, 0.72, 0.52, 0.88, 0.76, 0.96, 0.58]

function makeMesh(geometry: THREE.BufferGeometry, capacity: number, roughness = 0.78) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    // The platforms are deeply roofed. A restrained warm fill keeps faces
    // and coat silhouettes readable without six extra lights or shadow maps.
    emissive: 0x6f5c4b,
    emissiveIntensity: 0.075,
    roughness,
    metalness: 0,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  mesh.frustumCulled = false
  // The existing one-draw contact blobs remain under these figures; making six
  // component meshes cast shadows would add another six shadow draws.
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}

function trianglesOf(mesh: THREE.InstancedMesh) {
  const g = mesh.geometry
  const per = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3
  // Budget the maximum capacity, not whichever station happened to be close
  // to the camera during construction.
  return per * mesh.instanceMatrix.count
}

export type HybridPassengerReport = Art021HybridReport

export class HybridPassengers021 {
  readonly representation: Float32Array
  readonly report: HybridPassengerReport

  private readonly figures: Figure[] = []
  private readonly torso: THREE.InstancedMesh
  private readonly heads: THREE.InstancedMesh
  private readonly hair: THREE.InstancedMesh
  private readonly arms: THREE.InstancedMesh
  private readonly legs: THREE.InstancedMesh
  private readonly bags: THREE.InstancedMesh
  private readonly meshes: THREE.InstancedMesh[]
  private readonly root = new THREE.Object3D()
  private readonly part = new THREE.Object3D()
  private readonly world = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly offsets: THREE.InstancedBufferAttribute
  private readonly data: THREE.InstancedBufferAttribute
  private readonly misc: THREE.InstancedBufferAttribute
  private readonly frames: HybridStationFrame[]
  private readonly camera: THREE.Camera
  private readonly platformYaws: number[]
  private representationDirty = true
  private layoutMask = -1
  private time = 0

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    total: number,
    waitingPerStation: number,
    staffBase: number,
    offsets: THREE.InstancedBufferAttribute,
    data: THREE.InstancedBufferAttribute,
    misc: THREE.InstancedBufferAttribute,
    frames: HybridStationFrame[],
  ) {
    this.camera = camera
    this.offsets = offsets
    this.data = data
    this.misc = misc
    this.frames = frames
    this.platformYaws = frames.map((frame) => {
      const directionX = -frame.xAxis.x * frame.side
      const directionZ = -frame.xAxis.z * frame.side
      return Math.atan2(directionX, directionZ)
    })
    this.representation = new Float32Array(total)

    for (const station of SLICE_STATIONS) {
      for (let p = 0; p < 12; p++) {
        const sourceIndex = station * waitingPerStation + p
        this.figures.push({
          sourceIndex,
          station,
          last: new THREE.Vector3(
            offsets.getX(sourceIndex),
            offsets.getY(sourceIndex),
            offsets.getZ(sourceIndex),
          ),
          yaw: this.platformYaw(station),
        })
      }
      const sourceIndex = staffBase + station
      this.figures.push({
        sourceIndex,
        station,
        last: new THREE.Vector3(
          offsets.getX(sourceIndex),
          offsets.getY(sourceIndex),
          offsets.getZ(sourceIndex),
        ),
        yaw: this.platformYaw(station),
      })
    }

    const count = this.figures.length
    this.torso = makeMesh(new THREE.CylinderGeometry(0.5, 0.62, 1, 6), count)
    this.heads = makeMesh(new THREE.SphereGeometry(0.5, 8, 6), count, 0.82)
    this.hair = makeMesh(new THREE.SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.62), count, 0.92)
    this.arms = makeMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), count * 2)
    this.legs = makeMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), count * 2)
    // One accessory pool carries bag + two eyes + two shoes per figure. That
    // turns the old mannequin silhouette into a readable little person at
    // platform distance without paying a seventh draw.
    this.bags = makeMesh(new THREE.BoxGeometry(1, 1, 1), count * 5)
    this.meshes = [this.torso, this.heads, this.hair, this.arms, this.legs, this.bags]

    const dynamicGroup = new THREE.Group()
    dynamicGroup.name = 'hybrid-passengers-021'
    dynamicGroup.userData.dynamic = true
    dynamicGroup.add(...this.meshes)
    scene.add(dynamicGroup)

    this.update(0)

    this.report = {
      figures: count,
      draws: this.meshes.length,
      triangles: this.meshes.reduce((sum, mesh) => sum + trianglesOf(mesh), 0),
      stations: SLICE_STATIONS,
    }
    assertHybridArtBudget(this.report)
    if (import.meta.env?.DEV) console.info(`[HybridPassengers021] ${JSON.stringify(this.report)}`)
  }

  private platformYaw(station: number) {
    return this.platformYaws[station]
  }

  private paint(index: number, figure: Figure) {
    const row = Math.min(STAFF_ROW, Math.max(0, Math.round(this.data.getX(figure.sourceIndex))))
    const color = (value: string) => new THREE.Color(value)
    this.torso.setColorAt(index, color(TOP[row]))
    this.heads.setColorAt(index, color(SKIN[row]))
    this.hair.setColorAt(index, color(HAIR[row]))
    this.bags.setColorAt(index * 5, color(BAGS[row]))
    this.bags.setColorAt(index * 5 + 1, color('#171513'))
    this.bags.setColorAt(index * 5 + 2, color('#171513'))
    this.bags.setColorAt(index * 5 + 3, color(BOTTOM[row]).multiplyScalar(0.55))
    this.bags.setColorAt(index * 5 + 4, color(BOTTOM[row]).multiplyScalar(0.55))
    this.arms.setColorAt(index * 2, color(TOP[row]))
    this.arms.setColorAt(index * 2 + 1, color(TOP[row]))
    this.legs.setColorAt(index * 2, color(BOTTOM[row]))
    this.legs.setColorAt(index * 2 + 1, color(BOTTOM[row]))
  }

  /**
   * The sprite attribute shares `representation` by reference. Tell its owner
   * only when a station crosses the LOD boundary, not on every frame.
   */
  consumeRepresentationDirty() {
    const dirty = this.representationDirty
    this.representationDirty = false
    return dirty
  }

  private write(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx: number,
    ry: number,
    rz: number,
    visible: number,
  ) {
    this.part.position.set(x, y, z)
    this.part.scale.set(sx * visible, sy * visible, sz * visible)
    this.part.rotation.set(rx, ry, rz)
    this.part.updateMatrix()
    this.world.multiplyMatrices(this.root.matrix, this.part.matrix)
    mesh.setMatrixAt(index, this.world)
  }

  update(dt: number) {
    this.time += dt
    const d0 = this.camera.position.distanceToSquared(this.frames[SLICE_STATIONS[0]].origin)
    const d1 = this.camera.position.distanceToSquared(this.frames[SLICE_STATIONS[1]].origin)
    const mask = art021ModelMask(d0, d1)

    const layoutChanged = mask !== this.layoutMask
    if (layoutChanged) {
      this.layoutMask = mask
      this.representationDirty = true
      for (const figure of this.figures) {
        const bit = figure.station === SLICE_STATIONS[0] ? 1 : 2
        this.representation[figure.sourceIndex] = mask & bit ? 1 : 0
      }
    }

    let drawIndex = 0
    for (const figure of this.figures) {
      const bit = figure.station === SLICE_STATIONS[0] ? 1 : 2
      if (!(mask & bit)) continue
      const source = figure.sourceIndex
      const mode = this.data.getY(source)
      const visible = Math.abs(mode - MODE_HIDDEN) < 0.5 ? 0 : 1
      const stature = this.misc.getX(source)
      this.position.set(this.offsets.getX(source), this.offsets.getY(source), this.offsets.getZ(source))

      const dx = this.position.x - figure.last.x
      const dz = this.position.z - figure.last.z
      if (dx * dx + dz * dz > 0.000002) figure.yaw = Math.atan2(dx, dz)
      else if (mode !== MODE_WALK) figure.yaw = this.platformYaw(figure.station)
      figure.last.copy(this.position)

      const row = Math.min(STAFF_ROW, Math.max(0, Math.round(this.data.getX(source))))
      const phase = this.data.getZ(source)
      const build = BUILD[row]
      const coat = COAT[row]
      const walking = Math.abs(mode - MODE_WALK) < 0.5
      const swing = walking ? Math.sin(this.time * 8.8 + phase) * 0.62 : Math.sin(this.time * 1.4 + phase) * 0.025
      const posed = mode > MODE_POSE - 0.5 && row === STAFF_ROW
      const pose = posed ? Math.round(phase) : 0
      const bow = pose === 3 ? 0.34 : 0
      const point = pose === 2 || pose === 4

      this.root.position.copy(this.position)
      this.root.rotation.set(0, figure.yaw, 0)
      this.root.updateMatrix()

      const s = stature
      const hip = 0.12 * build * s
      const legH = (0.72 - coat * 0.35) * s
      this.write(this.legs, drawIndex * 2, -hip, legH / 2, 0, 0.17 * build * s, legH, 0.18 * s, swing, 0, 0, visible)
      this.write(this.legs, drawIndex * 2 + 1, hip, legH / 2, 0, 0.17 * build * s, legH, 0.18 * s, -swing, 0, 0, visible)
      this.write(
        this.torso,
        drawIndex,
        0,
        (0.98 - coat * 0.18) * s,
        bow * 0.12,
        0.46 * build * s,
        (0.66 + coat) * s,
        0.31 * build * s,
        bow,
        0,
        0,
        visible,
      )
      this.write(this.heads, drawIndex, 0, 1.49 * s, bow * 0.25, 0.34 * s, 0.37 * s, 0.34 * s, bow, 0, 0, visible)
      this.write(
        this.hair,
        drawIndex,
        0,
        (1.56 + HAIR_SHAPE[row] * 0.035) * s,
        bow * 0.25 - 0.01,
        0.36 * s,
        (0.16 + HAIR_SHAPE[row] * 0.1) * s,
        0.36 * s,
        bow,
        0,
        0,
        visible,
      )

      const armL = point ? -0.12 : -swing
      const armR = point ? 0 : swing
      const shoulder = 0.32 * build * s
      this.write(this.arms, drawIndex * 2, -shoulder, 1.02 * s, 0, 0.14 * build * s, 0.61 * s, 0.14 * s, armL, 0, point ? 1.25 : 0, visible)
      this.write(this.arms, drawIndex * 2 + 1, shoulder, 1.02 * s, 0, 0.14 * build * s, 0.61 * s, 0.14 * s, armR, 0, point ? -0.18 : 0, visible)

      const hasBag = row < HAS_BAG.length && HAS_BAG[row]
      const accessory = drawIndex * 5
      this.write(this.bags, accessory, 0.38 * build * s, 0.75 * s, 0.06, 0.28 * s, 0.42 * s, 0.18 * s, 0, 0, 0, visible * (hasBag ? 1 : 0))
      this.write(this.bags, accessory + 1, -0.09 * s, 1.52 * s, 0.32 * s, 0.045 * s, 0.045 * s, 0.025 * s, bow, 0, 0, visible)
      this.write(this.bags, accessory + 2, 0.09 * s, 1.52 * s, 0.32 * s, 0.045 * s, 0.045 * s, 0.025 * s, bow, 0, 0, visible)
      this.write(this.bags, accessory + 3, -hip, 0.08 * s, 0.09 * s, 0.2 * build * s, 0.14 * s, 0.34 * s, 0, 0, 0, visible)
      this.write(this.bags, accessory + 4, hip, 0.08 * s, 0.09 * s, 0.2 * build * s, 0.14 * s, 0.34 * s, 0, 0, 0, visible)
      if (layoutChanged) this.paint(drawIndex, figure)
      drawIndex++
    }

    // Repacking means only the station(s) inside the close LOD consume vertex
    // work. At 300 m the six meshes have count=0 and the original sprites are
    // back; standing on a platform draws 13 detailed figures, not all 26.
    this.torso.count = drawIndex
    this.heads.count = drawIndex
    this.hair.count = drawIndex
    this.arms.count = drawIndex * 2
    this.legs.count = drawIndex * 2
    this.bags.count = drawIndex * 5
    if (drawIndex > 0) {
      for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true
    }
    if (layoutChanged) {
      for (const mesh of this.meshes) {
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
  }
}
