import * as THREE from 'three'
import { STATIONS, TOTAL_LOOP_KM } from '../data/stations'

export interface StationMarker {
  index: number
  id: string
  tFraction: number
}

/**
 * A stylized, non-circular closed loop standing in for the Yamanote Line's
 * silhouette (elongated north-south, as on the real map). Station spacing
 * around the loop mirrors the real relative inter-station distances, but the
 * absolute shape is an artistic approximation, not a geographic trace.
 */
export class Track {
  readonly curve: THREE.CatmullRomCurve3
  readonly stationMarkers: StationMarker[]
  private readonly length: number

  constructor() {
    this.curve = buildLoopCurve()
    this.curve.arcLengthDivisions = 4000
    this.length = this.curve.getLength()
    this.stationMarkers = buildStationMarkers()
  }

  getLength(): number {
    return this.length
  }

  pointAt(tFraction: number, target = new THREE.Vector3()): THREE.Vector3 {
    const t = THREE.MathUtils.euclideanModulo(tFraction, 1)
    return this.curve.getPointAt(t, target)
  }

  tangentAt(tFraction: number, target = new THREE.Vector3()): THREE.Vector3 {
    const t = THREE.MathUtils.euclideanModulo(tFraction, 1)
    return this.curve.getTangentAt(t, target)
  }

  markerFor(stationIndex: number): StationMarker {
    return this.stationMarkers[stationIndex % this.stationMarkers.length]
  }
}

/** A curve running parallel to the track's centerline, offset sideways — used to lay rail geometry. */
export class TrackOffsetCurve extends THREE.Curve<THREE.Vector3> {
  private track: Track
  private offset: number
  constructor(track: Track, offset: number) {
    super()
    this.track = track
    this.offset = offset
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const p = this.track.pointAt(t)
    const tangent = this.track.tangentAt(t)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    return target.copy(p).add(normal.multiplyScalar(this.offset))
  }
}

/** Overhead catenary wire: follows the track at a fixed height with a gentle sag between poles. */
export class CatenaryCurve extends THREE.Curve<THREE.Vector3> {
  private track: Track
  private height: number
  private sagAmp: number
  private poleCount: number
  constructor(track: Track, height: number, sagAmp: number, poleCount: number) {
    super()
    this.track = track
    this.height = height
    this.sagAmp = sagAmp
    this.poleCount = poleCount
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const p = this.track.pointAt(t)
    const sag = Math.sin(((t * this.poleCount) % 1) * Math.PI) * this.sagAmp
    return target.set(p.x, p.y + this.height - sag, p.z)
  }
}

// Scales the whole loop up so consecutive stations sit farther apart, giving
// room to actually accelerate and cruise before the next braking zone instead
// of departing straight into it — and enough running time for the full
// trilingual PA sequence to finish comfortably between stops.
const LOOP_SCALE = 3

function buildLoopCurve(): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  const N = 64
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    // Elongated N-S "stadium" shape with gentle irregularity so it doesn't
    // read as a perfect ellipse.
    const rx = (420 + Math.sin(a * 2 + 0.6) * 55 + Math.sin(a * 5) * 12) * LOOP_SCALE
    const rz = (640 + Math.cos(a * 3) * 45) * LOOP_SCALE
    const squash = 0.82 + 0.18 * Math.pow(Math.abs(Math.sin(a * 0.5)), 1.5)
    const x = Math.sin(a) * rx
    const z = -Math.cos(a) * rz * squash
    const y = Math.sin(a * 6) * 2.2 + Math.sin(a * 1.7 + 1) * 3.5
    points.push(new THREE.Vector3(x, y, z))
  }
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.4)
}

function buildStationMarkers(): StationMarker[] {
  const markers: StationMarker[] = []
  let cumulative = 0
  for (let i = 0; i < STATIONS.length; i++) {
    markers.push({ index: i, id: STATIONS[i].id, tFraction: cumulative / TOTAL_LOOP_KM })
    cumulative += STATIONS[i].distanceToNextKm
  }
  return markers
}
