import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Track } from './Track'
import { groundHeightAt } from './Track'
import { STATIONS } from '../data/stations'

/**
 * Shared hard-surface kit for the authored station families.
 *
 * A family supplies composition and palette; this module supplies only the
 * neutral manufacturing rules: unit primitives, deterministic transforms,
 * geometry batches and the common material language. Keeping those here lets
 * 0.2.3 prove a third family without copying ArtPass021 wholesale.
 */

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_CYLINDER_6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)
const UNIT_CYLINDER_8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8)

export type ArtBatchKind = 'opaque' | 'glass' | 'light' | 'snow'
export type ArtBatches = Record<ArtBatchKind, GeometryBatch>

export class GeometryBatch {
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
    if (!merged) throw new Error('ArtKit: incompatible geometry batch')
    for (const g of this.geometries) g.dispose()
    this.geometries.length = 0
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
  }
}

export function createArtBatches(): ArtBatches {
  return {
    opaque: new GeometryBatch(),
    glass: new GeometryBatch(),
    light: new GeometryBatch(),
    snow: new GeometryBatch(),
  }
}

export function artFrameAt(track: Track, t: number, sideOffset = 0, yaw = 0) {
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

export function artStationFrame(track: Track, stationIndex: number) {
  return artFrameAt(track, track.markerFor(stationIndex).tFraction)
}

export function artStationSide(stationIndex: number) {
  return STATIONS[stationIndex].doorSide === 'left' ? 1 : -1
}

export function makeArtMaterial(kind: ArtBatchKind) {
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
    // Deep canopies need a tiny baked-looking floor, not extra real lights.
    emissive: 0x705a48,
    emissiveIntensity: 0.085,
    roughness: 0.76,
    metalness: 0.08,
  })
}

export function artTrianglesOf(geometry: THREE.BufferGeometry) {
  return geometry.index
    ? geometry.index.count / 3
    : geometry.getAttribute('position').count / 3
}
