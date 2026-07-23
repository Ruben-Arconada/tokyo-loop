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

// ── Relief ───────────────────────────────────────────────────────────────────
// The quiet green/garden stretch on the north of the loop (Tabata → Komagome →
// Sugamo) rises over a broad hill, so the ride isn't a monotonous flat circle.
// The bump is a smooth raised cosine centred on Komagome's arc-length position;
// the trackside embankment (Game.ts) is generated from this same curve, so the
// ground climbs with the rails and nothing floats. Everything that samples the
// track — camera, rails, sleepers, catenary, platforms, passengers — already
// reads the curve's y, so it follows the grade for free.
export const HILL_STATION_ID = 'komagome'
export const HILL_PEAK = 54   // world units of climb at the crest
const HILL_HALF_WIDTH = 0.055 // fraction of the loop on each side of the crest

// ── Trackside embankment profile ─────────────────────────────────────────────
// The ground ribbon that follows the rails (built in Game.ts) and every piece of
// scenery that has to stand on it read the SAME profile from here, so a change
// to the embankment can never leave houses or trees floating over the hill.
export const EMBANKMENT = {
  crown: 24, // half-width of the flat crown that carries the platforms
  skirt: 58, // width of the sloped skirt down to the plain
  crownDrop: -0.48, // crown top, relative to the local track height
  edgeDrop: -0.6, // skirt foot, tucked just under the flat ground plane
} as const

/** The flat city ground plane's height. */
export const BASE_GROUND_Y = -0.5

/**
 * Raw embankment surface at lateral distance `dist` from a track point of
 * height `trackY`. Dips below the ground plane at the skirt on purpose, so the
 * hill grows out of the plain with no seam.
 */
export function embankmentSurface(trackY: number, dist: number): number {
  const a = Math.abs(dist)
  const crownTop = trackY + EMBANKMENT.crownDrop
  if (a <= EMBANKMENT.crown) return crownTop
  if (a >= EMBANKMENT.crown + EMBANKMENT.skirt) return EMBANKMENT.edgeDrop
  const k = (a - EMBANKMENT.crown) / EMBANKMENT.skirt
  return crownTop + (EMBANKMENT.edgeDrop - crownTop) * k
}

/**
 * Height scenery should stand on: the embankment wherever it rises above the
 * plain, and the plain itself everywhere else (past the skirt the ribbon is
 * hidden under the ground plane, so objects belong on the plane).
 */
export function groundHeightAt(trackY: number, dist: number): number {
  return Math.max(embankmentSurface(trackY, dist), BASE_GROUND_Y)
}

function hillCenterFraction(): number {
  const idx = STATIONS.findIndex((s) => s.id === HILL_STATION_ID)
  let cum = 0
  for (let i = 0; i < Math.max(0, idx); i++) cum += STATIONS[i].distanceToNextKm
  return cum / TOTAL_LOOP_KM
}

/** Smooth raised-cosine hill height at a given arc-length fraction of the loop. */
function hillHeight(fraction: number, center: number): number {
  let d = Math.abs(fraction - center)
  d = Math.min(d, 1 - d) // shortest way round the closed loop
  if (d >= HILL_HALF_WIDTH) return 0
  return HILL_PEAK * 0.5 * (1 + Math.cos((Math.PI * d) / HILL_HALF_WIDTH))
}

function buildLoopCurve(): THREE.CatmullRomCurve3 {
  const N = 64
  // First pass: the flat stadium silhouette (x, z only).
  const xs: number[] = []
  const zs: number[] = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    // Elongated N-S "stadium" shape with gentle irregularity so it doesn't
    // read as a perfect ellipse.
    const rx = (420 + Math.sin(a * 2 + 0.6) * 55 + Math.sin(a * 5) * 12) * LOOP_SCALE
    const rz = (640 + Math.cos(a * 3) * 45) * LOOP_SCALE
    const squash = 0.82 + 0.18 * Math.pow(Math.abs(Math.sin(a * 0.5)), 1.5)
    xs.push(Math.sin(a) * rx)
    zs.push(-Math.cos(a) * rz * squash)
  }

  // Second pass: approximate each point's arc-length fraction from cumulative
  // chord length, so the hill lands where a station sits (markers use the same
  // arc fraction). Then lift each point by the hill profile.
  const chord: number[] = [0]
  for (let i = 1; i <= N; i++) {
    const j = i % N
    const k = i - 1
    chord.push(chord[k] + Math.hypot(xs[j] - xs[k], zs[j] - zs[k]))
  }
  const total = chord[N]
  const center = hillCenterFraction()

  const points: THREE.Vector3[] = []
  for (let i = 0; i < N; i++) {
    const frac = chord[i] / total
    points.push(new THREE.Vector3(xs[i], hillHeight(frac, center), zs[i]))
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
