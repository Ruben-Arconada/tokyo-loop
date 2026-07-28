import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Track } from './Track'
import { groundHeightAt, HILL_STATION_ID, mountainRoadPath, trenchPortalOffset, terrainRelief, BASE_GROUND_Y } from './Track'
import type { DayNightCycle } from './DayNightCycle'
import { STATIONS, type ZoneTier } from '../data/stations'
import { makeCloudTexture, makeNeonSignTexture, makeWindowGridTexture, makeRoofTileTexture, applyProgressiveWindows } from './signage'
import { registerPool, applySeasonToPool, type Season, type SeasonalPool, type Weather } from './Seasons'
import { SakuraCanopyCloud, PetalCarpet, makeLumpySphereGeometry, type CarpetSpot } from './SakuraCanopy'
import { worldStream, mulberry32 } from './Rng'
import { tagGroup } from './worldHash'

const N = STATIONS.length

// Vertical neon sign copy — generic Japanese shop-sign words (izakaya, karaoke,
// ramen, pachinko, sushi, coffee), not real brands.
const NEON_SIGNS: { text: string; bg: string; fg: string }[] = [
  { text: '居酒屋', bg: '#8a1f24', fg: '#ffd9a0' },
  { text: 'カラオケ', bg: '#182a66', fg: '#7de0ff' },
  { text: 'ラーメン', bg: '#a33f14', fg: '#fff2c8' },
  { text: 'パチンコ', bg: '#5c1660', fg: '#ff9df2' },
  { text: '寿司', bg: '#0f3d33', fg: '#a5ffd8' },
  { text: '喫茶', bg: '#3d2a14', fg: '#ffcf8a' },
]

const CLOUD_COUNT = 26
const PETALS_PER_CLUSTER = 40

// Billboarded cloud quads in one InstancedMesh: the vertex shader re-derives
// each instance's center + scale and re-expands the quad along the camera's
// right/up axes, so all clouds face the cab from anywhere on the loop in a
// single draw call.
const CLOUD_VERTEX = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 center = instanceMatrix[3].xyz;
  // Perpetual slow drift: the whole ring of clouds orbits the loop center
  // (~30 min per lap), so the sky is never the same picture twice.
  float a = uTime * 0.0035;
  float ca = cos(a);
  float sa = sin(a);
  center.xz = mat2(ca, -sa, sa, ca) * center.xz;
  float sx = length(instanceMatrix[0].xyz);
  float sy = length(instanceMatrix[1].xyz);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = center + camRight * position.x * sx + camUp * position.y * sy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`
const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 tint;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(map, vUv);
  gl_FragColor = vec4(tex.rgb * tint, tex.a * opacity);
}
`

interface CrossingLights {
  a: THREE.MeshStandardMaterial
  b: THREE.MeshStandardMaterial
}

/**
 * Everything that says "Japan" beyond the platforms themselves: horizon
 * landmarks (Fuji, Tokyo Tower, Skytree), sakura and pines, shitamachi house
 * rows, utility poles with sagging wires, vertical neon signs, level
 * crossings, and drifting clouds. All heavy repetition is instanced; the
 * only per-frame CPU work is a handful of material color/intensity updates.
 */
export class Scenery {
  private scene: THREE.Scene
  private track: Track
  private time = 0

  private fujiBodyMat!: THREE.MeshBasicMaterial
  private fujiSnowMat!: THREE.MeshBasicMaterial
  private towerGlowMat!: THREE.MeshStandardMaterial
  private skytreeMat!: THREE.MeshStandardMaterial
  private skytreeGlowMat!: THREE.MeshStandardMaterial
  private neonMats: THREE.MeshStandardMaterial[] = []
  private houseWindowMat!: THREE.MeshStandardMaterial
  private skylineMat!: THREE.MeshStandardMaterial
  private bridgeGlowMat!: THREE.MeshStandardMaterial
  private cloudMat!: THREE.ShaderMaterial
  private crossingLights: CrossingLights[] = []
  private crossingT = -1
  /** XZ samples of the mountain road's centerline — houses/trees/scrub use these to keep off the asphalt. */
  private roadSamples: { x: number; z: number }[] = []
  /** `always` marks clusters that bloom (and shed petals) in every season — the Komagome garden. */
  private sakuraClusters: { x: number; z: number; always: boolean }[] = []
  private petalsMesh: THREE.Points | null = null
  private petalSeeds!: Float32Array
  private sakuraCloud = new SakuraCanopyCloud()
  private petalCarpet = new PetalCarpet()
  /** Card-cloud pool ranges + carpet spots, collected by every tree builder and consumed by finalizeCanopies(). */
  private canopyCardPools: { kind: 'sakura' | 'sakuraEver' | 'broadleaf'; start: number; count: number }[] = []
  private carpetSpots: CarpetSpot[] = []
  /** Everything that changes color with the season, registered at build time. */
  private seasonalPools: SeasonalPool[] = []
  private season: Season = 'spring'
  /** Winter drops Fuji's snowline: two prebuilt caps, one visible at a time. */
  private fujiSnowRegular!: THREE.Mesh
  private fujiSnowWinter!: THREE.Mesh
  private cloudsMesh!: THREE.InstancedMesh
  private weatherLook: Weather = 'clear'
  /** Sea surface texture, scrolled slowly in update() so the bay is never a still photograph. */
  private seaTexture: THREE.CanvasTexture | null = null
  private foamMat: THREE.MeshBasicMaterial | null = null
  /** True while the twin red lamps are lit (train nearby) — Game reads flips to drive the kan-kan bell. */
  crossingBellActive = false
  crossingBlinkPhase = false

  // One draw sequence per SYSTEM, all derived from the world seed. Separate
  // streams are the whole point: adding a random call to the vegetation can
  // no longer shift where a house or a neon sign lands. Field initializers
  // run before the constructor body, so the builders below already have them.
  private rngTerrain = worldStream('terrain')
  private rngSkyline = worldStream('skyline')
  private rngHouses = worldStream('houses')
  private rngVeg = worldStream('vegetation')
  private rngPetals = worldStream('petals')
  private rngSignage = worldStream('signage')
  // No 'trackside' field: poles, distance boards and crossings are placed
  // purely from track geometry — not a single random draw between them.
  private rngCoast = worldStream('coast')
  private rngTunnel = worldStream('tunnel')
  private rngClouds = worldStream('clouds')

  constructor(scene: THREE.Scene, track: Track) {
    this.scene = scene
    this.track = track
    this.buildHorizonLandmarks()
    this.buildRainbowBridge()
    this.buildMountainRoad() // FIRST among the randomized builders: skyline ring, houses and vegetation all keep off the asphalt
    this.buildSkylineRing()
    this.buildDistantRanges()
    this.buildVegetation()
    this.buildSakuraPetals()
    this.buildHouseRows()
    this.buildHillDressing()
    this.buildApproachBoards()
    this.buildUtilityPoles()
    this.buildNeonSigns()
    this.buildCrossings()
    this.buildTunnel()
    this.buildCoast()
    this.buildClouds()
    // LAST: every tree builder above has fed the card cloud by now — one
    // instanced mesh for all crowns on the ring, pools registered over its
    // tint attribute (which only exists after finalize).
    this.finalizeCanopies()
  }

  private finalizeCanopies() {
    this.sakuraCloud.finalize(this.scene)
    for (const p of this.canopyCardPools) {
      this.seasonalPools.push(registerPool(p.kind, this.sakuraCloud.colorAttr!, p.start, p.count))
    }
    this.petalCarpet.build(this.scene, this.carpetSpots)
  }

  /**
   * The great bay suspension bridge (outward from Enoshima): two white
   * towers, a deck and main cables — with a soft rainbow illumination after
   * dark, in the family of Japan's big crossings. The coast's own landmark.
   */
  private buildRainbowBridge() {
    // 620 → 950: with the coast in (shoreline ~95 out), both ends of the
    // span fade out over open water instead of hanging over sand.
    const base = this.outwardFrom('enoshima', 950)
    const g = new THREE.Group()
    g.position.copy(base)
    g.position.y = -0.58 // tower feet buried under the ground plane
    // Face the bridge roughly along the shoreline (perpendicular to outward).
    g.rotation.y = Math.atan2(base.x, base.z) + Math.PI / 2

    const towerMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.5, fog: false })
    this.bridgeGlowMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5, fog: false })
    const span = 460
    const towerH = 120
    for (const tx of [-span / 2, span / 2]) {
      for (const tz of [-9, 9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(7, towerH, 6), towerMat)
        leg.position.set(tx, towerH / 2, tz)
        g.add(leg)
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 30), towerMat)
      cap.position.set(tx, towerH + 3, 0)
      g.add(cap)
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span * 2.1, 5, 24), this.bridgeGlowMat)
    deck.position.y = 46
    g.add(deck)
    // Anchorages: the deck dives into a concrete block at each end instead
    // of stopping dead in mid-air (it read as a broken structure once the
    // coast put real water under it — Yui, round 1).
    for (const ax of [-span * 1.05, span * 1.05]) {
      const anchor = new THREE.Mesh(new THREE.BoxGeometry(34, 54, 30), towerMat)
      anchor.position.set(ax, 26, 0)
      g.add(anchor)
    }
    // Main cables: catenary polylines between tower tops, sagging to deck mid-span.
    const cablePts: number[] = []
    const SEG = 14
    for (const tz of [-10, 10]) {
      for (let s = 0; s < SEG; s++) {
        const f0 = s / SEG
        const f1 = (s + 1) / SEG
        const xAt = (f: number) => -span / 2 + span * f
        const yAt = (f: number) => towerH + 4 - Math.sin(f * Math.PI) * (towerH - 58)
        cablePts.push(xAt(f0), yAt(f0), tz, xAt(f1), yAt(f1), tz)
      }
    }
    const cableGeo = new THREE.BufferGeometry()
    cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3))
    const cables = new THREE.LineSegments(cableGeo, new THREE.LineBasicMaterial({ color: 0xcdd6e0, fog: false }))
    g.add(cables)
    this.scene.add(tagGroup(g, 'rainbow-bridge'))
  }

  /**
   * A light drift of sakura petals around each green-station tree cluster —
   * one Points cloud, positions nudged on the CPU (a few hundred verts, cheap)
   * so the trees get their 1% of life.
   */
  private buildSakuraPetals() {
    const total = this.sakuraClusters.length * PETALS_PER_CLUSTER
    if (!total) return
    const positions = new Float32Array(total * 3)
    this.petalSeeds = new Float32Array(total * 4) // cx offset, cz offset, phase, fall speed
    let i = 0
    for (const c of this.sakuraClusters) {
      for (let k = 0; k < PETALS_PER_CLUSTER; k++) {
        const ox = (this.rngPetals() - 0.5) * 26
        const oz = (this.rngPetals() - 0.5) * 26
        positions[i * 3] = c.x + ox
        positions[i * 3 + 1] = 1 + this.rngPetals() * 7
        positions[i * 3 + 2] = c.z + oz
        this.petalSeeds[i * 4] = c.x + ox
        this.petalSeeds[i * 4 + 1] = c.z + oz
        this.petalSeeds[i * 4 + 2] = this.rngPetals() * Math.PI * 2
        this.petalSeeds[i * 4 + 3] = 0.55 + this.rngPetals() * 0.7
        i++
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.petalsMesh = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xf9cede, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.9 }),
    )
    this.petalsMesh.frustumCulled = false
    // update() rewrites every position each frame, so the live buffer says
    // nothing about determinism — hand the fingerprint the seed table that
    // the animation reads from instead (see worldHash.ts).
    this.petalsMesh.userData.seedTable = this.petalSeeds
    this.scene.add(tagGroup(this.petalsMesh, 'petal-drift'))
  }

  /**
   * A belt of distant tower blocks outside (and a few inside) the loop, so
   * looking away from the track still reads as endless Tokyo instead of an
   * empty plain. Far enough that fog does the atmospheric-perspective work.
   */
  private buildSkylineRing() {
    const outerCount = 170
    const innerCount = 60
    const count = outerCount + innerCount
    const tex = makeWindowGridTexture(10, 16, { glass: '#4a5361', facade: '#565d68', litChance: 0.45 })
    this.skylineMat = new THREE.MeshStandardMaterial({
      color: 0x8b93a0,
      map: tex.map,
      emissive: 0xffffff,
      emissiveMap: tex.emissiveMap,
      emissiveIntensity: 1.2,
      roughness: 0.85,
    })
    applyProgressiveWindows(this.skylineMat)
    const ring = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.skylineMat, count)
    ring.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()
    const dir = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      // Anchored to the track itself (outward band, plus a thinner inward
      // band), so the belt hugs the loop's shape at any LOOP_SCALE instead
      // of relying on hand-tuned ellipse radii.
      const outer = i < outerCount
      const h = 45 + this.rngSkyline() * 130
      const w = 30 + this.rngSkyline() * 45
      const d = 30 + this.rngSkyline() * 45
      // Resample-not-skip (identity matrices render at the origin): the road's
      // veer crosses this outer band for its last ~400 units, and these towers
      // get random yaw — clearance must cover the rotated half-diagonal.
      let x = 0
      let z = 0
      const clearance = 6 + Math.hypot(w, d) / 2
      let y = h / 2 - 2
      for (let attempt = 0; attempt < 6; attempt++) {
        const t = (outer ? i / outerCount : (i - outerCount) / innerCount) + this.rngSkyline() * 0.004
        const tt = ((t % 1) + 1) % 1
        const p = this.track.pointAt(t)
        dir.set(p.x, 0, p.z).normalize()
        // Outward towers on the bay arc would stand IN the sea — push them
        // across the water instead: the industrial far shore of the bay.
        const bayArc = outer && tt > 0.76 && tt < 0.96
        const off = bayArc
          ? 3000 + this.rngSkyline() * 700
          : (outer ? 1 : -1) * (260 + this.rngSkyline() * (outer ? 950 : 700))
        x = p.x + dir.x * off + (this.rngSkyline() - 0.5) * 200
        z = p.z + dir.z * off + (this.rngSkyline() - 0.5) * 200
        // Terrain 2.0: the far plain rolls, so far towers ride the same
        // relief the ground plane does (the bay's far shore stays flat —
        // the plane's relief is masked there too).
        y = h / 2 - 2 + (bayArc ? 0 : terrainRelief(x, z, off))
        if (!this.isNearRoad(x, z, clearance)) break
      }
      dummy.position.set(x, y, z)
      dummy.scale.set(w, h, d)
      dummy.rotation.set(0, this.rngSkyline() * Math.PI, 0)
      dummy.updateMatrix()
      ring.setMatrixAt(i, dummy.matrix)
      tint.setHSL(0.6, 0.04 + this.rngSkyline() * 0.05, 0.55 + this.rngSkyline() * 0.2)
      ring.setColorAt(i, tint)
    }
    ring.instanceMatrix.needsUpdate = true
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true
    this.scene.add(tagGroup(ring, 'skyline-towers'))
  }

  /**
   * Distant mountain ranges past the skyline belt — procedural, fog-hazed,
   * clustered ridges instead of a flat empty horizon. Deliberately procedural
   * rather than a painted backdrop: a static image only matches ONE hour of
   * the day/night cycle, while real geometry inherits fog and light for free.
   * Two arcs stay clear: the bay stretch (future sea) and the hill stretch
   * (its own range already stands there, tied to the mountain road).
   */
  private buildDistantRanges() {
    const CLUSTERS = 8
    const PEAKS_MAX = CLUSTERS * 3
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })
    const peaks = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 9), mat, PEAKS_MAX)
    peaks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PEAKS_MAX * 3), 3)
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()
    const dir = new THREE.Vector3()
    let pi = 0
    for (let c = 0; c < CLUSTERS; c++) {
      const t = c / CLUSTERS + (this.rngTerrain() - 0.5) * 0.04
      const tt = ((t % 1) + 1) % 1
      if (tt > 0.70 && tt < 0.95) continue // bay arc: keep the horizon open for the sea
      if (tt > 0.19 && tt < 0.31) continue // hill arc: the road's own range lives here
      const p = this.track.pointAt(tt)
      dir.set(p.x, 0, p.z).normalize()
      const peaksHere = 2 + Math.floor(this.rngTerrain() * 2)
      for (let k = 0; k < peaksHere && pi < PEAKS_MAX; k++) {
        const out = 1600 + this.rngTerrain() * 900
        const alongJitter = (this.rngTerrain() - 0.5) * 700
        const side = new THREE.Vector3(-dir.z, 0, dir.x)
        const base = new THREE.Vector3(p.x, 0, p.z)
          .addScaledVector(dir, out)
          .addScaledVector(side, alongJitter)
        const h = 200 + this.rngTerrain() * 230
        const r = 420 + this.rngTerrain() * 380
        // Buried 15 deep: the plain now rolls ±14 (terrain 2.0), and a
        // floating mountain skirt is worse than losing a few meters of cone.
        dummy.position.set(base.x, h * 0.5 - 15, base.z)
        dummy.scale.set(r, h, r)
        dummy.rotation.set(0, this.rngTerrain() * Math.PI, 0)
        dummy.updateMatrix()
        peaks.setMatrixAt(pi, dummy.matrix)
        tint.setHSL(0.4 + this.rngTerrain() * 0.04, 0.2, 0.16 + this.rngTerrain() * 0.06)
        peaks.setColorAt(pi, tint)
        pi++
      }
    }
    peaks.count = pi
    peaks.instanceMatrix.needsUpdate = true
    if (peaks.instanceColor) peaks.instanceColor.needsUpdate = true
    this.scene.add(tagGroup(peaks, 'horizon-peaks'))
    // The horizon votes with the season too: ochre koyo ridges in autumn,
    // deep summer green, snowed-in winter (the panel caught spring peaks
    // photobombing the autumn postcard).
    this.seasonalPools.push(registerPool('mountain', peaks.instanceColor!))
  }

  /** Loop-center-relative outward placement: from a station's track point, step away from the loop center. */
  private outwardFrom(stationId: string, distance: number, y = 0): THREE.Vector3 {
    const idx = STATIONS.findIndex((s) => s.id === stationId)
    const marker = this.track.markerFor(Math.max(0, idx))
    const p = this.track.pointAt(marker.tFraction)
    const out = new THREE.Vector3(p.x, 0, p.z).normalize()
    return new THREE.Vector3(p.x + out.x * distance, y, p.z + out.z * distance)
  }

  /** Which station's segment a loop fraction falls in — station markers are sorted ascending, so the last one at or before `t` owns it. */
  private tierAtT(t: number): ZoneTier {
    const tt = ((t % 1) + 1) % 1
    for (let s = N - 1; s >= 0; s--) {
      if (tt >= this.track.markerFor(s).tFraction) return STATIONS[s].theme.tier
    }
    return STATIONS[N - 1].theme.tier
  }

  /**
   * Loop-fraction sampler biased toward quiet-tier stretches — vegetation
   * placement's half of the rural/mid/urban contrast (the other half is
   * density tables in buildHouseRows/buildNeonSigns). A few rejection
   * attempts at init time are free; this never runs per-frame.
   */
  private sampleTierWeightedT(): number {
    const TIER_VEG_WEIGHT: Record<ZoneTier, number> = { quiet: 1, mid: 0.35, urban: 0.05 }
    for (let attempt = 0; attempt < 8; attempt++) {
      const t = this.rngTerrain()
      if (this.rngTerrain() < TIER_VEG_WEIGHT[this.tierAtT(t)]) return t
    }
    return this.rngTerrain()
  }

  private buildHorizonLandmarks() {
    // ——— Mount Fuji, far to the southwest, drawn fog-free like a distant
    // backdrop; its color is retinted every frame to sit against the sky.
    // Kept slim and far away so it reads as a mountain ~100 km out, not a
    // hill beside the tracks.
    this.fujiBodyMat = new THREE.MeshBasicMaterial({ color: 0x5a6b8a, fog: false })
    this.fujiSnowMat = new THREE.MeshBasicMaterial({ color: 0xe8edf5, fog: false })
    // Concave shield profile: exponent > 1 pulls the mid-slopes IN (slender
    // summit flanks flaring into a wide skirt). The first attempt used 0.7,
    // which bulges the other way and turned the mountain into a giant dome.
    const FUJI_R = 1750
    const FUJI_H = 780
    const fujiProfile = (h01: number) => Math.pow(1 - h01, 1.45)
    const bodyPts: THREE.Vector2[] = []
    for (let i = 0; i <= 24; i++) {
      const h = i / 24
      bodyPts.push(new THREE.Vector2(Math.max(0.001, fujiProfile(h)) * FUJI_R, h * FUJI_H))
    }
    const fuji = new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 48), this.fujiBodyMat)
    const fujiPos = new THREE.Vector3(-3650, -60, 2600) // base sunk under the plain
    fuji.position.copy(fujiPos)
    this.scene.add(tagGroup(fuji, 'fuji-body'))
    // Snow cap: same profile pushed 4% proud (coplanar cones shimmered), and
    // with a JAGGED lower edge — vertices near the snowline wobble with the
    // angle so it reads as fingers of snow, not a clean ring. Built twice:
    // the usual cap plus a much lower winter snowline, toggled by season.
    const makeSnowCap = (snowFrom: number) => {
      const snowPts: THREE.Vector2[] = []
      for (let i = 0; i <= 12; i++) {
        const h = snowFrom + (i / 12) * (1 - snowFrom)
        snowPts.push(new THREE.Vector2(Math.max(0.001, fujiProfile(h)) * FUJI_R * 1.04, h * FUJI_H))
      }
      const snowGeo = new THREE.LatheGeometry(snowPts, 48)
      const sp = snowGeo.attributes.position
      const snowBaseY = snowFrom * FUJI_H
      for (let i = 0; i < sp.count; i++) {
        const y = sp.getY(i)
        const fall = 1 - Math.min(1, (y - snowBaseY) / (FUJI_H * 0.12))
        if (fall <= 0) continue
        const a = Math.atan2(sp.getZ(i), sp.getX(i))
        // Biased downward: snow fingers hang below the ring line, they don't rise.
        const wobble = ((Math.sin(a * 7) * 0.6 + Math.sin(a * 13 + 1.7) * 0.4) - 0.55) * FUJI_H * 0.05
        sp.setY(i, y + wobble * fall)
      }
      snowGeo.computeVertexNormals()
      const snow = new THREE.Mesh(snowGeo, this.fujiSnowMat)
      snow.position.copy(fujiPos)
      this.scene.add(tagGroup(snow, 'fuji-snow'))
      return snow
    }
    this.fujiSnowRegular = makeSnowCap(0.55)
    this.fujiSnowWinter = makeSnowCap(0.28)
    this.fujiSnowWinter.visible = false

    // ——— The red port tower by the Kobe stop: a lattice silhouette in the
    // Tokyo Tower / Kobe Port Tower family. NEGATIVE outward distance =
    // inland, INSIDE the loop, so it rises behind the city, not in the sea.
    // Landmark materials ignore fog — real towers pierce the haze and stay
    // visible as icons; update() fakes atmospheric fading by day instead.
    this.towerGlowMat = new THREE.MeshStandardMaterial({ color: 0xd8442a, emissive: 0xff5514, emissiveIntensity: 0, roughness: 0.6, fog: false })
    const towerBase = this.outwardFrom('kobe', -420)
    const tower = new THREE.Group()
    tower.position.copy(towerBase)
    tower.position.y = -0.58 // feet buried just under the ground plane
    const legSpread = 42
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.5, 120, 6), this.towerGlowMat)
      leg.position.set(lx * legSpread * 0.5, 60, lz * legSpread * 0.5)
      leg.rotation.z = -lx * 0.16
      leg.rotation.x = lz * 0.16
      tower.add(leg)
    }
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(10, 26, 130, 8), this.towerGlowMat)
    mid.position.y = 175
    tower.add(mid)
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.5 }))
    deck.position.y = 122
    tower.add(deck)
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 6, 90, 6), this.towerGlowMat)
    spire.position.y = 285
    tower.add(spire)
    this.scene.add(tagGroup(tower, 'kobe-tower'))

    // ——— A Skytree-like broadcast spire beyond the northeast rim: slender lattice, cool white at night.
    this.skytreeMat = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, roughness: 0.45, metalness: 0.3, fog: false })
    this.skytreeGlowMat = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, emissive: 0x9fd8ff, emissiveIntensity: 0, roughness: 0.45, fog: false })
    // Biased toward -z (game east), rising far behind the old-town rooftops.
    const skytreeBase = this.outwardFrom('kanazawa', 950).add(new THREE.Vector3(-300, 0, -700))
    const skytree = new THREE.Group()
    skytree.position.copy(skytreeBase)
    skytree.position.y = -0.58
    const st1 = new THREE.Mesh(new THREE.CylinderGeometry(9, 22, 260, 8), this.skytreeGlowMat)
    st1.position.y = 130
    skytree.add(st1)
    const deck1 = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 10, 10), this.skytreeMat)
    deck1.position.y = 235
    skytree.add(deck1)
    const st2 = new THREE.Mesh(new THREE.CylinderGeometry(5, 9, 110, 8), this.skytreeGlowMat)
    st2.position.y = 315
    skytree.add(st2)
    const deck2 = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 8, 10), this.skytreeMat)
    deck2.position.y = 355
    skytree.add(deck2)
    const stSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 3, 90, 6), this.skytreeGlowMat)
    stSpire.position.y = 415
    skytree.add(stSpire)
    this.scene.add(tagGroup(skytree, 'kanazawa-spire'))
  }

  private buildVegetation() {
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()

    // ——— Sakura: clustered near green-district stations, plus a dedicated
    // GROVE hugging the hill station's platform — Komagome's garden blooms
    // in every season (Rubén's one non-negotiable), so the autumn hill gets
    // momiji slopes AND cherry blossom over the platform at once.
    const greenStations = STATIONS.map((s, i) => ({ s, i })).filter(({ s }) => s.theme.district === 'green')
    const sakuraPerStation = 14
    const GROVE_TREES = 12
    const sakuraCount = greenStations.length * sakuraPerStation + GROVE_TREES
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.95 })
    const sakuraTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.42, 3.2, 6), trunkMat, sakuraCount)
    // The old sphere blobs live on ONLY as shadow proxies: invisible in the
    // color pass (colorWrite off, and no depth writes so they can't punch
    // holes in the cards drawn around them) but still shadow-casting, so
    // the billboard crowns keep grounded shadows for free.
    const blossomMat = new THREE.MeshStandardMaterial({ color: 0xf5c9dc, roughness: 0.9, colorWrite: false, depthWrite: false })
    const sakuraCanopies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), blossomMat, sakuraCount * 3)
    sakuraTrunks.castShadow = sakuraCanopies.castShadow = true

    let ti = 0
    let ci = 0
    for (const { s: stationDef, i } of greenStations) {
      const marker = this.track.markerFor(i)
      const isHill = stationDef.id === HILL_STATION_ID
      const clusterCardStart = this.sakuraCloud.cardCount
      let sumX = 0
      let sumZ = 0
      for (let k = 0; k < sakuraPerStation; k++) {
        // Spread along the approach to the station, on the side opposite the platform.
        const t = marker.tFraction + (this.rngVeg() - 0.35) * 0.012
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        // `normal` here points to the driver's RIGHT, so the platform side
        // (where the park behind the station lives) is -normal for 'left'.
        const side = STATIONS[i].doorSide === 'left' ? -1 : 1
        const off = 17 + this.rngVeg() * 24
        const pos = p.clone().addScaledVector(normal, side * off)
        const scale = 0.8 + this.rngVeg() * 0.7
        sumX += pos.x
        sumZ += pos.z

        const groundY = groundHeightAt(p.y, side * off)

        dummy.position.set(pos.x, groundY + 1.6 * scale - 0.1, pos.z)
        dummy.scale.setScalar(scale)
        dummy.rotation.set(0, this.rngVeg() * Math.PI, 0)
        dummy.updateMatrix()
        sakuraTrunks.setMatrixAt(ti++, dummy.matrix)

        for (let b = 0; b < 3; b++) {
          // ×1.2 over the visible-era size: the card crowns grew, and the
          // shadow should keep pace with the fluff it grounds.
          const br = (2.4 + this.rngVeg() * 1.4) * scale
          dummy.position.set(
            pos.x + (this.rngVeg() - 0.5) * 2.4 * scale,
            groundY + (3.8 + this.rngVeg() * 1.4) * scale,
            pos.z + (this.rngVeg() - 0.5) * 2.4 * scale,
          )
          dummy.scale.set(br, br * 0.8, br)
          dummy.rotation.set(0, 0, 0)
          dummy.updateMatrix()
          sakuraCanopies.setMatrixAt(ci, dummy.matrix)
          ci++
        }
        this.sakuraCloud.addTree(pos.x, groundY, pos.z, scale, 'sakura', isHill)
        this.carpetSpots.push({ x: pos.x, y: groundY, z: pos.z, radius: (1.7 + this.rngVeg()) * scale, evergreen: isHill })
      }
      this.sakuraClusters.push({ x: sumX / sakuraPerStation, z: sumZ / sakuraPerStation, always: isHill })
      // The hill garden's cluster blooms all year; the rest follow spring.
      this.canopyCardPools.push({ kind: isHill ? 'sakuraEver' : 'sakura', start: clusterCardStart, count: this.sakuraCloud.cardCount - clusterCardStart })
    }

    // ——— The Komagome platform grove: a ring of big cherries wrapping the
    // hill station itself — over the canopy behind the platform, framing the
    // opposite side the cab looks out on, and closing both platform ends.
    {
      const hillIdx = STATIONS.findIndex((s) => s.id === HILL_STATION_ID)
      const marker = this.track.markerFor(Math.max(0, hillIdx))
      const platformSide = STATIONS[Math.max(0, hillIdx)].doorSide === 'left' ? -1 : 1 // sign against `normal` (driver's right)
      const groveCardStart = this.sakuraCloud.cardCount
      // [along-track, lateral (platform-side positive), scale] — kept clear
      // of the rail corridor (canopies stop ~5 units short of the track).
      const groveSpots: [number, number, number][] = [
        [-26, 19, 1.35], [-9, 22, 1.5], [8, 20, 1.45], [25, 21, 1.3],
        [-20, -12, 1.2], [-2, -14, 1.35], [16, -12, 1.25],
        [-48, 11, 1.2], [-45, -11, 1.15], [45, 11, 1.2], [49, -11, 1.15], [56, 12, 1.1],
      ]
      let sumX = 0
      let sumZ = 0
      const len = this.track.getLength()
      for (const [along, lat, scale] of groveSpots) {
        const t = marker.tFraction + along / len
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const off = platformSide * lat
        const pos = p.clone().addScaledVector(normal, off)
        const groundY = groundHeightAt(p.y, off)
        sumX += pos.x
        sumZ += pos.z

        dummy.position.set(pos.x, groundY + 1.6 * scale - 0.1, pos.z)
        dummy.scale.setScalar(scale)
        dummy.rotation.set(0, this.rngVeg() * Math.PI, 0)
        dummy.updateMatrix()
        sakuraTrunks.setMatrixAt(ti++, dummy.matrix)
        for (let b = 0; b < 3; b++) {
          const br = (2.3 + this.rngVeg() * 1.3) * scale
          dummy.position.set(
            pos.x + (this.rngVeg() - 0.5) * 2.6 * scale,
            groundY + (3.6 + this.rngVeg() * 1.5) * scale,
            pos.z + (this.rngVeg() - 0.5) * 2.6 * scale,
          )
          dummy.scale.set(br, br * 0.78, br)
          dummy.rotation.set(0, 0, 0)
          dummy.updateMatrix()
          sakuraCanopies.setMatrixAt(ci, dummy.matrix)
          ci++
        }
        this.sakuraCloud.addTree(pos.x, groundY, pos.z, scale, 'sakura', true)
        // The grove sheds heavier than anyone: a disc under the crown and a
        // second one thrown toward the platform, so the drift reads as
        // covering the station and not just ringing the trunks.
        this.carpetSpots.push({ x: pos.x, y: groundY, z: pos.z, radius: (1.9 + this.rngVeg()) * scale, evergreen: true })
        this.carpetSpots.push({
          x: pos.x + (this.rngVeg() - 0.5) * 7,
          y: groundY,
          z: pos.z + (this.rngVeg() - 0.5) * 7,
          radius: 1.3 + this.rngVeg() * 1.2,
          evergreen: true,
        })
      }
      this.sakuraClusters.push({ x: sumX / groveSpots.length, z: sumZ / groveSpots.length, always: true })
      this.canopyCardPools.push({ kind: 'sakuraEver', start: groveCardStart, count: this.sakuraCloud.cardCount - groveCardStart })
    }
    sakuraTrunks.count = ti
    sakuraCanopies.count = ci
    sakuraTrunks.instanceMatrix.needsUpdate = true
    sakuraCanopies.instanceMatrix.needsUpdate = true
        tagGroup(sakuraTrunks, 'sakura-trunks')
    tagGroup(sakuraCanopies, 'sakura-shadow')
    this.scene.add(sakuraTrunks, sakuraCanopies)

    // ——— Pines: dark conifers dotted along the loop, weighted HEAVILY toward
    // quiet-tier stretches (real rail-side tree lines) and nearly absent in
    // urban cores — part of the same structural zone contrast as the houses.
    const pineCount = 160
    const pineTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.32, 2.6, 5), trunkMat, pineCount)
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.95 })
    const pineFoliage = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.4, 7), pineMat, pineCount)
    pineFoliage.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pineCount * 3), 3)
    pineTrunks.castShadow = pineFoliage.castShadow = true
    for (let k = 0; k < pineCount; k++) {
      // Resample (never skip: a skipped instance would be an identity matrix
      // at the world origin) until the pine is off the mountain road.
      let p = this.track.pointAt(0)
      let side = 1
      let off = 14
      let pos = p.clone()
      for (let attempt = 0; attempt < 6; attempt++) {
        const t = this.sampleTierWeightedT()
        p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        side = this.rngVeg() < 0.5 ? 1 : -1
        off = 14 + this.rngVeg() * 55
        pos = p.clone().addScaledVector(normal, side * off)
        // The hole is centred on the CHORD, not the track: with the curve
        // 16.61 units off the chord, a plant at track-offset 30 could still
        // sit inside the ±26 opening. 44 − 16.61 = 27.4 > 26 clears it.
        if (this.track.trenchDepthAt(t) > 0.25 && off < 44) continue // over the trench hole
        if (!this.isNearRoad(pos.x, pos.z, 6.5)) break
      }
      const scale = 0.7 + this.rngVeg() * 0.9

      const groundY = groundHeightAt(p.y, side * off)

      dummy.position.set(pos.x, groundY + 1.3 * scale - 0.1, pos.z)
      dummy.scale.setScalar(scale)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      pineTrunks.setMatrixAt(k, dummy.matrix)

      dummy.position.set(pos.x, groundY + (2.6 + 2.2) * scale, pos.z)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      pineFoliage.setMatrixAt(k, dummy.matrix)
      tint.setHSL(0.32 + this.rngVeg() * 0.05, 0.32, 0.2 + this.rngVeg() * 0.1)
      pineFoliage.setColorAt(k, tint)
    }
    pineTrunks.instanceMatrix.needsUpdate = true
    pineFoliage.instanceMatrix.needsUpdate = true
    if (pineFoliage.instanceColor) pineFoliage.instanceColor.needsUpdate = true
        tagGroup(pineTrunks, 'pine-trunks')
    tagGroup(pineFoliage, 'pine-foliage')
    this.scene.add(pineTrunks, pineFoliage)
    this.seasonalPools.push(registerPool('pine', pineFoliage.instanceColor!))

    // ——— Low scrub: flattened bushes scattered in the band beyond the worn
    // corridor — filler texture that keeps the mid-ground from reading as
    // bare billiard felt, weighted toward quiet zones like the pines.
    const scrubCount = 520
    const scrubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })
    // Lumpy, not spherical: perfect balls showed their intersection seams
    // wherever two bushes overlapped; noised lumps melt into one mass.
    const scrub = new THREE.InstancedMesh(makeLumpySphereGeometry(1, 6, 5), scrubMat, scrubCount)
    scrub.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(scrubCount * 3), 3)
    for (let k = 0; k < scrubCount; k++) {
      // Same resample-not-skip rule as the pines (see above).
      let p = this.track.pointAt(0)
      let side = 1
      let off = 12
      let pos = p.clone()
      for (let attempt = 0; attempt < 6; attempt++) {
        const t = this.sampleTierWeightedT()
        p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        side = this.rngVeg() < 0.5 ? 1 : -1
        // Bias density toward the track: sqrt pushes samples inward.
        off = 12 + Math.sqrt(this.rngVeg()) * 55
        pos = p.clone().addScaledVector(normal, side * off)
        if (this.track.trenchDepthAt(t) > 0.25 && off < 44) continue // over the trench hole (chord-measured, see Game.ts)
        if (!this.isNearRoad(pos.x, pos.z, 5.5)) break
      }
      dummy.position.set(pos.x, groundHeightAt(p.y, side * off) + 0.1, pos.z)
      dummy.scale.set(0.5 + this.rngVeg() * 0.9, 0.2 + this.rngVeg() * 0.3, 0.5 + this.rngVeg() * 0.9)
      dummy.rotation.set(0, this.rngVeg() * Math.PI, 0)
      dummy.updateMatrix()
      scrub.setMatrixAt(k, dummy.matrix)
      tint.setHSL(0.22 + this.rngVeg() * 0.13, 0.3 + this.rngVeg() * 0.18, 0.18 + this.rngVeg() * 0.14)
      scrub.setColorAt(k, tint)
    }
    scrub.instanceMatrix.needsUpdate = true
    if (scrub.instanceColor) scrub.instanceColor.needsUpdate = true
        tagGroup(scrub, 'scrub')
    this.scene.add(scrub)
    this.seasonalPools.push(registerPool('scrub', scrub.instanceColor!))
  }

  /**
   * Shitamachi house rows, rebuilt "japonés a tope": every house is composed
   * from shared instanced pools — chamfered wall blocks (no more perfect
   * boxes), three roof silhouettes (kirizuma gable, yosemune hip, and their
   * irimoya stack), ridge caps, low block-wall fences with a gated entry
   * (mini roof over the gate), engawa porches with posts on the garden
   * archetypes, L-plans and two-story volumes. Entrances face the track so
   * the cab actually sees gates and porches. Still ~a dozen draw calls for
   * all 500 houses.
   */
  private buildHouseRows() {
    const dummy = new THREE.Object3D()
    dummy.rotation.order = 'YXZ' // yaw first, then the awning pitch
    const tint = new THREE.Color()
    const houseCount = 500

    // ——— Unit geometries ———
    // Chamfered wall block: one-segment rounded box = a 45° chamfer for 44
    // triangles. BoxGeometry-style per-face UVs keep the window texture flat.
    const wallGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.05)

    // Kirizuma gable prism (unit, scaled per instance), CLOSED underneath —
    // the open soffit let you see straight through the eaves into backfaces.
    const gableGeo = new THREE.BufferGeometry()
    const hw = 0.62 // slight eave overhang beyond the unit wall
    const gableVerts = new Float32Array([
      // front gable triangle
      -hw, 0, 0.62, hw, 0, 0.62, 0, 0.5, 0.62,
      // back gable triangle
      hw, 0, -0.62, -hw, 0, -0.62, 0, 0.5, -0.62,
      // left slope
      -hw, 0, 0.62, 0, 0.5, 0.62, 0, 0.5, -0.62, -hw, 0, 0.62, 0, 0.5, -0.62, -hw, 0, -0.62,
      // right slope
      hw, 0, 0.62, hw, 0, -0.62, 0, 0.5, -0.62, hw, 0, 0.62, 0, 0.5, -0.62, 0, 0.5, 0.62,
      // soffit (underside, facing down)
      -hw, 0, 0.62, -hw, 0, -0.62, hw, 0, -0.62, -hw, 0, 0.62, hw, 0, -0.62, hw, 0, 0.62,
    ])
    const gableUvs = new Float32Array([
      0, 0, 0.25, 0, 0.125, 0.2,
      0, 0, 0.25, 0, 0.125, 0.2,
      0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0,
      0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
      0, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0.1, 0.1, 0.1, 0,
    ])
    gableGeo.setAttribute('position', new THREE.BufferAttribute(gableVerts, 3))
    gableGeo.setAttribute('uv', new THREE.BufferAttribute(gableUvs, 2))
    gableGeo.computeVertexNormals()

    // Yosemune hip roof: four slopes meeting a short ridge — same winding
    // and eave conventions as the gable so both read as one tile family.
    const hipGeo = (() => {
      const hx = 0.66
      const hz = 0.66
      const rz = 0.26 // half-length of the top ridge
      const h = 0.5
      const v = new Float32Array([
        // front hip triangle (+z)
        -hx, 0, hz, hx, 0, hz, 0, h, rz,
        // back hip triangle (-z)
        hx, 0, -hz, -hx, 0, -hz, 0, h, -rz,
        // left slope
        -hx, 0, hz, 0, h, rz, 0, h, -rz, -hx, 0, hz, 0, h, -rz, -hx, 0, -hz,
        // right slope
        hx, 0, hz, hx, 0, -hz, 0, h, -rz, hx, 0, hz, 0, h, -rz, 0, h, rz,
        // soffit
        -hx, 0, hz, -hx, 0, -hz, hx, 0, -hz, -hx, 0, hz, hx, 0, -hz, hx, 0, hz,
      ])
      const uv = new Float32Array([
        0, 0, 1, 0, 0.5, 0.8,
        0, 0, 1, 0, 0.5, 0.8,
        0, 0, 0.3, 1, 0.7, 1, 0, 0, 0.7, 1, 1, 0,
        0, 0, 1, 0, 0.7, 1, 0, 0, 0.7, 1, 0.3, 1,
        0, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0.1, 0.1, 0.1, 0,
      ])
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(v, 3))
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      g.computeVertexNormals()
      return g
    })()

    const windowTex = (() => {
      // Tiny warm-window texture; alpha in the emissive map is each window's
      // personal dusk switch-on threshold (see applyProgressiveWindows).
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const ctx = canvas.getContext('2d')!
      // Light base: the map multiplies against per-instance wall tones AND
      // scene light, so a mid-gray here turned every shaded facade to mud.
      ctx.fillStyle = '#c7bfb2'
      ctx.fillRect(0, 0, 64, 64)
      const em = document.createElement('canvas')
      em.width = em.height = 64
      const emCtx = em.getContext('2d')!
      emCtx.clearRect(0, 0, 64, 64)
      for (const [x, y] of [[10, 22], [38, 22]]) {
        ctx.fillStyle = '#3a3f46'
        ctx.fillRect(x, y, 16, 20)
        if (this.rngHouses() < 0.75) {
          emCtx.fillStyle = `rgba(255,223,158,${(0.08 + this.rngHouses() * 0.9).toFixed(3)})`
          emCtx.fillRect(x, y, 16, 20)
        }
      }
      const map = new THREE.CanvasTexture(canvas)
      map.colorSpace = THREE.SRGBColorSpace
      const emissiveMap = new THREE.CanvasTexture(em)
      emissiveMap.colorSpace = THREE.SRGBColorSpace
      emissiveMap.generateMipmaps = false
      emissiveMap.minFilter = THREE.LinearFilter
      return { map, emissiveMap }
    })()

    this.houseWindowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: windowTex.map,
      emissive: 0xffffff,
      emissiveMap: windowTex.emissiveMap,
      emissiveIntensity: 1.1,
      roughness: 0.9,
    })
    applyProgressiveWindows(this.houseWindowMat)

    // ——— Instanced pools (capacities cover the worst-case archetype mix) ———
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, colored = true, shadows = true) => {
      const mesh = new THREE.InstancedMesh(geo, mat, cap)
      if (colored) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
      if (shadows) mesh.castShadow = true
      return mesh
    }
    const walls = mk(wallGeo, this.houseWindowMat, houseCount * 2)
    walls.receiveShadow = true
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeRoofTileTexture(), roughness: 0.8 })
    const gables = mk(gableGeo, roofMat, houseCount * 3)
    const hips = mk(hipGeo, roofMat, Math.ceil(houseCount * 0.9))
    const ridgeCapMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 })
    const ridgeCaps = mk(new THREE.BoxGeometry(1, 1, 1), ridgeCapMat, houseCount * 2)
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2e2622, roughness: 0.8 })
    const doors = mk(new THREE.PlaneGeometry(0.95, 1.9), doorMat, houseCount, false, false)
    // Block-wall fences (some wooden), the gated entrance's posts, and the
    // engawa porch: deck, posts and a lean-to awning.
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
    const fences = mk(new THREE.BoxGeometry(1, 1, 1), fenceMat, houseCount * 4)
    const gatePosts = mk(new THREE.BoxGeometry(0.22, 1.15, 0.22), fenceMat, houseCount * 2)
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85 })
    const decks = mk(new THREE.BoxGeometry(1, 0.2, 1.1), woodMat, Math.ceil(houseCount * 0.7), false)
    const deckPosts = mk(new THREE.CylinderGeometry(0.055, 0.055, 1, 5), woodMat, Math.ceil(houseCount * 0.7) * 3, false)
    const awningMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
    const awnings = mk(new THREE.BoxGeometry(1, 0.07, 1), awningMat, Math.ceil(houseCount * 0.7))
    // Packed-earth path from the gate to the front door — the one stroke
    // that says somebody walks in and out of here every day (Aiko).
    const pathGeo = new THREE.PlaneGeometry(1, 1)
    pathGeo.rotateX(-Math.PI / 2)
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xb5a284, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    const paths = mk(pathGeo, pathMat, houseCount, false, false)
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })
    const TUFTS_PER_HOUSE = 4
    // 5×3 sphere: a grass blob needs no more — halves the pool's triangles.
    const tufts = mk(new THREE.SphereGeometry(1, 5, 3), tuftMat, houseCount * TUFTS_PER_HOUSE, true, false)

    const wallTones = [0xcfc4b0, 0xbfb6a6, 0xd8d2c4, 0xa89c8a, 0xc4b8b0, 0xb0a898, 0xd6cbb2]
    const roofTones = [0x3a4453, 0x46424a, 0x54423a, 0x3d4a42, 0x424b58, 0x5a3a30, 0x2e3a4e]
    const fenceTones = [0xb3ac9c, 0xa8a294, 0xbfb8a9]
    const woodFence = 0x6b4a33

    const HOUSES_PER_TIER: Record<ZoneTier, number> = { quiet: 34, mid: 8, urban: 0 }

    // Pool cursors.
    let iWall = 0
    let iGable = 0
    let iHip = 0
    let iRidge = 0
    let iDoor = 0
    let iFence = 0
    let iGatePost = 0
    let iDeck = 0
    let iDeckPost = 0
    let iAwning = 0
    let iPath = 0
    let houseIdx = 0

    for (let s = 0; s < N && houseIdx < houseCount; s++) {
      const station = STATIONS[s]
      const quota = HOUSES_PER_TIER[station.theme.tier]
      if (quota <= 0) continue
      const markerA = this.track.markerFor(s).tFraction
      const markerB = this.track.markerFor((s + 1) % N).tFraction
      const span = ((markerB - markerA + 1) % 1) || 0.02
      const here = Math.min(houseCount - houseIdx, quota)
      for (let k = 0; k < here; k++) {
        // Keep clear of the platform zone at the segment's start.
        const t = markerA + span * (0.18 + 0.72 * ((k + 0.5) / here))
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = k % 2 === 0 ? 1 : -1
        const off = 16.5 + this.rngHouses() * 16
        const pos = p.clone().addScaledVector(normal, side * off)
        if (this.isNearRoad(pos.x, pos.z, 10)) continue
        const w = 5 + this.rngHouses() * 3.5
        const d = 5 + this.rngHouses() * 3.5
        // Most entrances FACE THE TRACK (local +Z toward the rails) — the
        // fences, gates and engawa exist to be seen from the cab — but ~30%
        // turn their backs, because from a real Tokyo train you mostly see
        // rears and laundry lines, not a parade of front doors (Haruto).
        const backTurned = this.rngHouses() < 0.3
        const yaw = Math.atan2(-side * normal.x, -side * normal.z) + (this.rngHouses() - 0.5) * 0.24 + (backTurned ? Math.PI : 0)
        const sinY = Math.sin(yaw)
        const cosY = Math.cos(yaw)
        // On the hill flanks a footprint this size spans real height: probe
        // the terrain under the edges too, and let the DOWNHILL spread grow
        // the volumes underground — a half-buried uphill wall looks like a
        // cut, a floating downhill corner just looks broken (Rubén's call).
        const gCenter = groundHeightAt(p.y, side * off)
        const half = Math.max(w, d) * 0.5 + 1
        const tHalfFrac = half / this.track.getLength()
        const gMin = Math.min(
          gCenter,
          groundHeightAt(p.y, side * off - half),
          groundHeightAt(p.y, side * off + half),
          groundHeightAt(this.track.pointAt(t + tHalfFrac).y, side * off),
          groundHeightAt(this.track.pointAt(t - tHalfFrac).y, side * off),
        )
        const spread = THREE.MathUtils.clamp(gCenter - gMin, 0, 4)
        const GROUND_Y = gCenter - 0.06

        // Local-frame placement helper: rotates (lx,lz) by the house yaw.
        const put = (
          mesh: THREE.InstancedMesh, index: number,
          lx: number, ly: number, lz: number,
          sx: number, sy: number, sz: number,
          ry = 0, rx = 0,
        ) => {
          dummy.position.set(pos.x + lx * cosY + lz * sinY, GROUND_Y + ly, pos.z - lx * sinY + lz * cosY)
          dummy.scale.set(sx, sy, sz)
          dummy.rotation.set(rx, yaw + ry, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(index, dummy.matrix)
        }

        const wallTone = wallTones[Math.floor(this.rngHouses() * wallTones.length)]
        const roofTone = roofTones[Math.floor(this.rngHouses() * roofTones.length)]
        const setRoofTint = (mesh: THREE.InstancedMesh, i: number, mul = 1.7) => {
          mesh.setColorAt(i, tint.setHex(roofTone).multiplyScalar(mul))
        }

        // ——— Archetype mix ———
        const archRoll = this.rngHouses()
        const arch = archRoll < 0.42 ? 'gable' : archRoll < 0.62 ? 'lplan' : archRoll < 0.78 ? 'nikai' : 'engawa'
        const twoStory = arch === 'nikai'
        const h = (3.1 + this.rngHouses() * 1.0) * (twoStory ? 1.72 : 1)
        const mainW = arch === 'nikai' ? w * 0.86 : w
        const mainD = arch === 'nikai' ? d * 0.86 : d

        // Main volume, stretched down by the slope spread so its downhill
        // face reaches the ground. Tones lifted ~20%: the entrance facades
        // face the track (away from the southern sun much of the day) and
        // unlifted they all sat in murk.
        const hEff = h + spread
        put(walls, iWall, 0, h - hEff / 2, 0, mainW, hEff, mainD)
        walls.setColorAt(iWall, tint.setHex(wallTone).multiplyScalar(1.2))
        iWall++

        // Roof + ridge for the main volume.
        const roofScaleY = (twoStory ? h * 0.3 : h * 0.55) * (0.9 + this.rngHouses() * 0.2)
        if (arch === 'gable' || arch === 'lplan') {
          put(gables, iGable, 0, h - 0.12, 0, mainW, roofScaleY, mainD)
          setRoofTint(gables, iGable)
          iGable++
          put(ridgeCaps, iRidge, 0, h - 0.12 + roofScaleY * 0.5, 0, 0.5, 0.22, mainD * 1.27)
          ridgeCaps.setColorAt(iRidge, tint.setHex(roofTone).multiplyScalar(0.85))
          iRidge++
        } else {
          // Yosemune hip; the two-story version stacks a small gable on top
          // of it — the irimoya silhouette.
          put(hips, iHip, 0, h - 0.12, 0, mainW, roofScaleY, mainD)
          setRoofTint(hips, iHip)
          iHip++
          if (twoStory) {
            put(gables, iGable, 0, h - 0.12 + roofScaleY * 0.55, 0, mainW * 0.5, roofScaleY * 0.75, mainD * 0.62)
            setRoofTint(gables, iGable)
            iGable++
            put(ridgeCaps, iRidge, 0, h - 0.12 + roofScaleY * 0.55 + roofScaleY * 0.75 * 0.5, 0, 0.4, 0.18, mainD * 0.62 * 1.27)
            ridgeCaps.setColorAt(iRidge, tint.setHex(roofTone).multiplyScalar(0.85))
            iRidge++
          }
        }

        // L-plan wing: a lower volume to one flank, ridge turned 90°.
        if (arch === 'lplan') {
          const wingSide = this.rngHouses() < 0.5 ? 1 : -1
          const wingW = mainW * 0.55
          const wingH = h * 0.74
          const wingD = mainD * 0.62
          const wingX = wingSide * (mainW / 2 + wingW / 2 - 0.35)
          const wingZ = mainD * 0.12
          const wingHEff = wingH + spread
          put(walls, iWall, wingX, wingH - wingHEff / 2, wingZ, wingW, wingHEff, wingD)
          walls.setColorAt(iWall, tint.setHex(wallTone).multiplyScalar(1.14))
          iWall++
          put(gables, iGable, wingX, wingH - 0.1, wingZ, wingD, wingH * 0.5, wingW, Math.PI / 2)
          setRoofTint(gables, iGable)
          iGable++
        }

        // Engawa porch: raised wooden deck along the front, posts, and a
        // lean-to awning hanging off the wall above it.
        if (arch === 'engawa' || (arch === 'nikai' && this.rngHouses() < 0.5)) {
          const deckW = mainW * 0.86
          const deckZ = mainD / 2 + 0.62
          put(decks, iDeck, 0, 0.42, deckZ, deckW, 1, 1)
          iDeck++
          for (let dp = 0; dp < 3; dp++) {
            put(deckPosts, iDeckPost, (dp - 1) * deckW * 0.44, 0.9 - spread / 2, deckZ + 0.42, 1, 1.8 + spread, 1)
            iDeckPost++
          }
          put(awnings, iAwning, 0, Math.min(h - 0.5, 2.5), deckZ - 0.1, deckW + 0.5, 1, 1.6, 0, 0.34)
          awnings.setColorAt(iAwning, tint.setHex(roofTone).multiplyScalar(1.1))
          iAwning++
        }

        // Front door, centered on the entrance face.
        put(doors, iDoor, 0, 0.95, mainD / 2 + 0.03, 1, 1, 1)
        iDoor++

        // Gate→door path, only where the yard sits on near-flat ground (a
        // rigid quad across a slope would hover or knife in).
        if (spread < 0.4) {
          const pathLen = 2.2 // wall face → gate line (1.9) plus a lip under the door
          put(paths, iPath, 0, 0.05, mainD / 2 + pathLen / 2 - 0.3, 1.15, 1, pathLen)
          iPath++
        }

        // ——— The yard: block wall + gate, the detail Rubén asked for by
        // name. Front fence flanks a gate gap in front of the door; short
        // returns run down both sides.
        const fx = mainW / 2 + 1.7
        const fz = mainD / 2 + 1.9
        const gateHalf = 0.85
        const frontLen = fx - gateHalf
        const fenceTone = this.rngHouses() < 0.25 ? woodFence : fenceTones[Math.floor(this.rngHouses() * fenceTones.length)]
        const fenceH = 0.75 + this.rngHouses() * 0.25
        const fenceHEff = fenceH + spread // walls of the yard follow the house underground
        // Front-left / front-right of the gate.
        put(fences, iFence, -(gateHalf + frontLen / 2), fenceH - fenceHEff / 2, fz, frontLen, fenceHEff, 0.14)
        fences.setColorAt(iFence, tint.setHex(fenceTone))
        iFence++
        put(fences, iFence, gateHalf + frontLen / 2, fenceH - fenceHEff / 2, fz, frontLen, fenceHEff, 0.14)
        fences.setColorAt(iFence, tint.setHex(fenceTone))
        iFence++
        // Side returns.
        for (const sideX of [-fx, fx]) {
          put(fences, iFence, sideX, fenceH - fenceHEff / 2, fz - fz * 0.55, 0.14, fenceHEff, fz * 1.1)
          fences.setColorAt(iFence, tint.setHex(fenceTone).multiplyScalar(0.94))
          iFence++
        }
        // Gate posts + the little kirizuma roof over the gate.
        for (const gp of [-gateHalf, gateHalf]) {
          put(gatePosts, iGatePost, gp, 0.58 - spread / 2, fz, 1, 1 + spread / 1.15, 1)
          gatePosts.setColorAt(iGatePost, tint.setHex(fenceTone).multiplyScalar(0.85))
          iGatePost++
        }
        put(gables, iGable, 0, 1.2, fz, 2.3, 0.5, 0.8)
        setRoofTint(gables, iGable, 1.5)
        iGable++

        // Scruffy grass ring at the foundation.
        for (let g = 0; g < TUFTS_PER_HOUSE; g++) {
          const ti2 = houseIdx * TUFTS_PER_HOUSE + g
          const ang = this.rngHouses() * Math.PI * 2
          put(
            tufts, ti2,
            (mainW / 2 + 0.35) * Math.cos(ang), 0.12, (mainD / 2 + 0.35) * Math.sin(ang),
            0.3 + this.rngHouses() * 0.35, 0.14 + this.rngHouses() * 0.16, 0.3 + this.rngHouses() * 0.35,
            this.rngHouses() * Math.PI,
          )
          tint.setHSL(0.25 + this.rngHouses() * 0.09, 0.32 + this.rngHouses() * 0.15, 0.2 + this.rngHouses() * 0.12)
          tufts.setColorAt(ti2, tint)
        }
        houseIdx++
      }
    }

    walls.count = iWall
    gables.count = iGable
    hips.count = iHip
    ridgeCaps.count = iRidge
    doors.count = iDoor
    fences.count = iFence
    gatePosts.count = iGatePost
    decks.count = iDeck
    deckPosts.count = iDeckPost
    awnings.count = iAwning
    paths.count = iPath
    tufts.count = houseIdx * TUFTS_PER_HOUSE
    // Named one by one rather than as a bare list: these twelve are the pools
    // the ring sectorisation will split, and the name is the contract that
    // keeps the semantic hash steady across the split.
    const pools: [THREE.InstancedMesh, string][] = [
      [walls, 'house-walls'],
      [gables, 'house-gables'],
      [hips, 'house-hips'],
      [ridgeCaps, 'house-ridge-caps'],
      [doors, 'house-doors'],
      [fences, 'house-fences'],
      [gatePosts, 'house-gate-posts'],
      [decks, 'house-decks'],
      [deckPosts, 'house-deck-posts'],
      [awnings, 'house-awnings'],
      [paths, 'house-paths'],
      [tufts, 'house-tufts'],
    ]
    for (const [mesh, group] of pools) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.scene.add(tagGroup(mesh, group))
    }
    // Winter snow-caps every roof surface; the foundation tufts dry with the fields.
    this.seasonalPools.push(registerPool('roof', gables.instanceColor!))
    this.seasonalPools.push(registerPool('roof', hips.instanceColor!))
    this.seasonalPools.push(registerPool('roof', ridgeCaps.instanceColor!))
    this.seasonalPools.push(registerPool('roof', awnings.instanceColor!))
    this.seasonalPools.push(registerPool('scrub', tufts.instanceColor!))
  }

  /**
   * Utility poles with crossarms and gently sagging wires on the inner side
   * of the loop — the signature clutter of every Tokyo street. Wires are one
   * LineSegments batch; poles/arms are instanced.
   */
  private buildUtilityPoles() {
    const spacing = 58
    const trackLen = this.track.getLength()
    const count = Math.floor(trackLen / spacing)
    const offset = -9 // inner side, opposite the catenary poles at +5.6
    const poleH = 8.4

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5c554c, roughness: 0.9 })
    // Long enough that the feet sink just below the ground plane (-0.58).
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, poleH + 0.58, 6), poleMat, count)
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.09, 0.09), poleMat, count * 2)
    poles.castShadow = true

    const dummy = new THREE.Object3D()
    const tops: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      const t = i / count
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      // Where the track dives into the trench the pole line jogs OUTWARD
      // around the cutting (the ground plane has a hole there now — a pole
      // planted at -9 would float over the open cut) and stays up at street
      // level: the wires visibly skirting the trench is exactly what a
      // Tokyo rail cutting looks like from above.
      const inCut = this.track.trenchDepthAt(t) > 0.25
      const base = p.clone().addScaledVector(normal, inCut ? -32 : offset)
      base.y = Math.max(base.y, -0.02)
      dummy.position.set(base.x, base.y + (poleH - 0.58) / 2, base.z)
      dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0)
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)

      for (let a = 0; a < 2; a++) {
        dummy.position.set(base.x, base.y + poleH - 0.5 - a * 0.7, base.z)
        dummy.updateMatrix()
        arms.setMatrixAt(i * 2 + a, dummy.matrix)
      }
      tops.push(new THREE.Vector3(base.x, base.y + poleH - 0.55, base.z))
    }
    poles.instanceMatrix.needsUpdate = true
    arms.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(poles, 'utility-poles'), tagGroup(arms, 'utility-arms'))

    // Sagging wires: 4 spans-per-pair polyline points, two parallel wires.
    const wirePts: number[] = []
    const SEGS = 5
    for (let i = 0; i < count; i++) {
      const a = tops[i]
      const b = tops[(i + 1) % count]
      for (let wire = 0; wire < 2; wire++) {
        const dy = -0.05 - wire * 0.65
        for (let sgm = 0; sgm < SEGS; sgm++) {
          const f0 = sgm / SEGS
          const f1 = (sgm + 1) / SEGS
          const sag0 = Math.sin(f0 * Math.PI) * 0.9
          const sag1 = Math.sin(f1 * Math.PI) * 0.9
          wirePts.push(
            THREE.MathUtils.lerp(a.x, b.x, f0), THREE.MathUtils.lerp(a.y, b.y, f0) - sag0 + dy, THREE.MathUtils.lerp(a.z, b.z, f0),
            THREE.MathUtils.lerp(a.x, b.x, f1), THREE.MathUtils.lerp(a.y, b.y, f1) - sag1 + dy, THREE.MathUtils.lerp(a.z, b.z, f1),
          )
        }
      }
    }
    const wireGeo = new THREE.BufferGeometry()
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3))
    const wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x14161a }))
    this.scene.add(tagGroup(wires, 'utility-wires'))
  }

  /**
   * Vertical neon signs clustered around downtown/youth/business stations —
   * pylon-mounted billboard columns that blaze at night. One InstancedMesh
   * per sign design (6 designs) keeps draw calls flat.
   */
  private buildNeonSigns() {
    // Each sign is a front/back pair of instances (rotated π) rather than a
    // DoubleSide plane, so the kanji never renders mirrored from behind.
    const perDesign = 60
    const dummy = new THREE.Object3D()
    const meshes: THREE.InstancedMesh[] = []
    const counters: number[] = []
    for (const design of NEON_SIGNS) {
      const tex = makeNeonSignTexture(design.text, design.bg, design.fg)
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.08,
        roughness: 0.6,
      })
      this.neonMats.push(mat)
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 5.8), mat, perDesign)
      meshes.push(mesh)
      counters.push(0)
    }

    // Neon density is the loudest zone-contrast signal: none in quiet
    // stretches, a shopfront or two in mid ones, a wall of them downtown.
    const NEON_PER_TIER: Record<ZoneTier, number> = { quiet: 0, mid: 2, urban: 10 }
    for (let s = 0; s < N; s++) {
      const station = STATIONS[s]
      const base = NEON_PER_TIER[station.theme.tier]
      if (base <= 0) continue
      const marker = this.track.markerFor(s)
      const signsHere = station.landmark ? Math.round(base * 1.4) : base
      for (let k = 0; k < signsHere; k++) {
        const design = Math.floor(this.rngSignage() * NEON_SIGNS.length)
        if (counters[design] + 2 > perDesign) continue
        const t = marker.tFraction + (this.rngSignage() - 0.3) * 0.014
        // A sign floating over the trench hole would hang in mid-air.
        if (this.track.trenchDepthAt(t) > 0.25) continue
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = this.rngSignage() < 0.5 ? 1 : -1
        const off = 13 + this.rngSignage() * 24
        const pos = p.clone().addScaledVector(normal, side * off)
        const yaw = Math.atan2(normal.x, normal.z) + (side < 0 ? Math.PI : 0) + (this.rngSignage() - 0.5) * 0.5
        const scale = 0.85 + this.rngSignage() * 0.6
        const y = 4.5 + this.rngSignage() * 5
        // Face roughly across the track so the driver reads them straight on.
        for (const flip of [0, Math.PI]) {
          dummy.position.set(pos.x, y, pos.z)
          dummy.rotation.set(0, yaw + flip, 0)
          dummy.scale.setScalar(scale)
          dummy.updateMatrix()
          meshes[design].setMatrixAt(counters[design]++, dummy.matrix)
        }
      }
    }
    meshes.forEach((mesh, i) => {
      mesh.count = counters[i]
      mesh.instanceMatrix.needsUpdate = true
      // One group per DESIGN, not one for all the neon: the designs share a
      // geometry and differ only by texture, so a single name would let an
      // instance move between designs without the hash noticing.
      this.scene.add(tagGroup(mesh, `neon-signs-${i}`))
    })
  }

  /** t of THE level crossing (0.55 into the Tabata→Komagome stretch) — shared by the crossing itself and the hill walls' gap. */
  private crossingTFraction(): number {
    const idx = STATIONS.findIndex((s) => s.id === 'uji')
    const markerA = this.track.markerFor(idx).tFraction
    const markerB = this.track.markerFor((idx + 1) % N).tFraction
    return markerA + (((markerB - markerA + 1) % 1) || 0.02) * 0.55
  }

  private isNearRoad(x: number, z: number, radius: number): boolean {
    const r2 = radius * radius
    for (const s of this.roadSamples) {
      const dx = s.x - x
      const dz = s.z - z
      if (dx * dx + dz * dz < r2) return true
    }
    return false
  }

  /**
   * A country road on the approach to the hill: it rides beside the tracks for
   * a while (driver's left), then bends away toward a small mountain range off
   * to the west and is gone — a one-glance story of "somewhere else" that the
   * quiet zone needed. The mountains anchor the road's vanishing point.
   */
  private buildMountainRoad() {
    // Centerline comes from Track so City's background buildings (built from
    // the same path) can never randomize themselves onto the asphalt.
    const samples = mountainRoadPath(this.track)
    const SAMPLES = samples.length - 1
    const pts: THREE.Vector3[] = []
    for (const s of samples) {
      // A clear 10cm over the terrain: a few centimetres proud lost the
      // z-buffer duel against the ground plane at distance and vanished.
      // terrainRelief keeps the far end of the road glued to the rolling
      // plain (zero anywhere near the tracks by construction).
      pts.push(new THREE.Vector3(s.x, groundHeightAt(s.trackY, s.off) + terrainRelief(s.x, s.z, s.off) + 0.1, s.z))
      this.roadSamples.push({ x: s.x, z: s.z })
    }

    // ——— Asphalt ribbon with a dashed centerline, one dash cycle per texture tile.
    const asphaltTex = (() => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 128
      const ctx = canvas.getContext('2d')!
      // Lighter than the trackside earth on purpose: same-value asphalt
      // disappeared into the ground entirely from the cab.
      ctx.fillStyle = '#5b5e63'
      ctx.fillRect(0, 0, 64, 128)
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = this.rngTerrain() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'
        ctx.fillRect(this.rngTerrain() * 64, this.rngTerrain() * 128, 1.5, 1.5)
      }
      // Japanese country road markings: solid white edge lines, dashed center.
      ctx.fillStyle = '#e8e6da'
      ctx.fillRect(3, 0, 3, 128)
      ctx.fillRect(58, 0, 3, 128)
      ctx.fillRect(30, 8, 4, 52) // dash; rest of the cycle is gap
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      return tex
    })()
    const HALF_W = 2.8
    const roadPositions: number[] = []
    const roadUvs: number[] = []
    const roadIndices: number[] = []
    let dist = 0
    for (let i = 0; i <= SAMPLES; i++) {
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(SAMPLES, i + 1)]
      const dir = new THREE.Vector3().subVectors(next, prev)
      dir.y = 0
      dir.normalize()
      const side = new THREE.Vector3(-dir.z, 0, dir.x)
      if (i > 0) dist += pts[i].distanceTo(pts[i - 1])
      const c = pts[i]
      // Taper the first few metres from nothing: a full-width square cut edge
      // simply popped into existence beside the tracks.
      const hw = HALF_W * Math.min(1, i / 10)
      roadPositions.push(
        c.x + side.x * hw, c.y, c.z + side.z * hw,
        c.x - side.x * hw, c.y, c.z - side.z * hw,
      )
      const v = dist / 11 // one dash cycle every ~11 units
      roadUvs.push(0, v, 1, v)
      if (i < SAMPLES) {
        // Vertex 0 of each pair is the RIGHT edge (opposite of the embankment
        // ribbon), so the winding flips too — the other order faced the road
        // at the dirt and backface culling erased it from above.
        const a = i * 2, b = i * 2 + 1, c2 = (i + 1) * 2, d = (i + 1) * 2 + 1
        roadIndices.push(a, c2, b, b, c2, d)
      }
    }
    const roadGeo = new THREE.BufferGeometry()
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3))
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2))
    roadGeo.setIndex(roadIndices)
    roadGeo.computeVertexNormals()
    const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
      map: asphaltTex,
      roughness: 1,
      // Depth-bias toward the camera so the ribbon never loses to the ground
      // plane at far z-buffer distances.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }))
    road.receiveShadow = true
    this.scene.add(tagGroup(road, 'mountain-road'))

    // ——— The little mountain range the road runs off to: a handful of low-poly
    // cones past the plain, hazed by distance fog like the rest of the world.
    const end = pts[SAMPLES]
    const endDir = new THREE.Vector3().subVectors(pts[SAMPLES], pts[SAMPLES - 4])
    endDir.y = 0
    endDir.normalize()
    const perp = new THREE.Vector3(-endDir.z, 0, endDir.x)
    const mountainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })
    const mountains = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 9), mountainMat, 4)
    mountains.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4 * 3), 3)
    // Past the skyline ring on purpose: closer in, its towers sliced straight
    // through the peaks. Back here the ring reads as a city skyline WITH
    // mountains behind it, and the extra distance earns the size bump.
    const specs = [
      { fwd: 950, side: 60, r: 520, h: 330 },
      { fwd: 830, side: -420, r: 380, h: 235 },
      { fwd: 890, side: 400, r: 430, h: 265 },
      { fwd: 1150, side: -140, r: 470, h: 205 },
    ]
    const mDummy = new THREE.Object3D()
    const mTint = new THREE.Color()
    specs.forEach((m, i) => {
      const base = end.clone().addScaledVector(endDir, m.fwd).addScaledVector(perp, m.side)
      mDummy.position.set(base.x, m.h * 0.5 - 15, base.z)
      mDummy.scale.set(m.r, m.h, m.r)
      mDummy.rotation.set(0, this.rngTerrain() * Math.PI, 0)
      mDummy.updateMatrix()
      mountains.setMatrixAt(i, mDummy.matrix)
      // Dark cool forest-green — distant wooded ranges, not pastel paper.
      mTint.setHSL(0.39 + this.rngTerrain() * 0.03, 0.22, 0.16 + i * 0.02)
      mountains.setColorAt(i, mTint)
    })
    mountains.instanceMatrix.needsUpdate = true
    if (mountains.instanceColor) mountains.instanceColor.needsUpdate = true
    this.scene.add(tagGroup(mountains, 'road-mountains'))
    this.seasonalPools.push(registerPool('mountain', mountains.instanceColor!))
  }

  /**
   * Dressing for the Komagome climb: ishigaki-style stone retaining walls
   * hugging the track where the embankment is tall, and a loose garden wood
   * (pines, broadleaf greens, a few maples) on the flanks — the hill should
   * read as the gardens the station blurb promises, not a bare mound.
   */
  private buildHillDressing() {
    const hillIdx = STATIONS.findIndex((s) => s.id === HILL_STATION_ID)
    const center = this.track.markerFor(Math.max(0, hillIdx)).tFraction
    const len = this.track.getLength()
    const crossT = this.crossingTFraction()

    // ——— Stone texture shared by every wall segment.
    const stoneTex = (() => {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 64
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#4a453d'
      ctx.fillRect(0, 0, 128, 64)
      const rows = 4
      for (let r = 0; r < rows; r++) {
        const y = (r * 64) / rows
        const shift = (r % 2) * 14
        for (let x = -1; x < 6; x++) {
          const w = 20 + ((x * 7 + r * 13) % 9)
          const px = x * 24 + shift
          const g = 118 + ((x * 31 + r * 17) % 28)
          ctx.fillStyle = `rgb(${g},${g - 6},${g - 16})`
          ctx.fillRect(px + 1, y + 1, w, 64 / rows - 2)
          if ((x + r) % 5 === 0) {
            ctx.fillStyle = 'rgba(95,107,70,0.35)' // moss
            ctx.fillRect(px + 3, y + 64 / rows - 5, w * 0.5, 3)
          }
        }
      }
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.repeat.set(3, 1)
      return tex
    })()

    const wallMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 })
    const SEG = 7.2
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 1.5, SEG + 0.35), wallMat, 360)
    walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(360 * 3), 3)
    walls.castShadow = true
    walls.receiveShadow = true
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()
    let wi = 0
    const dtStep = SEG / len
    for (let t = center - 0.053; t <= center + 0.053; t += dtStep) {
      const p = this.track.pointAt(t)
      if (p.y < 3.2) continue // walls only where the embankment is tall enough to retain
      const arcToCross = Math.abs(t - crossT) * len
      const arcToStation = Math.abs(t - center) * len
      if (arcToCross < 15) continue // leave the level crossing's road open
      if (arcToStation < 46) continue // the platform zone has its own furniture
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      for (const side of [1, -1]) {
        if (wi >= 360) break
        // 8.35, not deeper out: at 8.6 the wall's outer face passed 3-9cm
        // through the utility-pole line at lateral 9.
        const pos = p.clone().addScaledVector(normal, side * 8.35)
        pos.y = p.y - 0.48 + 0.66 // base on the crown, slightly sunk
        dummy.position.copy(pos)
        dummy.lookAt(pos.x + tangent.x, pos.y + tangent.y, pos.z + tangent.z)
        // Ishigaki batter tips the top TOWARD the fill it retains (trackward).
        // After lookAt, local X points at -normal, so the trackward tilt needs
        // the negative sign — the positive one leaned every wall outward, into
        // the pole line.
        dummy.rotateZ(-side * 0.08)
        dummy.updateMatrix()
        walls.setMatrixAt(wi, dummy.matrix)
        const shade = 0.88 + this.rngVeg() * 0.18
        walls.setColorAt(wi, tint.setRGB(shade, shade, shade))
        wi++
      }
    }
    walls.count = wi
    walls.instanceMatrix.needsUpdate = true
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true
    this.scene.add(tagGroup(walls, 'hill-walls'))

    // ——— Garden wood on the flanks: trunks + layered canopies, some pines,
    // a few maples for warmth. Everything stands on the shared terrain profile.
    const TREES = 150
    /** Hand-placed maples framing the station approach — the momiji witnesses that share the autumn frame with the evergreen sakura. */
    const APPROACH_MAPLES: [number, number, number][] = [
      [-30, -17, 1.5], [-44, -22, 1.7], [-58, -18, 1.6], [-74, -24, 1.45], [-36, 17, 1.4],
    ]
    const CAP = TREES + APPROACH_MAPLES.length
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.95 })
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.24, 0.36, 2.4, 6), trunkMat, CAP)
    // Sphere canopies demoted to invisible shadow proxies (same deal as the
    // cherries): the visible crowns are billboard cards with the broadleaf's
    // own atlas rows — Rubén's "cada árbol con su peculiaridad".
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, colorWrite: false, depthWrite: false })
    const canopies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 6), canopyMat, CAP * 2)
    const hillPineMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.95 })
    const hillPines = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.6, 7), hillPineMat, Math.ceil(TREES * 0.4))
    hillPines.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.ceil(TREES * 0.4) * 3), 3)
    trunks.castShadow = canopies.castShadow = hillPines.castShadow = true
    const broadleafCardStart = this.sakuraCloud.cardCount
    let ti = 0
    let ci = 0
    let pi = 0
    for (let k = 0; k < TREES; k++) {
      let placed: { pos: THREE.Vector3; groundY: number } | null = null
      for (let attempt = 0; attempt < 6 && !placed; attempt++) {
        const t = center + (this.rngVeg() * 2 - 1) * 0.052
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = this.rngVeg() < 0.5 ? 1 : -1
        const off = 12 + this.rngVeg() * 50
        const arcToStation = Math.abs(t - center) * len
        const arcToCross = Math.abs(t - crossT) * len
        if (arcToStation < 44 && off < 18) continue // platform zone
        if (arcToCross < 13 && off < 15) continue // crossing road corridor
        const pos = p.clone().addScaledVector(normal, side * off)
        if (this.isNearRoad(pos.x, pos.z, 7)) continue
        placed = { pos, groundY: groundHeightAt(p.y, side * off) }
      }
      if (!placed) continue
      const { pos, groundY } = placed
      const scale = 0.75 + this.rngVeg() * 0.8
      const kind = this.rngVeg()
      if (kind < 0.3 && pi < hillPines.count) {
        // Pine: reuse the trackside pine silhouette, denser green.
        dummy.position.set(pos.x, groundY + 2.3 * scale - 0.1, pos.z)
        dummy.scale.setScalar(scale)
        dummy.rotation.set(0, this.rngVeg() * Math.PI, 0)
        dummy.updateMatrix()
        hillPines.setMatrixAt(pi, dummy.matrix)
        tint.setHSL(0.33 + this.rngVeg() * 0.04, 0.35, 0.18 + this.rngVeg() * 0.09)
        hillPines.setColorAt(pi, tint)
        pi++
        continue
      }
      dummy.position.set(pos.x, groundY + 1.2 * scale - 0.1, pos.z)
      dummy.scale.setScalar(scale)
      dummy.rotation.set(0, this.rngVeg() * Math.PI, 0)
      dummy.updateMatrix()
      trunks.setMatrixAt(ti++, dummy.matrix)
      for (let b = 0; b < 2; b++) {
        const br = (1.7 + this.rngVeg() * 1.1) * scale
        dummy.position.set(
          pos.x + (this.rngVeg() - 0.5) * 1.6 * scale,
          groundY + (2.6 + b * 1.1 + this.rngVeg() * 0.5) * scale,
          pos.z + (this.rngVeg() - 0.5) * 1.6 * scale,
        )
        dummy.scale.set(br, br * 0.78, br)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        canopies.setMatrixAt(ci, dummy.matrix)
        ci++
      }
      // All summer-green as built: the SEASON turns the hillside — these
      // are the maples/broadleafs that go full momiji in autumn. Lightness
      // ×1.2 over the sphere era: the cards are unlit, and the sun used
      // to do that part of the brightening (×1.35 read minty).
      tint.setHSL(0.27 + this.rngVeg() * 0.09, 0.42, (0.26 + this.rngVeg() * 0.1) * 1.2)
      this.sakuraCloud.addTree(pos.x, groundY, pos.z, scale, 'broadleaf', false, tint)
    }
    // The momiji witnesses: guaranteed broadleafs framing the last ~80 units
    // into the hill station, so the autumn arrival shows blazing maples and
    // the platform's blooming sakura in one glance (the panel's ask).
    for (const [along, lat, scale] of APPROACH_MAPLES) {
      const t = center + along / len
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const pos = p.clone().addScaledVector(normal, lat)
      const groundY = groundHeightAt(p.y, lat)
      dummy.position.set(pos.x, groundY + 1.2 * scale - 0.1, pos.z)
      dummy.scale.setScalar(scale)
      dummy.rotation.set(0, this.rngVeg() * Math.PI, 0)
      dummy.updateMatrix()
      trunks.setMatrixAt(ti++, dummy.matrix)
      for (let b = 0; b < 2; b++) {
        const br = (1.9 + this.rngVeg() * 1.0) * scale
        dummy.position.set(
          pos.x + (this.rngVeg() - 0.5) * 1.6 * scale,
          groundY + (2.6 + b * 1.1 + this.rngVeg() * 0.5) * scale,
          pos.z + (this.rngVeg() - 0.5) * 1.6 * scale,
        )
        dummy.scale.set(br, br * 0.78, br)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        canopies.setMatrixAt(ci, dummy.matrix)
        ci++
      }
      tint.setHSL(0.26 + this.rngVeg() * 0.06, 0.45, (0.3 + this.rngVeg() * 0.08) * 1.2)
      this.sakuraCloud.addTree(pos.x, groundY, pos.z, scale, 'broadleaf', false, tint)
    }
    trunks.count = ti
    canopies.count = ci
    hillPines.count = pi
    trunks.instanceMatrix.needsUpdate = true
    canopies.instanceMatrix.needsUpdate = true
    hillPines.instanceMatrix.needsUpdate = true
    if (hillPines.instanceColor) hillPines.instanceColor.needsUpdate = true
        tagGroup(trunks, 'hill-trunks')
    tagGroup(canopies, 'hill-shadow')
    tagGroup(hillPines, 'hill-pines')
    this.scene.add(trunks, canopies, hillPines)
    this.canopyCardPools.push({ kind: 'broadleaf', start: broadleafCardStart, count: this.sakuraCloud.cardCount - broadleafCardStart })
    this.seasonalPools.push(registerPool('pine', hillPines.instanceColor!))
  }

  /**
   * Trackside distance boards on the approach to every station — 500m, 250m
   * and 100m on the driver's left, Japanese yellow-board style. They give the
   * braking point a visual language: the PA already calls the arrival at
   * ~260 units, but nothing on the TRACK warned the eye before the platform
   * ambushed you around a curve.
   */
  private buildApproachBoards() {
    const len = this.track.getLength()
    const crossT = this.crossingTFraction()
    const DISTANCES = [500, 250, 100]

    const makeBoardTexture = (label: string) => {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 96
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, 128, 96)
      ctx.fillStyle = '#f2c937'
      ctx.fillRect(5, 5, 118, 86)
      ctx.fillStyle = '#141414'
      ctx.textAlign = 'center'
      ctx.font = '800 44px system-ui, sans-serif'
      ctx.fillText(label, 64, 52)
      ctx.font = '700 24px system-ui, sans-serif'
      ctx.fillText('m', 64, 80)
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    }

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b4f55, roughness: 0.7, metalness: 0.3 })
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 2.6, 6), poleMat, N * DISTANCES.length)
    const boardMeshes = DISTANCES.map((d) => {
      const tex = makeBoardTexture(String(d))
      // A whisper of emissive so the board stays readable at dusk without
      // needing its own light.
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.06, roughness: 0.75 })
      return new THREE.InstancedMesh(new THREE.PlaneGeometry(1.7, 1.25), mat, N)
    })
    const dummy = new THREE.Object3D()
    let pi = 0
    const boardCounts = DISTANCES.map(() => 0)

    for (let s = 0; s < N; s++) {
      const marker = this.track.markerFor(s).tFraction
      const prev = this.track.markerFor((s - 1 + N) % N).tFraction
      const gapUnits = (((marker - prev) % 1) + 1) % 1 * len
      for (let di = 0; di < DISTANCES.length; di++) {
        const d = DISTANCES[di]
        // Short stretches drop the boards that wouldn't fit: a "500m" sign
        // popping up before the PREVIOUS platform would read as nonsense.
        if (d > gapUnits - 70) continue
        let t = marker - d / len
        // Keep clear of the level-crossing corridor (nudge the board earlier).
        if (Math.abs(((t - crossT) % 1 + 1.5) % 1 - 0.5) * len < 14) t -= 18 / len
        // A board inside the tunnel would stand on the street ABOVE the
        // tracks (groundHeightAt clamps to the plain) — drop it instead,
        // same rule as boards that don't fit a short stretch.
        if (this.track.trenchDepthAt(t) > 0.5) continue
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const pos = p.clone().addScaledVector(normal, -7.5) // driver's left
        const groundY = groundHeightAt(p.y, -7.5)

        // Pole tucked BEHIND the board plane (a step along the travel
        // direction): centered on it, the cylinder's belly poked through
        // the sign face right where the approaching cab reads it.
        dummy.position.set(pos.x + tangent.x * 0.18, groundY + 1.2, pos.z + tangent.z * 0.18)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        poles.setMatrixAt(pi++, dummy.matrix)

        dummy.position.set(pos.x, groundY + 2.15, pos.z)
        // Face the oncoming cab: plane +Z looks back down the travel direction.
        dummy.rotation.set(0, Math.atan2(-tangent.x, -tangent.z), 0)
        dummy.updateMatrix()
        boardMeshes[di].setMatrixAt(boardCounts[di]++, dummy.matrix)
      }
    }
    poles.count = pi
    poles.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(poles, 'approach-poles'))
    boardMeshes.forEach((mesh, di) => {
      mesh.count = boardCounts[di]
      mesh.instanceMatrix.needsUpdate = true
      // By distance, not by index: the three boards share a geometry and the
      // name should survive someone reordering DISTANCES.
      this.scene.add(tagGroup(mesh, `approach-boards-${DISTANCES[di]}m`))
    })
  }

  /**
   * THE level crossing — the ring keeps exactly one, on the country stretch
   * between Uji's tea fields and the Kiyomizu climb (an homage to circular
   * lines that keep a single surviving fumikiri). Yellow/black striped
   * poles, the Japanese yellow crossbuck, and twin red lamps that
   * alternate-blink (with a kan-kan bell fed by the Game) only while the
   * train approaches.
   */
  private buildCrossings() {
    const stripeTex = (() => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 8
      const ctx = canvas.getContext('2d')!
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#e8c020' : '#1a1a1a'
        ctx.fillRect(i * 8, 0, 8, 8)
      }
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    })()
    const poleMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7 })
    // Japanese crossbuck: yellow blades with black tips (not the cream US style).
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe8c020, roughness: 0.7 })
    const bladeTipMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })
    // One pair of lamp materials shared by both sides — all lamps blink in sync anyway.
    const lights: CrossingLights = {
      a: new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2222, emissiveIntensity: 0 }),
      b: new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2222, emissiveIntensity: 0 }),
    }
    this.crossingLights.push(lights)

    const t = this.crossingTFraction()
    this.crossingT = t
    const p = this.track.pointAt(t)
    const tangent = this.track.tangentAt(t)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()

    for (const side of [1, -1]) {
      const base = p.clone().addScaledVector(normal, side * 6.5)
      const g = new THREE.Group()
      g.position.copy(base)
      g.position.y -= 0.42 // feet on the worn trackside band, not floating at rail height
      g.rotation.y = Math.atan2(normal.x, normal.z) + (side < 0 ? Math.PI : 0)

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 6), poleMat)
      pole.position.y = 1.7
      g.add(pole)
      // Crossbuck X — yellow blades, black tips
      for (const rot of [0.7, -0.7]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.04), bladeMat)
        blade.position.y = 3.1
        blade.rotation.z = rot
        g.add(blade)
        for (const end of [-0.62, 0.62]) {
          const tip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.17, 0.045), bladeTipMat)
          tip.position.set(end * Math.cos(rot), 3.1 + end * Math.sin(rot), 0)
          tip.rotation.z = rot
          g.add(tip)
        }
      }
      // Twin alternating lamps
      const lampBar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.1), bladeTipMat)
      lampBar.position.y = 2.55
      g.add(lampBar)
      const lampL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), lights.a)
      lampL.position.set(-0.45, 2.55, 0.08)
      g.add(lampL)
      const lampR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), lights.b)
      lampR.position.set(0.45, 2.55, 0.08)
      g.add(lampR)
      this.scene.add(tagGroup(g, 'level-crossings'))
    }
  }

  /**
   * The Dōtonbori tunnel (H4): where the trench (Track's negative hill) dips
   * below grade, a concrete lining box takes over — walls, ceiling, sodium
   * lights — emerging above ground at both ends as portal hoods, the way a
   * real urban rail portal does. The approaches get low retaining walls so
   * the dive reads as a cutting, not a glitch. Everything here is static:
   * three ribbon meshes, one instanced light row, a handful of portal boxes.
   */
  private buildTunnel() {
    const center = this.track.trenchCenterFraction
    const portalOff = trenchPortalOffset()
    const len = this.track.getLength()
    const t0 = center - portalOff
    const t1 = center + portalOff
    const spanUnits = (t1 - t0) * len
    const RINGS = Math.max(24, Math.ceil(spanUnits / 6))

    // Concrete: matte panels with seams and water-stain grime, a whisper of
    // self-illumination so the interior never collapses to pure black
    // between the sodium lamps.
    const concreteTex = (() => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 128
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#7e8287'
      ctx.fillRect(0, 0, 256, 128)
      // Panel seams every 64px, a thin dark joint with a lit top edge.
      for (let x = 0; x < 256; x += 64) {
        ctx.fillStyle = 'rgba(20,22,25,0.55)'
        ctx.fillRect(x, 0, 3, 128)
        ctx.fillStyle = 'rgba(255,255,255,0.10)'
        ctx.fillRect(x + 3, 0, 2, 128)
      }
      ctx.fillStyle = 'rgba(20,22,25,0.4)'
      ctx.fillRect(0, 60, 256, 2)
      // Sodium wash: a warm gradient along the lamp edge of the panel (v=1
      // maps to the ceiling side), so the 'sodium' promise shows on the
      // walls themselves without a single real light.
      const sodium = ctx.createLinearGradient(0, 128, 0, 46)
      sodium.addColorStop(0, 'rgba(255,166,80,0.30)')
      sodium.addColorStop(1, 'rgba(255,166,80,0)')
      ctx.fillStyle = sodium
      ctx.fillRect(0, 0, 256, 128)
      // Water stains bleeding down from the joints.
      for (let i = 0; i < 34; i++) {
        const x = this.rngTunnel() * 256
        const w = 3 + this.rngTunnel() * 10
        const h = 24 + this.rngTunnel() * 80
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, 'rgba(38,40,36,0.34)')
        grad.addColorStop(1, 'rgba(38,40,36,0)')
        ctx.save()
        ctx.translate(x, 0)
        ctx.fillStyle = grad
        ctx.fillRect(-w / 2, 0, w, h)
        ctx.restore()
      }
      // Speckle.
      for (let i = 0; i < 500; i++) {
        const shade = this.rngTunnel() < 0.5 ? 0 : 255
        ctx.fillStyle = `rgba(${shade},${shade},${shade},${(0.03 + this.rngTunnel() * 0.05).toFixed(3)})`
        ctx.fillRect(this.rngTunnel() * 256, this.rngTunnel() * 128, 1.5, 1.5)
      }
      const tex = new THREE.CanvasTexture(canvas)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    })()
    const concrete = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: concreteTex,
      roughness: 0.92,
      emissive: 0x2b2823,
      emissiveIntensity: 0.34,
      side: THREE.DoubleSide,
    })

    const WALL_X = 6.0
    const CLEAR_H = 6.9
    // The corner is WELDED: the ceiling's edge vertices are the exact same
    // numbers as the wall tops, ring by ring. Every other arrangement lost:
    // ceiling and walls at the same height but wider overlapped along the
    // edge (v1, shimmered), and a ceiling stepped below the wall tops still
    // CROSSED the wall plane, which at grazing angles down a 400-unit bore
    // shimmers just the same (v2, Rubén saw it survive). Two strips sharing
    // a bitwise-identical edge are watertight and have nothing to fight.
    const wallL: number[] = []
    const wallR: number[] = []
    const ceil: number[] = []
    const stripUvs: number[] = []
    const p = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    for (let i = 0; i <= RINGS; i++) {
      const t = t0 + ((t1 - t0) * i) / RINGS
      this.track.pointAt(t, p)
      this.track.tangentAt(t, tangent)
      const nx = -tangent.z
      const nz = tangent.x
      const inv = 1 / Math.hypot(nx, nz)
      const floorY = p.y - 0.5
      const topY = p.y + CLEAR_H
      const xL = p.x + nx * inv * WALL_X
      const zL = p.z + nz * inv * WALL_X
      const xR = p.x - nx * inv * WALL_X
      const zR = p.z - nz * inv * WALL_X
      // Left wall: bottom then top.
      wallL.push(xL, floorY, zL, xL, topY, zL)
      wallR.push(xR, floorY, zR, xR, topY, zR)
      ceil.push(xL, topY, zL, xR, topY, zR)
      // One texture tile per ~14 units of bore; v spans the panel height.
      const u = (i * (spanUnits / RINGS)) / 14
      stripUvs.push(u, 0, u, 1)
    }
    const strip = (positions: number[], group: string) => {
      const idx: number[] = []
      for (let i = 0; i < RINGS; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
        idx.push(a, b, c, b, d, c)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(stripUvs, 2))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, concrete)
      // No castShadow: the tunnel's darkness comes from the per-frame light
      // override in Game (cheaper and weather-proof), so paying the shadow
      // pass for 400 units of lining would buy nothing (Marco's budget).
      mesh.receiveShadow = true
      this.scene.add(tagGroup(mesh, group))
      return mesh
    }
    strip(wallL, 'tunnel-wall-left')
    strip(wallR, 'tunnel-wall-right')
    strip(ceil, 'tunnel-ceiling')

    // Sodium lamps along the ceiling: MeshBasicMaterial ignores lighting, so
    // they stay lit inside without costing a single real light source.
    const LAMP_SPACING = 13
    const lampCount = Math.floor(spanUnits / LAMP_SPACING)
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffb060 }) // true sodium orange, not cream (round 1)
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.1, 0.95), lampMat, Math.max(1, lampCount))
    const dummy = new THREE.Object3D()
    for (let i = 0; i < lampCount; i++) {
      const t = t0 + ((i + 0.5) / lampCount) * (t1 - t0)
      this.track.pointAt(t, p)
      this.track.tangentAt(t, tangent)
      const nx = -tangent.z
      const nz = tangent.x
      const inv = 1 / Math.hypot(nx, nz)
      const side = i % 2 === 0 ? 2.4 : -2.4 // staggered rows, like a real bore
      dummy.position.set(p.x + nx * inv * side, p.y + CLEAR_H - 0.12, p.z + nz * inv * side)
      dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0)
      dummy.updateMatrix()
      lamps.setMatrixAt(i, dummy.matrix)
    }
    lamps.count = lampCount
    lamps.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(lamps, 'tunnel-lamps'))

    // Portals: header beam over the opening, flanking pillars, splayed wing
    // walls, and a small 隧道 name plate — the concrete face that makes the
    // hole in the ground read as infrastructure and not as a missing tile.
    // Same material story as the lining: bare hormigón with joints and
    // grime, not smooth plastic (Yui, round 1). Box UVs give each face a
    // full texture tile — reads as shuttering panels.
    const portalMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, map: concreteTex, roughness: 0.85 })
    // Every concrete box of both portals rides ONE InstancedMesh (a unit
    // cube scaled per instance): 10 boxes, 1 draw call.
    const portalBoxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), portalMat, 10)
    let pbI = 0
    const portalDummy = new THREE.Object3D()
    const signTex = (() => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 64
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#3a3f45'
      ctx.fillRect(0, 0, 256, 64)
      ctx.fillStyle = '#e8e6da'
      ctx.font = '700 40px "Hiragino Sans", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('道頓堀隧道', 128, 46)
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    })()
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.12, roughness: 0.7 })
    for (const tPortal of [t0, t1]) {
      this.track.pointAt(tPortal, p)
      this.track.tangentAt(tPortal, tangent)
      const g = new THREE.Group()
      g.position.set(p.x, p.y, p.z)
      // Face down the track, opening toward the approaching train.
      const facing = tPortal === t0 ? 1 : -1
      g.rotation.y = Math.atan2(tangent.x * facing, tangent.z * facing)
      g.updateMatrixWorld(true)
      const putBox = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, ry = 0) => {
        portalDummy.position.set(lx, ly, lz).applyMatrix4(g.matrixWorld)
        portalDummy.quaternion.copy(g.quaternion)
        if (ry) portalDummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, ry))
        portalDummy.scale.set(sx, sy, sz)
        portalDummy.updateMatrix()
        portalBoxes.setMatrixAt(pbI++, portalDummy.matrix)
      }
      // Header beam: wide enough to bury the pillar tops, deep enough to
      // seal over the ceiling, and 0.3 DEEPER than the pillars — at the
      // same 1.4 depth their front/back faces were exactly coplanar over
      // the whole overlap rectangle, and that patch shimmered (Rubén's
      // red-circle screenshot, round 3). No box shares a plane with any
      // other: that is the portal's one law now.
      putBox(0, CLEAR_H + 0.825, 0, 16.0, 2.55, 1.7)
      for (const sx of [-1, 1]) {
        // Inner pillar face at WALL_X + 0.2, NOT at WALL_X: flush with the
        // lining wall the two coplanar surfaces z-fought all over the
        // entrance flanks (the other half of Rubén's corner shimmer), and
        // 0.1 was still within depth-buffer noise at approach distances.
        putBox(sx * (WALL_X + 1.0), (CLEAR_H + 2.2) / 2 - 0.5, 0, 1.6, CLEAR_H + 2.2, 1.4) // pillar
        putBox(sx * (WALL_X + 4.2), 1.2, 2.6, 7.5, 3.4, 0.8, sx * 0.5) // wing wall
      }
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), signMat)
      // 0.15 proud of the (deepened) beam face — at 0.04 the plate sat
      // inside depth-buffer noise at approach distances and could blink.
      plate.position.set(0, CLEAR_H + 1.0, 1.0)
      g.add(plate)
      this.scene.add(tagGroup(g, 'tunnel-portals'))
    }
    portalBoxes.count = pbI
    portalBoxes.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(portalBoxes, 'tunnel-portal-boxes'))

    // The cutting's retaining walls: short concrete panels flanking the
    // approach on both sides of both portals, leaning gently into the fill.
    const APPROACH_UNITS = 46
    const PANEL = 7
    const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 3.0, PANEL + 0.3), portalMat, Math.ceil((APPROACH_UNITS / PANEL) * 4) + 4)
    panels.receiveShadow = true
    let pi = 0
    for (const [from, dir] of [
      [t0 - APPROACH_UNITS / len, 1],
      [t1, 1],
    ] as const) {
      for (let d = 0; d < APPROACH_UNITS; d += PANEL) {
        const t = from + (d * dir) / len
        this.track.pointAt(t, p)
        this.track.tangentAt(t, tangent)
        const nx = -tangent.z
        const nz = tangent.x
        const inv = 1 / Math.hypot(nx, nz)
        for (const side of [1, -1]) {
          if (pi >= panels.instanceMatrix.count) break
          dummy.position.set(p.x + nx * inv * side * 7.3, p.y + 0.9, p.z + nz * inv * side * 7.3)
          dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0)
          dummy.rotateZ(-side * 0.06)
          dummy.updateMatrix()
          panels.setMatrixAt(pi++, dummy.matrix)
        }
      }
    }
    panels.count = pi
    panels.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(panels, 'trench-panels'))
  }

  /**
   * The Kamakura coast (H5): along the bay arc the plain gives way to a real
   * shoreline — sand, a sea that runs out into the fog, foam at the
   * waterline, wind-bent coastal pines, an Enoshima-like island with its
   * lighthouse. The sea sits a hair ABOVE the ground plane and the sand
   * ribbon overlaps both, so no seam can ever open between the three.
   */
  private buildCoast() {
    const T0 = 0.775
    const T1 = 0.955
    const CHUNKS = 4
    const SAMPLES = 96
    // Close enough that the water is a real presence from the cab (the eye
    // sits barely 3.6 units up, so a far shoreline collapses the sea into a
    // sliver at the horizon), far enough to keep the beach out of the
    // trackside corridor.
    const shoreAt = (t: number) => 95 + 18 * Math.sin(t * 197.3) + 9 * Math.sin(t * 463.7 + 2.0)

    const p = new THREE.Vector3()
    const out = new THREE.Vector2()
    // Per-chunk vertex lists: chunk c covers samples [c*24 .. (c+1)*24].
    const sandPos: number[][] = Array.from({ length: CHUNKS }, () => [])
    const sandUv: number[][] = Array.from({ length: CHUNKS }, () => [])
    const seaPos: number[][] = Array.from({ length: CHUNKS }, () => [])
    const seaUv: number[][] = Array.from({ length: CHUNKS }, () => [])
    const foamPos: number[][] = Array.from({ length: CHUNKS }, () => [])
    const perChunk = SAMPLES / CHUNKS
    for (let c = 0; c < CHUNKS; c++) {
      for (let k = 0; k <= perChunk; k++) {
        const i = c * perChunk + k
        const t = T0 + ((T1 - T0) * i) / SAMPLES
        this.track.pointAt(t, p)
        out.set(p.x, p.z).normalize()
        const S = shoreAt(t)
        const v = i / SAMPLES
        // Sand: from inland edge (just above the plain) down under the water.
        sandPos[c].push(
          p.x + out.x * (S - 42), -0.41, p.z + out.y * (S - 42),
          p.x + out.x * (S + 8), -0.5, p.z + out.y * (S + 8),
        )
        sandUv[c].push(0, v * 40, 1, v * 40)
        // Sea: flat sheet from the waterline out into the fog.
        seaPos[c].push(
          p.x + out.x * (S + 2), -0.455, p.z + out.y * (S + 2),
          p.x + out.x * (S + 2600), -0.455, p.z + out.y * (S + 2600),
        )
        seaUv[c].push(0, v * 26, 9, v * 26)
        foamPos[c].push(
          p.x + out.x * (S - 2), -0.447, p.z + out.y * (S - 2),
          p.x + out.x * (S + 7), -0.449, p.z + out.y * (S + 7),
        )
      }
    }
    const stripIndices = (() => {
      const idx: number[] = []
      for (let i = 0; i < perChunk; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
        // Winding chosen so the surface faces the sky (see the embankment note).
        idx.push(a, c, b, b, c, d)
      }
      return idx
    })()

    // The group name is required, not optional: a raw BufferGeometry has no
    // parameters to derive a fallback name from, so sea and foam would both
    // land in one `untagged:BufferGeometry` bucket together with every other
    // hand-built mesh in the world.
    const ribbon = (positions: number[], uvs: number[] | null, mat: THREE.Material, group: string) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      if (uvs) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geo.setIndex(stripIndices)
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, mat)
      mesh.receiveShadow = true
      this.scene.add(tagGroup(mesh, group))
      return mesh
    }

    this.seaTexture = makeSeaTexture()
    const seaMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.seaTexture,
      // Low metalness on purpose: at the grazing angle the cab sees the bay,
      // a metallic surface reflected mostly environment map and the water
      // washed out to sky-gray. Matte-ish keeps the teal.
      roughness: 0.5,
      metalness: 0.06,
    })
    this.foamMat = new THREE.MeshBasicMaterial({ color: 0xf4f8fa, transparent: true, opacity: 0.42, depthWrite: false })
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xe4d4a6, roughness: 1, vertexColors: true })
    for (let c = 0; c < CHUNKS; c++) {
      // Sand carries vertex colors registered as terrain, so winter frosts
      // the beach along with the fields, not a summer postcard strip.
      const sandGeo = new THREE.BufferGeometry()
      sandGeo.setAttribute('position', new THREE.Float32BufferAttribute(sandPos[c], 3))
      sandGeo.setAttribute('uv', new THREE.Float32BufferAttribute(sandUv[c], 2))
      const sandColors = new Float32Array((sandPos[c].length / 3) * 3).fill(1)
      sandGeo.setAttribute('color', new THREE.BufferAttribute(sandColors, 3))
      sandGeo.setIndex(stripIndices)
      sandGeo.computeVertexNormals()
      const sand = new THREE.Mesh(sandGeo, sandMat)
      sand.receiveShadow = true
      this.scene.add(tagGroup(sand, 'beach-sand'))
      this.seasonalPools.push(registerPool('terrain', sandGeo.getAttribute('color') as THREE.BufferAttribute))
      ribbon(seaPos[c], seaUv[c], seaMat, 'sea')
      ribbon(foamPos[c], null, this.foamMat, 'sea-foam')
    }

    // ——— Enoshima on the horizon: a wooded hump and its little lighthouse.
    const islandT = 0.865
    this.track.pointAt(islandT, p)
    out.set(p.x, p.z).normalize()
    const islandBase = new THREE.Vector3(p.x + out.x * (shoreAt(islandT) + 820), -0.45, p.z + out.y * (shoreAt(islandT) + 820))
    const island = new THREE.Mesh(
      new THREE.SphereGeometry(260, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x2e4433, roughness: 1, flatShading: true }),
    )
    island.scale.set(1, 0.32, 0.8)
    island.position.copy(islandBase)
    this.scene.add(tagGroup(island, 'enoshima-island'))
    const lighthouse = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 6, 42, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.6 }),
    )
    lighthouse.position.set(islandBase.x, 82, islandBase.z)
    this.scene.add(tagGroup(lighthouse, 'enoshima-lighthouse'))

    // ——— Rocks at the waterline: dark, half-drowned.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 1, flatShading: true })
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMat, 14)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < 14; i++) {
      const t = T0 + 0.015 + this.rngCoast() * (T1 - T0 - 0.03)
      this.track.pointAt(t, p)
      out.set(p.x, p.z).normalize()
      const S = shoreAt(t)
      const off = S + (this.rngCoast() - 0.3) * 16
      dummy.position.set(p.x + out.x * off, -0.5 + this.rngCoast() * 0.5, p.z + out.y * off)
      dummy.scale.set(2 + this.rngCoast() * 4, 1.2 + this.rngCoast() * 2.4, 2 + this.rngCoast() * 3.5)
      dummy.rotation.set(0, this.rngCoast() * Math.PI, 0)
      dummy.updateMatrix()
      rocks.setMatrixAt(i, dummy.matrix)
    }
    rocks.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(rocks, 'coast-rocks'))

    // ——— Sailboats: white sails scattered over the near water. Nothing
    // says "this is the sea" faster, and seven quads cost nothing.
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.7, side: THREE.DoubleSide })
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.8 })
    const sails = new THREE.InstancedMesh(makeSailGeometry(), sailMat, 7)
    const hulls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 3.4), hullMat, 7)
    for (let i = 0; i < 7; i++) {
      const t = T0 + 0.02 + this.rngCoast() * (T1 - T0 - 0.04)
      this.track.pointAt(t, p)
      out.set(p.x, p.z).normalize()
      const off = shoreAt(t) + 90 + this.rngCoast() * 420
      const x = p.x + out.x * off
      const z = p.z + out.y * off
      const scale = 1.6 + this.rngCoast() * 1.6
      dummy.position.set(x, -0.45, z)
      dummy.rotation.set(0, this.rngCoast() * Math.PI * 2, 0)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      sails.setMatrixAt(i, dummy.matrix)
      hulls.setMatrixAt(i, dummy.matrix)
    }
    sails.instanceMatrix.needsUpdate = true
    hulls.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(sails, 'boat-sails'), tagGroup(hulls, 'boat-hulls'))

    // ——— Coastal pines: the Shonan signature — leaning inland, shaped by
    // the sea wind, strung loosely along the top of the beach.
    const PINES = 44
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.95 })
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 3.4, 5), trunkMat, PINES)
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.95 })
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.0, 3.6, 7), pineMat, PINES)
    crowns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PINES * 3), 3)
    trunks.castShadow = crowns.castShadow = true
    const tint = new THREE.Color()
    for (let i = 0; i < PINES; i++) {
      const t = T0 + ((i + 0.5) / PINES) * (T1 - T0) + (this.rngCoast() - 0.5) * 0.004
      this.track.pointAt(t, p)
      out.set(p.x, p.z).normalize()
      const off = shoreAt(t) - 28 - this.rngCoast() * 18
      const x = p.x + out.x * off
      const z = p.z + out.y * off
      const scale = 0.85 + this.rngCoast() * 0.75
      const lean = 0.14 + this.rngCoast() * 0.2 // tops pushed inland by the onshore wind
      // Lean axis: tilt around the shoreline direction, away from the sea.
      const yaw = Math.atan2(out.x, out.y)
      dummy.position.set(x, BASE_GROUND_Y + 1.6 * scale, z)
      dummy.rotation.set(0, yaw, 0)
      // Negative: the sea wind pushes the APEX inland (風衝樹形) — the
      // positive sign leaned the trunks toward the water (Haruto, round 1).
      dummy.rotateX(-lean)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      trunks.setMatrixAt(i, dummy.matrix)
      dummy.position.set(x - out.x * lean * 4.4 * scale, BASE_GROUND_Y + (3.4 + 1.7) * scale, z - out.y * lean * 4.4 * scale)
      dummy.updateMatrix()
      crowns.setMatrixAt(i, dummy.matrix)
      tint.setHSL(0.33 + this.rngCoast() * 0.05, 0.34, 0.19 + this.rngCoast() * 0.09)
      crowns.setColorAt(i, tint)
    }
    trunks.instanceMatrix.needsUpdate = true
    crowns.instanceMatrix.needsUpdate = true
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true
    this.scene.add(tagGroup(trunks, 'coast-pine-trunks'), tagGroup(crowns, 'coast-pine-crowns'))
    this.seasonalPools.push(registerPool('pine', crowns.instanceColor!))
  }

  private buildClouds() {
    const tex = makeCloudTexture()
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        tint: { value: new THREE.Color(0xffffff) },
        opacity: { value: 0.85 },
        uTime: { value: 0 },
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
    this.cloudsMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.cloudMat, CLOUD_COUNT)
    this.cloudsMesh.frustumCulled = false
    // NOT part of the static world, however much it looks like scenery: the
    // ring is reseeded on every weather change, and the draws come off the
    // 'clouds' stream in the order the weather happened to change — so going
    // to storm and back to clear does NOT restore the previous sky. That is
    // correct behaviour (the director asked for it: "rain can't be the same
    // clouds as fair weather") and it is also exactly why they cannot sit in
    // a hash whose whole job is "same seed, same number". They still show up
    // under dynamicParts, so the day they need pinning it is visible there.
    this.cloudsMesh.userData.dynamic = true
    // Drawn after the stars (which sit at the camera's own position and so
    // sort "nearest"): otherwise star points paint straight over cloud
    // bodies at dawn/dusk, reading as speckly noise on the clouds.
    this.cloudsMesh.renderOrder = 2
    this.scene.add(this.cloudsMesh)
    this.seedClouds()
  }

  /**
   * (Re)places the cloud ring for the current weather — fresh shapes every
   * time the weather changes, so the sky is never "always the same clouds"
   * (Rubén's note). Clear: sparse fair-weather puffs, high and far. Cloudy:
   * fuller and lower. Rain/snow: a heavy lid — big, low, stretched slabs.
   */
  private seedClouds() {
    const heavy = this.weatherLook === 'rain' || this.weatherLook === 'storm'
    const mid = this.weatherLook === 'cloudy'
    const dummy = new THREE.Object3D()
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const angle = (i / CLOUD_COUNT) * Math.PI * 2 + this.rngClouds() * 0.4
      // Kept far out, with width capped relative to distance, so no single
      // transparent quad ever eats a huge slice of mobile fill rate.
      const radius = heavy ? 1100 + this.rngClouds() * 1900 : mid ? 1300 + this.rngClouds() * 2100 : 1500 + this.rngClouds() * 2400
      const w = Math.min(
        heavy ? 520 + this.rngClouds() * 520 : mid ? 400 + this.rngClouds() * 500 : 320 + this.rngClouds() * 480,
        radius * (heavy ? 0.4 : 0.28),
      )
      const y = heavy ? 200 + this.rngClouds() * 220 : mid ? 250 + this.rngClouds() * 300 : 300 + this.rngClouds() * 380
      dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
      // Storm slabs flatten out; fair-weather puffs stay rounder.
      dummy.scale.set(w, w * (heavy ? 0.3 : 0.42), 1)
      dummy.updateMatrix()
      this.cloudsMesh.setMatrixAt(i, dummy.matrix)
    }
    this.cloudsMesh.instanceMatrix.needsUpdate = true
  }

  /** The sky dresses for the weather: reseeds the cloud ring and drives the storm-vs-snow tint in update(). */
  setWeather(weather: Weather) {
    if (weather === this.weatherLook) return
    this.weatherLook = weather
    this.seedClouds()
  }

  /**
   * `trainT` is the train's current progress fraction — used to gate the
   * level-crossing blink/bell to actual approaches. No allocations in here:
   * all colors are module constants or reused scratch objects (Marco's rule).
   */
  update(dt: number, dayNight: DayNightCycle, trainT: number) {
    this.time += dt
    const night = dayNight.nightFactor
    const horizon = dayNight.horizonColor
    // Blossom cards: sway clock + the night dimmer their unlit shader needs.
    this.sakuraCloud.tick(this.time, night)

    // Fuji sits against the sky: tint toward the horizon color by day, nearly
    // silhouette-black at night, warm at dawn/dusk automatically because the
    // horizon color itself warms.
    // 0.62 → 0.74 body / 0.35 → 0.48 snow-toward-horizon: at the old weights
    // the whole mountain washed out into a pale ghost by day.
    this.fujiBodyMat.color.copy(horizon).lerp(FUJI_TINT, 0.74).multiplyScalar(1 - night * 0.55)
    this.fujiSnowMat.color.copy(SNOW_TINT).lerp(horizon, 0.48).multiplyScalar(1 - night * 0.5)

    // Landmark illumination fades in with dusk; by day their base color leans
    // toward the horizon so the fog-free materials still feel distant.
    this.towerGlowMat.emissiveIntensity = night * 0.85
    this.skytreeGlowMat.emissiveIntensity = night * 1.1
    this.towerGlowMat.color.copy(TOWER_RED).lerp(horizon, (1 - night) * 0.45)
    this.skytreeMat.color.copy(SKYTREE_STEEL).lerp(horizon, (1 - night) * 0.5)
    this.skytreeGlowMat.color.copy(this.skytreeMat.color)
    // Skytree alternates its two real lighting styles through the night:
    // "Iki" ice blue and "Miyabi" purple, on a slow crossfade.
    const miyabi = 0.5 + 0.5 * Math.sin(this.time * 0.045)
    this.skytreeGlowMat.emissive.copy(SKYTREE_IKI).lerp(SKYTREE_MIYABI, miyabi)
    // Rainbow Bridge: soft spectrum sweep along the deck after dark.
    this.bridgeGlowMat.emissiveIntensity = night * 0.55
    this.bridgeGlowMat.emissive.setHSL((this.time * 0.012) % 1, 0.55, 0.6)
    for (const mat of this.neonMats) {
      mat.emissiveIntensity = THREE.MathUtils.lerp(0.08, 2.4, night)
    }
    // House/skyline windows switch on per-window via the progressive shader.

    // The fumikiri only comes alive when the train is actually bearing down
    // on it (or just past it) — light and bell gate together.
    const trackLen = this.track.getLength()
    const distUnits = Math.abs((((trainT - this.crossingT) % 1) + 1.5) % 1 - 0.5) * trackLen
    this.crossingBellActive = distUnits < 260
    this.crossingBlinkPhase = this.crossingBellActive && Math.sin(this.time * Math.PI * 2.8) > 0
    for (const lights of this.crossingLights) {
      lights.a.emissiveIntensity = this.crossingBlinkPhase ? 2.2 : 0.05
      lights.b.emissiveIntensity = !this.crossingBellActive || this.crossingBlinkPhase ? 0.05 : 2.2
    }

    // Sakura petals drift and fall on a gentle sinusoidal breeze. Outside
    // spring only the evergreen (hill garden) clusters keep shedding; the
    // rest park their petals under the world.
    if (this.petalsMesh) {
      const attr = this.petalsMesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const n = arr.length / 3
      const springActive = this.season === 'spring'
      for (let i = 0; i < n; i++) {
        const cluster = this.sakuraClusters[(i / PETALS_PER_CLUSTER) | 0]
        if (!springActive && !cluster.always) {
          arr[i * 3 + 1] = -120
          continue
        }
        const cx = this.petalSeeds[i * 4]
        const cz = this.petalSeeds[i * 4 + 1]
        const phase = this.petalSeeds[i * 4 + 2]
        const fall = this.petalSeeds[i * 4 + 3]
        const local = (this.time * fall + phase) % 8 // loops each petal from canopy height back to the top
        arr[i * 3] = cx + Math.sin(this.time * 0.7 + phase) * 1.6
        arr[i * 3 + 1] = 8.2 - local
        arr[i * 3 + 2] = cz + Math.cos(this.time * 0.5 + phase * 1.7) * 1.6
      }
      attr.needsUpdate = true
    }

    // Clouds: white by day, dusk-tinted, near-invisible dark at night — and
    // dressed for the weather as the overcast closes in: RAIN brings true
    // dark nimbus (Rubén: "tiene que haber nubes oscuras en lluvia"), while
    // a snowfall keeps the light ash lid that reads as snow-laden, and
    // plain cloudy sits in between.
    const o = dayNight.overcast
    const storm = this.weatherLook === 'storm'
    const raining = this.weatherLook === 'rain' || storm
    const snowing = raining && this.season === 'winter'
    // A blizzard keeps snow's light lid but drops it a stop darker; a rain
    // storm gets the darkest nimbus in the wardrobe.
    const overcastTintTarget = snowing ? (storm ? MID_CLOUD : OVERCAST_CLOUD) : raining ? STORM_CLOUD : MID_CLOUD
    const tint = this.cloudMat.uniforms.tint.value as THREE.Color
    tint.copy(horizon).lerp(WHITE, 0.55).multiplyScalar(1 - night * 0.82)
    if (o > 0.001) tint.lerp(overcastTintTarget, (raining && !snowing ? 0.85 : 0.7) * o)
    this.cloudMat.uniforms.opacity.value = (0.85 - night * 0.55) * (1 + (raining ? 0.3 : 0.18) * o)
    this.cloudMat.uniforms.uTime.value = this.time

    // The sea breathes: streak texture creeping shoreward, foam pulsing on
    // the ~9-second rhythm of real surf. Two uniform-ish writes per frame.
    if (this.seaTexture) {
      this.seaTexture.offset.y = (this.time * 0.006) % 1
      this.seaTexture.offset.x = Math.sin(this.time * 0.05) * 0.02
    }
    if (this.foamMat) this.foamMat.opacity = 0.3 + 0.18 * (0.5 + 0.5 * Math.sin(this.time * 0.7))
  }

  /**
   * One-off seasonal repaint: every registered pool remaps its as-built
   * colors, Fuji swaps snowlines, and the petal gate flips. Costs a few
   * thousand HSL conversions on the frame the player changes season — zero
   * every other frame.
   */
  setSeason(season: Season) {
    this.season = season
    for (const pool of this.seasonalPools) applySeasonToPool(pool, season)
    // The card crowns change SHAPE with the season (bloom/leaf/amber/bare),
    // not just tint; the fallen-petal carpet follows the same spring gate
    // as the drifting petals.
    this.sakuraCloud.setSeason(season)
    this.petalCarpet.setSeason(season)
    this.fujiSnowRegular.visible = season !== 'winter'
    this.fujiSnowWinter.visible = season === 'winter'
  }
}

/** A little sloop: triangular main + a hint of jib, one BufferGeometry. */
function makeSailGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const v = new Float32Array([
    // main sail
    0, 0.4, -0.2, 0, 5.2, -0.2, 0, 0.4, 2.1,
    // jib, slightly forward
    0.06, 0.4, -0.4, 0.06, 3.6, -0.35, 0.06, 0.4, -1.9,
  ])
  g.setAttribute('position', new THREE.BufferAttribute(v, 3))
  g.computeVertexNormals()
  return g
}

/**
 * The sea surface: deep teal with faint wave streaks running shore-parallel,
 * scrolled slowly by Scenery.update(). Streaks, not ripples — from a train
 * the bay reads as long horizontal bands of light, and a tiled ripple
 * pattern would moiré at the grazing angle the cab sees it from.
 */
function makeSeaTexture(): THREE.CanvasTexture {
  // Fixed seed, not a world stream: the sea's streaks are ARTWORK, and the
  // texture should look the same in every world — only its layout is seeded.
  const rnd = mulberry32(0x5ea7)
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const base = ctx.createLinearGradient(0, 0, 0, size)
  base.addColorStop(0, '#175066')
  base.addColorStop(1, '#1b5a72')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  // Wave streaks: soft bright bands with darker troughs between them.
  for (let i = 0; i < 46; i++) {
    const y = rnd() * size
    const w = 30 + rnd() * 110
    const x = rnd() * size
    const bright = rnd() < 0.6
    ctx.fillStyle = bright ? 'rgba(180,220,235,0.10)' : 'rgba(8,24,34,0.14)'
    ctx.fillRect(x - w / 2, y, w, 1.5 + rnd() * 2)
  }
  // A scatter of sun glints.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(210,235,245,${(0.04 + rnd() * 0.08).toFixed(3)})`
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const UP = new THREE.Vector3(0, 1, 0)

// Fixed palette used by update() every frame — hoisted so the per-frame path
// allocates nothing.
const FUJI_TINT = new THREE.Color(0x3d4a63)
const SNOW_TINT = new THREE.Color(0xeef2f8)
const TOWER_RED = new THREE.Color(0xd8442a)
const SKYTREE_STEEL = new THREE.Color(0xb8c4cc)
const SKYTREE_IKI = new THREE.Color(0x9fd8ff)
const SKYTREE_MIYABI = new THREE.Color(0xc9a0e8)
const WHITE = new THREE.Color(0xffffff)
// Three overcast wardrobes: light ash for snowfall (a charcoal snow sky
// read as smoke plumes — panel ronda 1), a middle gray for plain cloudy,
// and a genuinely dark nimbus for rain (director's note: rain clouds must
// be DARK, and never the same clouds as fair weather).
const OVERCAST_CLOUD = new THREE.Color(0x99a1ab)
const MID_CLOUD = new THREE.Color(0x848d98)
const STORM_CLOUD = new THREE.Color(0x424a55)
