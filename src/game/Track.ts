import * as THREE from 'three'
import { STATIONS, TOTAL_LOOP_KM } from '../data/stations'

export interface StationMarker {
  index: number
  id: string
  tFraction: number
}

/**
 * A stylized, non-circular closed loop: the ring of the Japan Loop dream
 * tour (elongated north-south, a silhouette inherited from the game's
 * original circular-line layout). Station spacing keeps the original
 * relative inter-station distances — every world anchor derives from them.
 */
export class Track {
  readonly curve: THREE.CatmullRomCurve3
  readonly stationMarkers: StationMarker[]
  private readonly length: number
  private readonly hillCenter: number
  private readonly trenchCenter: number

  constructor() {
    this.curve = buildLoopCurve()
    this.curve.arcLengthDivisions = 4000
    this.length = this.curve.getLength()
    this.stationMarkers = buildStationMarkers()
    this.hillCenter = hillCenterFraction()
    this.trenchCenter = trenchCenterFraction()
  }

  getLength(): number {
    return this.length
  }

  // The hill is applied HERE, analytically, not baked into the spline's
  // control points. Baked-in, Catmull-Rom interpolation rang below zero on
  // the flat approaches (undershoot dips of ~0.6 units just before and after
  // the climb) and the flat ground plane at -0.5 swallowed the sleepers
  // there. The analytic profile is exactly zero outside its window, so the
  // approaches cannot dip by construction. The Shibuya trench is the same
  // profile with its sign flipped — the hill machinery working in negative.
  pointAt(tFraction: number, target = new THREE.Vector3()): THREE.Vector3 {
    const t = THREE.MathUtils.euclideanModulo(tFraction, 1)
    this.curve.getPointAt(t, target)
    target.y += hillHeight(t, this.hillCenter) - trenchDepth(t, this.trenchCenter)
    return target
  }

  // Scratch for tangentAt's finite difference — THREE.Curve.getTangentAt
  // allocates two Vector3 internally per call, and this runs several times
  // per rendered frame (camera solve, headlight, consist).
  private readonly tangentScratch = new THREE.Vector3()

  tangentAt(tFraction: number, target = new THREE.Vector3()): THREE.Vector3 {
    const t = THREE.MathUtils.euclideanModulo(tFraction, 1)
    // Same central difference getTangentAt does, but with pooled vectors —
    // and wrapping at the seam instead of clamping, which is the right move
    // on a closed loop anyway.
    const delta = 0.0001
    this.curve.getPointAt(THREE.MathUtils.euclideanModulo(t + delta, 1), target)
    target.sub(this.curve.getPointAt(THREE.MathUtils.euclideanModulo(t - delta, 1), this.tangentScratch))
    target.normalize()
    // The flat spline's tangent has y=0; the grade is the analytic profile's
    // slope converted from per-loop-fraction to per-arc-unit.
    target.y = (hillGrade(t, this.hillCenter) - trenchGrade(t, this.trenchCenter)) / this.length
    return target.normalize()
  }

  markerFor(stationIndex: number): StationMarker {
    return this.stationMarkers[stationIndex % this.stationMarkers.length]
  }

  /**
   * Unit-tangent Y (vertical slope component) straight from the analytic
   * hill profile — what the per-frame physics wants, without the two
   * Vector3s THREE.Curve.getTangent allocates internally per call.
   */
  gradeYAt(tFraction: number): number {
    const t = THREE.MathUtils.euclideanModulo(tFraction, 1)
    const g = (hillGrade(t, this.hillCenter) - trenchGrade(t, this.trenchCenter)) / this.length
    return g / Math.sqrt(1 + g * g)
  }

  /** How deep the track sits below grade at `t` (0 outside the trench window). */
  trenchDepthAt(tFraction: number): number {
    const t = THREE.MathUtils.euclideanModulo(tFraction, 1)
    return trenchDepth(t, this.trenchCenter)
  }

  /**
   * 0 = open air, 1 = fully inside the covered tunnel. Derived from depth so
   * the lighting/audio crossfade tracks the portal exactly where the lining
   * geometry starts (see TUNNEL_COVER_DEPTH).
   */
  tunnelAmountAt(tFraction: number): number {
    const d = this.trenchDepthAt(tFraction)
    return THREE.MathUtils.clamp((d - TUNNEL_COVER_DEPTH) / 2.2, 0, 1)
  }

  /** Loop fraction of the trench's deepest point — the tunnel builders sample around this. */
  get trenchCenterFraction(): number {
    return this.trenchCenter
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
    // Inside the tunnel the wire becomes rigid overhead conductor rail
    // (剛体架線) — Japanese urban rail boxes never hang a sagging catenary.
    const rigid = Math.min(1, this.track.trenchDepthAt(t))
    const sag = Math.sin(((t * this.poleCount) % 1) * Math.PI) * this.sagAmp * (1 - rigid)
    return target.set(p.x, p.y + this.height - sag, p.z)
  }
}

// Scales the whole loop up so consecutive stations sit farther apart, giving
// room to actually accelerate and cruise before the next braking zone instead
// of departing straight into it — and enough running time for the full
// trilingual PA sequence to finish comfortably between stops.
// 3 → 4: at 3 the stops still chained too tightly to enjoy the scenery
// between them (train physics advances in world units, so a bigger world
// directly buys more seconds of cruising per stretch).
const LOOP_SCALE = 4

// ── Relief ───────────────────────────────────────────────────────────────────
// The quiet green/garden stretch on the north of the loop (Uji → Kiyomizu →
// Shirakawa-gō) rises over a broad hill — the temple climb — so the ride
// isn't a monotonous flat circle.
// The bump is a smooth raised cosine centred on Kiyomizu's arc-length position;
// the trackside embankment (Game.ts) is generated from this same curve, so the
// ground climbs with the rails and nothing floats. Everything that samples the
// track — camera, rails, sleepers, catenary, platforms, passengers — already
// reads the curve's y, so it follows the grade for free.
export const HILL_STATION_ID = 'kiyomizu'
// 54 → 68 with LOOP_SCALE 4: the window is a loop FRACTION, so the bigger
// world stretched the hill 33% longer — without this bump the grade would
// have flattened from the approved ~16% to ~12%.
export const HILL_PEAK = 68   // world units of climb at the crest
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

// ── The Dōtonbori trench and tunnel ─────────────────────────────────────────
// The dense-city counterpart of the Kiyomizu hill: on the long
// Dōtonbori→Otaru stretch the line dives into a cutting and runs under the
// city for a few hundred units. Same analytic raised-cosine as the hill,
// sign flipped, so the approaches cannot ring below (above) grade by
// construction and the arcade grade physics work unchanged.
export const TUNNEL_FROM_STATION_ID = 'dotonbori'
export const TRENCH_DEPTH = 20 // world units below grade at the deepest point
export const TRENCH_HALF_WIDTH = 0.0175 // loop fraction on each side of the center
/**
 * Depth at which the covered tunnel begins. Chosen just under the ground
 * plane's own level so the track is never visibly "under" the plane in the
 * open: the lining box takes over the moment the rails dip below grade, and
 * near the portals it emerges above ground as a concrete hood — which is
 * what a real urban portal looks like.
 */
export const TUNNEL_COVER_DEPTH = 0.3

/** Where the tunnel lining must exist: depth at which the box starts/ends, as a |t - center| fraction. */
export function trenchPortalOffset(): number {
  // Solve D/2·(1+cos(π·d/H)) = COVER_DEPTH for d.
  const c = (2 * TUNNEL_COVER_DEPTH) / TRENCH_DEPTH - 1
  return (Math.acos(c) / Math.PI) * TRENCH_HALF_WIDTH
}

// ── Terrain 2.0: rolling relief on the far plain ────────────────────────────
// Gentle positional noise that lifts the distant fields out of billiard-table
// flatness. Amplitude is ZERO anywhere near the rail corridor (inside 150
// units) so nothing that stands beside the track — houses, platforms, roads,
// scenery — ever needs to care, and ramps up to full over the next ~330.
// Long wavelengths only: the ground plane samples this on a ~145-unit grid,
// so anything shorter would alias into jagged noise.
export function terrainRelief(x: number, z: number, dist: number): number {
  const a = THREE.MathUtils.clamp((Math.abs(dist) - 150) / 330, 0, 1)
  if (a <= 0) return 0
  const n =
    Math.sin(x * 0.00105 + z * 0.00074) +
    0.6 * Math.sin(x * 0.00058 - z * 0.00091 + 1.7) +
    0.35 * Math.sin((x + z) * 0.00171 + 0.4)
  return a * n * 7.2
}

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

/** Trench midpoint: halfway along the tunnel stretch (its origin station → the next). */
function trenchCenterFraction(): number {
  const idx = STATIONS.findIndex((s) => s.id === TUNNEL_FROM_STATION_ID)
  let cum = 0
  for (let i = 0; i < Math.max(0, idx); i++) cum += STATIONS[i].distanceToNextKm
  return (cum + STATIONS[Math.max(0, idx)].distanceToNextKm * 0.5) / TOTAL_LOOP_KM
}

/** Raised-cosine trench depth (positive = below grade) at a loop fraction. */
function trenchDepth(fraction: number, center: number): number {
  const d = Math.abs(wrappedDelta(fraction, center))
  if (d >= TRENCH_HALF_WIDTH) return 0
  return TRENCH_DEPTH * 0.5 * (1 + Math.cos((Math.PI * d) / TRENCH_HALF_WIDTH))
}

/** d(trenchDepth)/d(fraction) — mirrors hillGrade with the sign convention of a dip. */
function trenchGrade(fraction: number, center: number): number {
  const d = wrappedDelta(fraction, center)
  const a = Math.abs(d)
  if (a >= TRENCH_HALF_WIDTH) return 0
  const slopeOnA = -TRENCH_DEPTH * 0.5 * (Math.PI / TRENCH_HALF_WIDTH) * Math.sin((Math.PI * a) / TRENCH_HALF_WIDTH)
  return d < 0 ? -slopeOnA : slopeOnA
}

// ── The mountain road ────────────────────────────────────────────────────────
// Centerline of the country road on the hill approach: parallel to the tracks
// on the driver's left, then it eases away toward the mountain range and is
// gone. Computed HERE so both its builder (Scenery) and everything that must
// keep off the asphalt (Scenery's houses/trees, City's background buildings)
// share the exact same path.
export interface RoadSample {
  x: number
  z: number
  /** Track height at this sample's t — feeds groundHeightAt for the road's y. */
  trackY: number
  /** Signed lateral offset from the track centerline (negative = driver's left). */
  off: number
}

export function mountainRoadPath(track: Track): RoadSample[] {
  const center = hillCenterFraction()
  // Window chosen to clear every left-side platform: Kanazawa and Takayama
  // (markers ~center-0.086 / ~center-0.068) both have doorSide 'left' — the
  // road's side — and an earlier window ran the asphalt flush along both
  // platforms, its cut edge popping in mid-station. Starting past
  // Takayama's platform leaves only Uji and Kiyomizu in range, whose
  // platforms sit on the RIGHT side of the tracks.
  const t0 = center - 0.0615
  const tVeer = center - 0.044
  const t1 = center - 0.016
  const SAMPLES = 220
  const samples: RoadSample[] = []
  const p = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  for (let i = 0; i <= SAMPLES; i++) {
    const s = i / SAMPLES
    const t = t0 + (t1 - t0) * s
    track.pointAt(t, p)
    track.tangentAt(t, tangent)
    const nx = -tangent.z
    const nz = tangent.x
    const invLen = 1 / Math.hypot(nx, nz)
    const veerRaw = THREE.MathUtils.clamp((t - tVeer) / (t1 - tVeer), 0, 1)
    const veer = veerRaw * veerRaw * (3 - 2 * veerRaw) // smoothstep ease
    const off = -(17 + Math.pow(veer, 1.35) * 640)
    samples.push({ x: p.x + nx * invLen * off, z: p.z + nz * invLen * off, trackY: p.y, off })
  }
  return samples
}

/** Signed shortest distance from `fraction` to `center` around the closed loop, in [-0.5, 0.5). */
function wrappedDelta(fraction: number, center: number): number {
  let d = fraction - center
  d -= Math.round(d)
  return d
}

/** Smooth raised-cosine hill height at a given arc-length fraction of the loop. */
function hillHeight(fraction: number, center: number): number {
  const d = Math.abs(wrappedDelta(fraction, center))
  if (d >= HILL_HALF_WIDTH) return 0
  return HILL_PEAK * 0.5 * (1 + Math.cos((Math.PI * d) / HILL_HALF_WIDTH))
}

/** d(hillHeight)/d(fraction): positive while climbing toward the crest, negative past it. */
function hillGrade(fraction: number, center: number): number {
  const d = wrappedDelta(fraction, center)
  const a = Math.abs(d)
  if (a >= HILL_HALF_WIDTH) return 0
  const slopeOnA = -HILL_PEAK * 0.5 * (Math.PI / HILL_HALF_WIDTH) * Math.sin((Math.PI * a) / HILL_HALF_WIDTH)
  // Before the crest (d < 0) height grows with fraction, so flip the |d|-slope's sign.
  return d < 0 ? -slopeOnA : slopeOnA
}

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
    // Deliberately flat: the hill is added analytically in Track.pointAt /
    // tangentAt. Baking it into these control points made the spline ring
    // below ground on the approaches (see Track.pointAt).
    points.push(new THREE.Vector3(x, 0, z))
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
