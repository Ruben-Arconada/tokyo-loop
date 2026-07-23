import * as THREE from 'three'
import type { Track } from './Track'
import { STATIONS, prevStationIndex, nextStationIndex, type ZoneTier } from '../data/stations'
import { makeStationSignTexture, makePlatformTileTexture, makeTactilePavingTexture, makeWindowGridTexture, applyProgressiveWindows, LOOP_LINE_COLOR } from './signage'

const THEME_GROUPS = ['business', 'downtown', 'shitamachi', 'green', 'youth', 'bay'] as const

/**
 * Structural skyline contrast by zone tier — density and height, not
 * lighting, so a quiet stretch reads as quiet at noon just as much as at
 * midnight. Shared with Scenery.ts (houses/vegetation/neon) for one
 * consistent rural → mid → urban gradient around the loop.
 */
export const TIER_PARAMS: Record<ZoneTier, { density: number; minH: number; maxH: number }> = {
  quiet: { density: 0.45, minH: 8, maxH: 22 },
  mid: { density: 1.0, minH: 14, maxH: 55 },
  urban: { density: 2.2, minH: 24, maxH: 130 },
}
const N = STATIONS.length

const PLATFORM_TOP = 1.2
const COLUMN_HEIGHT = 5.0
const COLUMN_Y = PLATFORM_TOP + COLUMN_HEIGHT / 2
const COLUMN_TOP = PLATFORM_TOP + COLUMN_HEIGHT
const ROOF_THICK = 0.5
const ROOF_Y = COLUMN_TOP + ROOF_THICK / 2
const SIGN_Y = 4.15
const SIGN_W = 7
const SIGN_H = SIGN_W / (1024 / 384)
const FRAME_W = SIGN_W + 0.4
const FRAME_H = SIGN_H + 0.28
const ROD_Y = (SIGN_Y + FRAME_H / 2 + (COLUMN_TOP + 0.05)) / 2
const ROD_LEN = COLUMN_TOP + 0.05 - (SIGN_Y + FRAME_H / 2)
const PASSENGERS_PER_STATION = 6
/** Passenger sway/visibility refresh cadence — see City.update(). */
const PASSENGER_UPDATE_INTERVAL = 1 / 12

// The platform runs ALONGSIDE the track (long in Z, the direction of
// travel) and sits entirely to one side of it (offset in X) — like a real
// boarding platform — rather than straddling the rails. Which side depends
// on the station's `doorSide`, so the announced door side actually matches
// what's on screen.
const TRACK_CLEARANCE = 3
const PLATFORM_DEPTH = 11
const PLATFORM_INNER = TRACK_CLEARANCE
const PLATFORM_OUTER = TRACK_CLEARANCE + PLATFORM_DEPTH
const PLATFORM_MID = (PLATFORM_INNER + PLATFORM_OUTER) / 2
const PLATFORM_LEN = 70
const ROOF_INNER = PLATFORM_INNER - 2
const ROOF_OUTER = PLATFORM_OUTER + 1.5
const ROOF_MID = (ROOF_INNER + ROOF_OUTER) / 2
const ROOF_WIDTH = ROOF_OUTER - ROOF_INNER
const COLUMN_ZS = [-28, -14, 0, 14, 28]
const LAMP_ZS = [-28, -14, 0, 14, 28]

/** Rough crowd density by hour — busiest around the morning/evening rush, quiet overnight. */
function crowdDensityForHour(hour: number): number {
  const proximity = (center: number, width: number) => Math.max(0, 1 - Math.abs(((hour - center + 12 + 24) % 24) - 12) / width)
  const rush = Math.max(proximity(8, 2.5), proximity(18, 2.5))
  return THREE.MathUtils.clamp(0.16 + rush * 0.84, 0, 1)
}

interface ThemeGroup {
  instanced: THREE.InstancedMesh
  material: THREE.MeshStandardMaterial
}

interface PassengerSlot {
  basePosition: THREE.Vector3
  baseQuaternion: THREE.Quaternion
  phase: number
  visibilityRoll: number
}

interface SignEntry {
  index: number
  material: THREE.MeshStandardMaterial
}

/**
 * Procedural city dressing scattered along the track: generic buildings
 * (grouped by district "theme" so their window-glow can be animated in bulk),
 * platforms + signage at all 30 stations built from a shared library of
 * InstancedMesh props (one draw call per prop type regardless of station
 * count — see Marco's perf guardrail), and a handful of bespoke props at the
 * busiest landmark stations.
 */
export class City {
  private scene: THREE.Scene
  private track: Track
  private themeGroups = new Map<string, ThemeGroup>()
  private videoScreenMaterials: THREE.ShaderMaterial[] = []
  private nightGlowMaterials: THREE.MeshStandardMaterial[] = []
  private lampMaterials: THREE.MeshStandardMaterial[] = []
  private vendingMat!: THREE.MeshStandardMaterial
  private lanternMat!: THREE.MeshStandardMaterial
  private ledStripMat!: THREE.MeshStandardMaterial
  private signEntries: SignEntry[] = []
  private passengerMesh!: THREE.InstancedMesh
  private passengerHeadMesh!: THREE.InstancedMesh
  private passengerSlots: PassengerSlot[] = []
  private time = 0
  private passengerUpdateAccum = 0

  constructor(scene: THREE.Scene, track: Track) {
    this.scene = scene
    this.track = track
    this.buildBuildings()
    this.buildPlatforms()
    this.buildPassengers()
  }

  private buildBuildings() {
    const perTheme = 200
    const dummy = new THREE.Object3D()

    // Each district gets its own facade rhythm: dense cool office grids for
    // business/bay, warm small windows in shitamachi, and a splash of colored
    // light in the youth/downtown nightlife districts.
    // Facade tones are kept fairly light because they multiply against each
    // theme's buildingColor — darker values here made every district read as
    // near-black in daylight. Denser grids = smaller windows = truer scale.
    const windowStyles: Record<(typeof THEME_GROUPS)[number], ReturnType<typeof makeWindowGridTexture>> = {
      business: makeWindowGridTexture(12, 20, { glass: '#6d7c92', facade: '#9aa4b2', litChance: 0.42, litColors: ['#eef3ff', '#dce8ff', '#fff6da'] }),
      downtown: makeWindowGridTexture(9, 15, { glass: '#707684', facade: '#a09aa8', litChance: 0.5, litColors: ['#fff6da', '#ffe9b0', '#ffd2f0', '#c8f4ff'] }),
      shitamachi: makeWindowGridTexture(6, 10, { glass: '#7a6f60', facade: '#a89c8c', litChance: 0.55, litColors: ['#ffdf9e', '#ffe9b0', '#fff6da'] }),
      green: makeWindowGridTexture(6, 9, { glass: '#6f7c6c', facade: '#9aa694', litChance: 0.4, litColors: ['#ffe9b0', '#fff6da'] }),
      youth: makeWindowGridTexture(8, 13, { glass: '#7a7090', facade: '#a49cb4', litChance: 0.52, litColors: ['#fff6da', '#ffb8e2', '#a5e8ff', '#ffe9b0'] }),
      bay: makeWindowGridTexture(11, 18, { glass: '#6c7e8e', facade: '#98a8b6', litChance: 0.4, litColors: ['#e2f0ff', '#fff6da', '#d0e6ff'] }),
    }

    for (const theme of THEME_GROUPS) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const windowTex = windowStyles[theme]
      const material = new THREE.MeshStandardMaterial({
        color: 0x555555,
        map: windowTex.map,
        roughness: 0.85,
        metalness: 0.05,
        emissive: 0xffffff,
        emissiveMap: windowTex.emissiveMap,
        emissiveIntensity: 1.25,
      })
      applyProgressiveWindows(material)
      const instanced = new THREE.InstancedMesh(geo, material, perTheme)
      instanced.castShadow = true
      instanced.receiveShadow = true
      instanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(perTheme * 3), 3)
      this.scene.add(instanced)
      this.themeGroups.set(theme, { instanced, material })
    }

    const counters = new Map<string, number>(THEME_GROUPS.map((t) => [t, 0]))
    const trackLen = this.track.getLength()
    const tintColor = new THREE.Color()

    for (let s = 0; s < N; s++) {
      const station = STATIONS[s]
      const group = this.themeGroups.get(station.theme.district)!
      // The theme palette doubles as each district's identity, but raw it
      // multiplies down to near-black against the facade texture — lift it
      // so daylight shows actual color instead of silhouettes.
      group.material.color.setHex(station.theme.buildingColor).multiplyScalar(1.75)

      const zone = TIER_PARAMS[station.theme.tier]
      const markerA = this.track.markerFor(s).tFraction
      const markerB = this.track.markerFor((s + 1) % N).tFraction
      const span = ((markerB - markerA + 1) % 1) || 0.02
      const buildingsHere = Math.max(2, Math.round((span * trackLen) / 55 * zone.density))

      for (let b = 0; b < buildingsHere; b++) {
        const t = markerA + span * ((b + 0.5) / buildingsHere)
        const point = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = b % 2 === 0 ? 1 : -1
        const offset = 34 + Math.random() * 70
        // Height comes from the ZONE first (this is the structural contrast
        // that reads at any hour), with landmark stations getting an extra
        // flourish within their own tier's range rather than overriding it.
        const heightSpan = zone.maxH - zone.minH
        const height = zone.minH + Math.random() * heightSpan * (station.landmark ? 1.25 : 1)
        const width = 10 + Math.random() * 12
        const depth = 10 + Math.random() * 12

        const pos = point.clone().add(normal.clone().multiplyScalar(side * offset))
        dummy.position.set(pos.x, height / 2, pos.z)
        dummy.scale.set(width, height, depth)
        dummy.rotation.y = Math.random() * Math.PI
        dummy.updateMatrix()

        const globalIdx = counters.get(station.theme.district)!
        if (globalIdx < perTheme) {
          group.instanced.setMatrixAt(globalIdx, dummy.matrix)
          const shade = 0.85 + Math.random() * 0.3
          tintColor.setHex(0xffffff).multiplyScalar(shade)
          group.instanced.setColorAt(globalIdx, tintColor)
          counters.set(station.theme.district, globalIdx + 1)
        } else if (import.meta.env.DEV) {
          console.warn(`City: hit perTheme=${perTheme} cap for district "${station.theme.district}" — some background buildings were skipped.`)
        }
      }
    }
    for (const theme of THEME_GROUPS) {
      const group = this.themeGroups.get(theme)!
      group.instanced.instanceMatrix.needsUpdate = true
      if (group.instanced.instanceColor) group.instanced.instanceColor.needsUpdate = true
      group.instanced.count = counters.get(theme) || 0
    }
  }

  private buildPlatforms() {
    const dummy = new THREE.Object3D()

    // Station furniture splits into two looks via per-instance tints on
    // white-based materials: RUSTIC (shitamachi/green — wooden columns,
    // warm stone, tiled-brown canopies, timber benches) for the quieter
    // stretches, MODERN (steel, cool navy canopies) for the big-city ones.
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, map: makePlatformTileTexture() })
    ;(platformMat.map as THREE.Texture).repeat.set(3, 22)
    // Cheap sharpness at grazing angles — the platform floor is always seen nearly edge-on from the cab.
    ;(platformMat.map as THREE.Texture).anisotropy = 8
    const platformSlab = new THREE.InstancedMesh(new THREE.BoxGeometry(PLATFORM_DEPTH, 1.2, PLATFORM_LEN), platformMat, N)
    platformSlab.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3)
    platformSlab.receiveShadow = true

    const safetyMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0, roughness: 0.6 })
    const safetyStrip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.08, PLATFORM_LEN - 2), safetyMat, N)

    const tactileMat = new THREE.MeshStandardMaterial({ map: makeTactilePavingTexture(), roughness: 0.85 })
    const tactileStrip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, PLATFORM_LEN - 2), tactileMat, N)

    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25 })
    const roof = new THREE.InstancedMesh(new THREE.BoxGeometry(ROOF_WIDTH, ROOF_THICK, PLATFORM_LEN + 2), roofMat, N)
    roof.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3)
    roof.castShadow = true

    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 })
    const fascia = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.5, PLATFORM_LEN + 2), fasciaMat, N)
    fascia.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3)

    const columnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.55 })
    const columns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, COLUMN_HEIGHT, 0.42), columnMat, N * COLUMN_ZS.length)
    columns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * COLUMN_ZS.length * 3), 3)
    columns.castShadow = true
    const columnBandMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.6 })
    const columnBands = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.35, 0.46), columnBandMat, N * COLUMN_ZS.length)
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x333844, metalness: 0.4, roughness: 0.5 })
    const struts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), strutMat, N * COLUMN_ZS.length)

    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xfff2c0, emissiveIntensity: 0 })
    const lampBody = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 8, 8), lampMat, N * LAMP_ZS.length)
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.5, roughness: 0.4 })
    const lampHousing = new THREE.InstancedMesh(new THREE.ConeGeometry(0.4, 0.35, 10, 1, true), housingMat, N * LAMP_ZS.length)

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x505860, metalness: 0.7, roughness: 0.3 })
    const signFrame = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, FRAME_H, FRAME_W), frameMat, N)
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 0.6, roughness: 0.4 })
    const signRods = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, Math.max(ROD_LEN, 0.15), 6), rodMat, N * 2)

    const benchMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
    const bench = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.9, 2.4), benchMat, N)
    bench.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3)
    const vendingMat = new THREE.MeshStandardMaterial({ color: 0xd7dde3, emissive: 0x6fb8ff, emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.2 })
    const vending = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.9, 1.3), vendingMat, N)
    this.vendingMat = vendingMat
    const clockPoleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.4 })
    const clockPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), clockPoleMat, N)
    const clockFaceMat = new THREE.MeshStandardMaterial({ color: 0xf5f3ec, emissive: 0x111111, roughness: 0.5 })
    const clockFace = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 20), clockFaceMat, N)
    const mapBoardMat = new THREE.MeshStandardMaterial({ color: 0xeceadf, roughness: 0.7 })
    const mapBoard = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.1, 1.6), mapBoardMat, N)

    // ——— Per-style character props ———
    // Rustic: a gabled ridge riding the flat canopy (so roofs stop being
    // slabs) + paper-lantern posts with a warm night glow.
    const rusticCount = STATIONS.filter((s) => s.theme.tier === 'quiet').length
    const ridgeGeo = (() => {
      const g = new THREE.BufferGeometry()
      const hw = ROOF_WIDTH / 2 + 0.3
      const ridgeH = 1.7
      const L = (PLATFORM_LEN + 2) / 2
      const verts = new Float32Array([
        -hw, 0, L, hw, 0, L, 0, ridgeH, L,
        hw, 0, -L, -hw, 0, -L, 0, ridgeH, -L,
        -hw, 0, L, 0, ridgeH, L, 0, ridgeH, -L, -hw, 0, L, 0, ridgeH, -L, -hw, 0, -L,
        hw, 0, L, hw, 0, -L, 0, ridgeH, -L, hw, 0, L, 0, ridgeH, -L, 0, ridgeH, L,
      ])
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3))
      g.computeVertexNormals()
      return g
    })()
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.85 })
    const ridges = new THREE.InstancedMesh(ridgeGeo, ridgeMat, rusticCount)
    ridges.castShadow = true
    const lanternPostMat = new THREE.MeshStandardMaterial({ color: 0x3d2f24, roughness: 0.8 })
    const lanternPosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 6), lanternPostMat, rusticCount * 2)
    this.lanternMat = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffb64a, emissiveIntensity: 0, roughness: 0.6 })
    const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 8, 8), this.lanternMat, rusticCount * 2)

    // Modern: frosted-glass windbreak panels near the boarding edge and a
    // cool LED strip under the canopy lip.
    const modernCount = N - rusticCount
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe2ee, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false })
    const windbreaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.5, 7), glassMat, modernCount * 2)
    this.ledStripMat = new THREE.MeshStandardMaterial({ color: 0xdff2ff, emissive: 0xbfe8ff, emissiveIntensity: 0.1, roughness: 0.5 })
    const ledStrips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.06, PLATFORM_LEN - 6), this.ledStripMat, modernCount)

    // Every station: cross-beams tying the canopy to its columns, and small
    // hanging wayfinding boards under the canopy — the roof stops being an
    // empty slab overhead.
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.6 })
    const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(ROOF_WIDTH - 1.2, 0.14, 0.2), beamMat, N * COLUMN_ZS.length)
    beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * COLUMN_ZS.length * 3), 3)
    const hangSignTex = (() => {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 48
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#f4f2ea'
      ctx.fillRect(0, 0, 128, 48)
      ctx.fillStyle = '#' + LOOP_LINE_COLOR.toString(16).padStart(6, '0')
      ctx.fillRect(0, 38, 128, 10)
      ctx.fillStyle = '#222'
      ctx.font = '700 20px "Hiragino Sans", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('のりば', 64, 26)
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    })()
    // Front/back instance pairs (not DoubleSide) so のりば never mirrors.
    const hangSignMat = new THREE.MeshStandardMaterial({ map: hangSignTex, emissive: 0xffffff, emissiveMap: hangSignTex, emissiveIntensity: 0.08, roughness: 0.7 })
    const hangSigns = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 0.55), hangSignMat, N * 4)

    const instancedPools: THREE.InstancedMesh[] = [
      platformSlab, safetyStrip, tactileStrip, roof, fascia, columns, columnBands, struts,
      lampBody, lampHousing, signFrame, signRods, bench, vending, clockPole, clockFace, mapBoard,
      ridges, lanternPosts, lanterns, windbreaks, ledStrips, beams, hangSigns,
    ]
    let rusticIdx = 0
    let modernIdx = 0

    const put = (mesh: THREE.InstancedMesh, index: number, group: THREE.Group, local: THREE.Vector3, yRot = 0, xRot = 0, zRot = 0) => {
      dummy.position.copy(local).applyMatrix4(group.matrixWorld)
      dummy.quaternion.copy(group.quaternion)
      if (yRot) dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yRot))
      if (xRot) dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), xRot))
      if (zRot) dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), zRot))
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    }

    // Two furniture palettes; every tinted pool reads its station's style here.
    const STYLE = {
      rustic: { slab: 0xcbb896, roof: 0x5a4332, fascia: 0x3d2f24, column: 0x7a5b3a, bench: 0x8a6a42 },
      modern: { slab: 0xb9b3a4, roof: 0x2b3040, fascia: 0x1c2028, column: 0x4c5a4a, bench: 0x2f6b46 },
    }
    const tint = new THREE.Color()

    for (let s = 0; s < N; s++) {
      const station = STATIONS[s]
      const marker = this.track.markerFor(s)
      const point = this.track.pointAt(marker.tFraction)
      const tangent = this.track.tangentAt(marker.tFraction)

      const style = station.theme.tier === 'quiet' ? STYLE.rustic : STYLE.modern
      platformSlab.setColorAt(s, tint.setHex(style.slab))
      roof.setColorAt(s, tint.setHex(style.roof))
      fascia.setColorAt(s, tint.setHex(style.fascia))
      bench.setColorAt(s, tint.setHex(style.bench))
      for (let c = 0; c < COLUMN_ZS.length; c++) {
        columns.setColorAt(s * COLUMN_ZS.length + c, tint.setHex(style.column))
        beams.setColorAt(s * COLUMN_ZS.length + c, tint.setHex(style.column).multiplyScalar(0.82))
      }

      const group = new THREE.Group()
      group.position.copy(point)
      group.lookAt(point.clone().add(tangent))
      group.updateMatrixWorld(true)
      this.scene.add(group)

      // The group's local +X axis points to the driver's LEFT (lookAt builds
      // X = up × forward), so 'left' means +X here. Getting this sign wrong
      // put every platform opposite the announced door side.
      const side = station.doorSide === 'left' ? 1 : -1
      const sx = (x: number) => side * x
      const faceTrackYRot = -side * (Math.PI / 2)

      put(platformSlab, s, group, new THREE.Vector3(sx(PLATFORM_MID), 0.6, 0))
      put(safetyStrip, s, group, new THREE.Vector3(sx(PLATFORM_INNER + 0.3), 1.24, 0))
      put(tactileStrip, s, group, new THREE.Vector3(sx(PLATFORM_INNER + 0.9), 1.23, 0))
      put(roof, s, group, new THREE.Vector3(sx(ROOF_MID), ROOF_Y, 0))
      put(fascia, s, group, new THREE.Vector3(sx(ROOF_INNER + 0.1), COLUMN_TOP - 0.15, 0))

      COLUMN_ZS.forEach((cz, i) => {
        const idx = s * COLUMN_ZS.length + i
        put(columns, idx, group, new THREE.Vector3(sx(PLATFORM_OUTER - 0.6), COLUMN_Y, cz))
        put(columnBands, idx, group, new THREE.Vector3(sx(PLATFORM_OUTER - 0.6), PLATFORM_TOP + 0.6, cz))
        put(struts, idx, group, new THREE.Vector3(sx(PLATFORM_OUTER - 1.5), COLUMN_TOP - 0.05, cz), 0, 0, -side * Math.PI * 0.18)
        put(beams, idx, group, new THREE.Vector3(sx(ROOF_MID), COLUMN_TOP - 0.12, cz))
      })
      // Hanging boards under the canopy near each platform end, readable both ways.
      ;[-18, 18].forEach((hz, i) => {
        for (const flip of [0, 1]) {
          const idx = s * 4 + i * 2 + flip
          put(hangSigns, idx, group, new THREE.Vector3(sx(ROOF_MID - 1), COLUMN_TOP - 0.62, hz + (flip ? 0.02 : -0.02)), flip ? Math.PI : 0)
        }
      })

      LAMP_ZS.forEach((lz, i) => {
        const idx = s * LAMP_ZS.length + i
        put(lampBody, idx, group, new THREE.Vector3(sx(PLATFORM_MID), 5.75, lz))
        put(lampHousing, idx, group, new THREE.Vector3(sx(PLATFORM_MID), 5.95, lz))
      })

      put(signFrame, s, group, new THREE.Vector3(sx(PLATFORM_INNER + 1.2), SIGN_Y, 10))
      ;[-1, 1].forEach((rodSide, i) => {
        const idx = s * 2 + i
        put(signRods, idx, group, new THREE.Vector3(sx(PLATFORM_INNER + 1.2), ROD_Y, 10 + rodSide * (FRAME_W / 2 - 0.15)))
      })

      const isRustic = station.theme.tier === 'quiet'
      if (isRustic) {
        put(ridges, rusticIdx, group, new THREE.Vector3(sx(ROOF_MID), ROOF_Y + ROOF_THICK / 2, 0))
        for (let li = 0; li < 2; li++) {
          const idx = rusticIdx * 2 + li
          const lz = li === 0 ? -24 : 24
          put(lanternPosts, idx, group, new THREE.Vector3(sx(PLATFORM_INNER + 2.2), PLATFORM_TOP + 1.05, lz))
          put(lanterns, idx, group, new THREE.Vector3(sx(PLATFORM_INNER + 2.2), PLATFORM_TOP + 2.25, lz))
        }
        rusticIdx++
      } else {
        for (let wi = 0; wi < 2; wi++) {
          const idx = modernIdx * 2 + wi
          put(windbreaks, idx, group, new THREE.Vector3(sx(PLATFORM_INNER + 1.8), PLATFORM_TOP + 0.75, wi === 0 ? -14 : 16))
        }
        put(ledStrips, modernIdx, group, new THREE.Vector3(sx(ROOF_INNER + 0.4), COLUMN_TOP - 0.32, 0))
        modernIdx++
      }

      put(bench, s, group, new THREE.Vector3(sx(PLATFORM_MID - 1.5), PLATFORM_TOP + 0.45, -20))
      put(vending, s, group, new THREE.Vector3(sx(PLATFORM_OUTER - 1.2), PLATFORM_TOP + 0.95, -8))
      put(clockPole, s, group, new THREE.Vector3(sx(PLATFORM_OUTER - 1.2), PLATFORM_TOP + 1.3, 22))
      put(clockFace, s, group, new THREE.Vector3(sx(PLATFORM_OUTER - 1.2), PLATFORM_TOP + 2.65, 22), 0, 0, side * Math.PI / 2)
      put(mapBoard, s, group, new THREE.Vector3(sx(PLATFORM_MID - 1.5), PLATFORM_TOP + 1.4, -28))

      const prev = STATIONS[prevStationIndex(s)]
      const next = STATIONS[nextStationIndex(s)]
      const signTex = makeStationSignTexture({
        nameEn: station.nameEn,
        nameJa: station.nameJa,
        nameKana: station.nameKana,
        code: `TL${String(s + 1).padStart(2, '0')}`,
        prevNameEn: prev.nameEn,
        nextNameEn: next.nameEn,
      })
      const signMat = new THREE.MeshStandardMaterial({
        map: signTex,
        emissive: 0xffffff,
        emissiveMap: signTex,
        emissiveIntensity: 0.05,
        roughness: 0.7,
      })
      this.signEntries.push({ index: s, material: signMat })
      const frameX = sx(PLATFORM_INNER + 1.2)
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(SIGN_W, SIGN_H), signMat)
      sign.position.set(frameX - side * 0.08, SIGN_Y, 10)
      sign.rotation.y = faceTrackYRot
      group.add(sign)
      const signBack = new THREE.Mesh(new THREE.PlaneGeometry(SIGN_W, SIGN_H), signMat)
      signBack.position.set(frameX + side * 0.08, SIGN_Y, 10)
      signBack.rotation.y = faceTrackYRot + Math.PI
      group.add(signBack)

      this.addLandmarkProps(station.id, group, station.theme.accentColor)
    }

    for (const mesh of instancedPools) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.scene.add(mesh)
    }
    this.lampMaterials.push(lampMat)
  }

  private addLandmarkProps(id: string, stationGroup: THREE.Group, accent: number) {
    // Landmark props stand on the GROUND plane (y=-0.5 world), not at track
    // height like the platforms — and slightly sunk (-0.58) so no base ever
    // shows a shadow gap. Station groups sit at track level, hence the wrapper.
    const group = new THREE.Group()
    group.position.y = -0.58
    stationGroup.add(group)
    switch (id) {
      case 'tokyo': {
        // Set fully to one side of the line — centered on local x=0 it sat
        // straight across the rails.
        const facade = new THREE.Mesh(
          new THREE.BoxGeometry(46, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.8 }),
        )
        facade.position.set(40, 8, -55)
        facade.rotation.y = 0.15
        group.add(facade)
        for (const dx of [-18, 0, 18]) {
          const dome = new THREE.Mesh(
            new THREE.SphereGeometry(4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x4a2a20 }),
          )
          dome.position.set(40 + dx, 16, -55 - dx * 0.15)
          group.add(dome)
        }
        break
      }
      case 'ueno': {
        for (let i = 0; i < 10; i++) {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x4a3527 }))
          const canopy = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 2, 8, 6), new THREE.MeshStandardMaterial({ color: 0x5f8a4a, roughness: 1 }))
          const gx = -30 - Math.random() * 30
          const gz = 20 + Math.random() * 20
          trunk.position.set(gx, 2, gz)
          canopy.position.set(gx, 5.5, gz)
          trunk.castShadow = canopy.castShadow = true
          group.add(trunk, canopy)
        }
        break
      }
      case 'ikebukuro': {
        const tower = new THREE.Mesh(
          new THREE.CylinderGeometry(9, 12, 110, 16),
          new THREE.MeshStandardMaterial({ color: 0x5a6478, emissive: accent, emissiveIntensity: 0, roughness: 0.4, metalness: 0.3 }),
        )
        tower.position.set(-70, 55, -40)
        tower.castShadow = true
        this.nightGlowMaterials.push(tower.material as THREE.MeshStandardMaterial)
        group.add(tower)
        break
      }
      case 'shinjuku': {
        // Both flanks of the line, but never ON it: |x| >= 34 keeps every
        // tower (max half-width 12) well clear of the rail corridor, which
        // runs along local x≈0. The old spread (-60 + i*22) parked one
        // skyscraper straight across the tracks.
        const towerXs = [-88, -60, -34, 34, 62, 90]
        for (let i = 0; i < towerXs.length; i++) {
          const h = 90 + Math.random() * 90
          const tower = new THREE.Mesh(
            new THREE.BoxGeometry(14 + Math.random() * 10, h, 14 + Math.random() * 10),
            new THREE.MeshStandardMaterial({ color: 0x3d4658, emissive: 0x223355, emissiveIntensity: 0, metalness: 0.4, roughness: 0.35 }),
          )
          tower.position.set(towerXs[i], h / 2, -60 - (i % 2) * 25)
          tower.castShadow = true
          this.nightGlowMaterials.push(tower.material as THREE.MeshStandardMaterial)
          group.add(tower)
        }
        break
      }
      case 'harajuku': {
        // Grand vermilion torii flanked by pines — the youth stretch's
        // landmark payoff. (Deliberately Inari-red rather than Meiji Jingu's
        // unpainted cypress: this is a generic gate, and the red reads from
        // the cab.) Myōjin style: kasagi with upturned tips + shimaki + nuki.
        // The whole gate ensemble lives beside the line (centered at local
        // x=+24) — a torii straddling a working railway would be nonsense,
        // and its legs used to bracket the rails.
        const TORII_X = 24
        const vermilion = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.65 })
        const kasagi = new THREE.Mesh(new THREE.BoxGeometry(22, 1.5, 1.6), vermilion)
        kasagi.position.set(TORII_X, 13.6, 50)
        for (const end of [-1, 1]) {
          const tip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 1.6), vermilion)
          tip.position.set(TORII_X + end * 11.6, 14.15, 50)
          tip.rotation.z = -end * 0.3
          tip.castShadow = true
          group.add(tip)
        }
        const shimaki = new THREE.Mesh(new THREE.BoxGeometry(19, 1.1, 1.4), vermilion)
        shimaki.position.set(TORII_X, 12.3, 50)
        const nuki = new THREE.Mesh(new THREE.BoxGeometry(17, 0.9, 1.1), vermilion)
        nuki.position.set(TORII_X, 9.2, 50)
        const legGeo = new THREE.CylinderGeometry(0.85, 0.95, 13, 10)
        const legL = new THREE.Mesh(legGeo, vermilion)
        legL.position.set(TORII_X - 7, 6.5, 50)
        const legR = new THREE.Mesh(legGeo, vermilion)
        legR.position.set(TORII_X + 7, 6.5, 50)
        kasagi.castShadow = shimaki.castShadow = legL.castShadow = legR.castShadow = true
        group.add(kasagi, shimaki, nuki, legL, legR)
        const pineTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527 })
        const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 1 })
        for (const [px, pz] of [[11, 46], [36, 54], [13, 57], [38, 44]]) {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 3.4, 6), pineTrunkMat)
          trunk.position.set(px, 1.7, pz)
          const foliage = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6.4, 8), pineMat)
          foliage.position.set(px, 6.4, pz)
          trunk.castShadow = foliage.castShadow = true
          group.add(trunk, foliage)
        }
        // Takeshita-dori color, flanking the approach — never centered on
        // x=0, where the rails run.
        const shopXs = [-60, -38, -18, 20, 42]
        for (let i = 0; i < shopXs.length; i++) {
          const shopH = 8 + Math.random() * 6
          const shop = new THREE.Mesh(
            new THREE.BoxGeometry(8, shopH, 8),
            new THREE.MeshStandardMaterial({ color: [0xff5da2, 0xffc857, 0x5ad1e0, 0x8fce6a][i % 4], emissive: 0x111111, emissiveIntensity: 0 }),
          )
          shop.position.set(shopXs[i], shopH / 2, -55)
          this.nightGlowMaterials.push(shop.material as THREE.MeshStandardMaterial)
          group.add(shop)
        }
        break
      }
      case 'shibuya': {
        const screenGeo = new THREE.PlaneGeometry(20, 12)
        const screenMat = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 } },
          vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
          fragmentShader: `
            varying vec2 vUv; uniform float uTime;
            void main(){
              vec3 c = 0.5 + 0.5*cos(uTime + vUv.xyx*6.0 + vec3(0.0,2.0,4.0));
              gl_FragColor = vec4(c, 1.0);
            }`,
        })
        this.videoScreenMaterials.push(screenMat)
        const screen = new THREE.Mesh(screenGeo, screenMat)
        screen.position.set(-30, 14, -20)
        screen.rotation.y = Math.PI * 0.15
        group.add(screen)
        break
      }
      case 'shinagawa': {
        const bay = new THREE.Mesh(
          new THREE.PlaneGeometry(200, 200),
          new THREE.MeshStandardMaterial({ color: 0x1f5a78, roughness: 0.2, metalness: 0.3 }),
        )
        bay.rotation.x = -Math.PI / 2
        // Water surface stays just above the ground plane despite the
        // wrapper's -0.58 burial offset.
        bay.position.set(90, 0.18, 0)
        group.add(bay)
        break
      }
    }
  }

  private buildPassengers() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 })
    const geo = new THREE.CapsuleGeometry(0.22, 1.0, 4, 8)
    const total = N * PASSENGERS_PER_STATION
    this.passengerMesh = new THREE.InstancedMesh(geo, bodyMat, total)
    this.passengerMesh.castShadow = true
    this.passengerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3)

    // Matching head per passenger — same slot transforms, so both meshes
    // stay in sync through the density-based show/hide scaling.
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })
    this.passengerHeadMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), headMat, total)
    this.passengerHeadMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3)

    const tempObj = new THREE.Object3D()
    const tint = new THREE.Color()
    const bodyTints = [0x2b2b2b, 0x3a3f4a, 0x555049, 0x2d4a4a, 0x4a2d2d, 0x40382e]
    const skinTints = [0xf0c8a8, 0xe8bc9a, 0xd8a888, 0xc89878]

    for (let s = 0; s < N; s++) {
      const station = STATIONS[s]
      // Same convention as the platforms: local +X = driver's left.
      const side = station.doorSide === 'left' ? 1 : -1
      const marker = this.track.markerFor(s)
      const point = this.track.pointAt(marker.tFraction)
      const tangent = this.track.tangentAt(marker.tFraction)
      tempObj.position.copy(point)
      tempObj.lookAt(point.clone().add(tangent))
      tempObj.updateMatrixWorld(true)

      for (let p = 0; p < PASSENGERS_PER_STATION; p++) {
        const idx = s * PASSENGERS_PER_STATION + p
        const local = new THREE.Vector3(
          side * (PLATFORM_INNER + 1 + Math.random() * (PLATFORM_DEPTH - 2)),
          PLATFORM_TOP + 0.72,
          -30 + Math.random() * 60,
        )
        const worldPos = local.applyMatrix4(tempObj.matrixWorld)
        const yaw = Math.random() * Math.PI * 2
        const q = tempObj.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw))

        this.passengerSlots.push({ basePosition: worldPos, baseQuaternion: q, phase: Math.random() * Math.PI * 2, visibilityRoll: Math.random() })
        tint.setHex(bodyTints[Math.floor(Math.random() * bodyTints.length)])
        this.passengerMesh.setColorAt(idx, tint)
        tint.setHex(skinTints[Math.floor(Math.random() * skinTints.length)])
        this.passengerHeadMesh.setColorAt(idx, tint)
      }
    }
    if (this.passengerMesh.instanceColor) this.passengerMesh.instanceColor.needsUpdate = true
    if (this.passengerHeadMesh.instanceColor) this.passengerHeadMesh.instanceColor.needsUpdate = true
    this.scene.add(this.passengerMesh, this.passengerHeadMesh)
    this.updatePassengers(0.5)
  }

  private updatePassengers(density: number) {
    const dummy = new THREE.Object3D()
    for (let i = 0; i < this.passengerSlots.length; i++) {
      const slot = this.passengerSlots[i]
      const visible = slot.visibilityRoll < density
      dummy.position.copy(slot.basePosition)
      dummy.quaternion.copy(slot.baseQuaternion)
      dummy.rotateY(Math.sin(this.time * 0.6 + slot.phase) * 0.12)
      dummy.scale.setScalar(visible ? 1 : 0)
      dummy.updateMatrix()
      this.passengerMesh.setMatrixAt(i, dummy.matrix)
      dummy.position.y += 0.78
      dummy.updateMatrix()
      this.passengerHeadMesh.setMatrixAt(i, dummy.matrix)
    }
    this.passengerMesh.instanceMatrix.needsUpdate = true
    this.passengerHeadMesh.instanceMatrix.needsUpdate = true
  }

  update(dt: number, nightFactor: number, targetStationIndex: number, timeOfDay: number) {
    this.time += dt
    // Passengers' sway is a slow ~10s-period bob — throttling the (relatively
    // expensive, 360-instance) matrix rebuild + GPU upload to ~12Hz instead
    // of every rendered frame is visually indistinguishable but a fraction
    // of the cost, especially on high-refresh-rate displays.
    this.passengerUpdateAccum += dt
    if (this.passengerUpdateAccum >= PASSENGER_UPDATE_INTERVAL) {
      this.passengerUpdateAccum = 0
      this.updatePassengers(crowdDensityForHour(timeOfDay))
    }
    // Building windows switch on per-window via the progressive shader
    // (WINDOW_DUSK_UNIFORM, driven by Game) — no per-material fade here.
    for (const mat of this.videoScreenMaterials) {
      mat.uniforms.uTime.value = this.time
    }
    for (const mat of this.lampMaterials) {
      mat.emissiveIntensity = nightFactor * 1.6
    }
    // Vending machines hum with light around the clock, brighter after dark.
    this.vendingMat.emissiveIntensity = 0.15 + nightFactor * 0.75
    // Paper lanterns warm up with the night; LED strips stay coolly lit.
    this.lanternMat.emissiveIntensity = nightFactor * 1.8
    this.ledStripMat.emissiveIntensity = 0.1 + nightFactor * 1.4
    for (const mat of this.nightGlowMaterials) {
      mat.emissiveIntensity = nightFactor * 0.9
    }
    const baseSignGlow = THREE.MathUtils.lerp(0.05, 1.1, nightFactor)
    const pulse = (Math.sin(this.time * 4) * 0.5 + 0.5) * 0.7
    for (const entry of this.signEntries) {
      entry.material.emissiveIntensity = entry.index === targetStationIndex ? baseSignGlow + pulse : baseSignGlow
    }
  }
}
