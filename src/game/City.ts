import * as THREE from 'three'
import type { Track } from './Track'
import { STATIONS, prevStationIndex, nextStationIndex } from '../data/stations'
import { makeStationSignTexture, makePlatformTileTexture, makeTactilePavingTexture, makeWindowGridTexture } from './signage'

const THEME_GROUPS = ['business', 'downtown', 'shitamachi', 'green', 'youth', 'bay'] as const
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
  private signEntries: SignEntry[] = []
  private passengerMesh!: THREE.InstancedMesh
  private passengerHeadMesh!: THREE.InstancedMesh
  private passengerSlots: PassengerSlot[] = []
  private time = 0

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
    // near-black in daylight.
    const windowStyles: Record<(typeof THEME_GROUPS)[number], ReturnType<typeof makeWindowGridTexture>> = {
      business: makeWindowGridTexture(9, 14, { glass: '#6d7c92', facade: '#9aa4b2', litChance: 0.42, litColors: ['#eef3ff', '#dce8ff', '#fff6da'] }),
      downtown: makeWindowGridTexture(6, 10, { glass: '#707684', facade: '#a09aa8', litChance: 0.5, litColors: ['#fff6da', '#ffe9b0', '#ffd2f0', '#c8f4ff'] }),
      shitamachi: makeWindowGridTexture(4, 7, { glass: '#7a6f60', facade: '#a89c8c', litChance: 0.55, litColors: ['#ffdf9e', '#ffe9b0', '#fff6da'] }),
      green: makeWindowGridTexture(4, 6, { glass: '#6f7c6c', facade: '#9aa694', litChance: 0.4, litColors: ['#ffe9b0', '#fff6da'] }),
      youth: makeWindowGridTexture(5, 9, { glass: '#7a7090', facade: '#a49cb4', litChance: 0.52, litColors: ['#fff6da', '#ffb8e2', '#a5e8ff', '#ffe9b0'] }),
      bay: makeWindowGridTexture(8, 13, { glass: '#6c7e8e', facade: '#98a8b6', litChance: 0.4, litColors: ['#e2f0ff', '#fff6da', '#d0e6ff'] }),
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
        emissiveIntensity: 0,
      })
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

      const markerA = this.track.markerFor(s).tFraction
      const markerB = this.track.markerFor((s + 1) % N).tFraction
      const span = ((markerB - markerA + 1) % 1) || 0.02
      const buildingsHere = Math.max(2, Math.round((span * trackLen) / 55))

      for (let b = 0; b < buildingsHere; b++) {
        const t = markerA + span * ((b + 0.5) / buildingsHere)
        const point = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = b % 2 === 0 ? 1 : -1
        const offset = 34 + Math.random() * 70
        const height = 14 + Math.random() * (station.landmark ? 70 : 34)
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

    const platformMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.9, map: makePlatformTileTexture() })
    ;(platformMat.map as THREE.Texture).repeat.set(3, 22)
    const platformSlab = new THREE.InstancedMesh(new THREE.BoxGeometry(PLATFORM_DEPTH, 1.2, PLATFORM_LEN), platformMat, N)
    platformSlab.receiveShadow = true

    const safetyMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0, roughness: 0.6 })
    const safetyStrip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.08, PLATFORM_LEN - 2), safetyMat, N)

    const tactileMat = new THREE.MeshStandardMaterial({ map: makeTactilePavingTexture(), roughness: 0.85 })
    const tactileStrip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, PLATFORM_LEN - 2), tactileMat, N)

    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2b3040, roughness: 0.55, metalness: 0.25 })
    const roof = new THREE.InstancedMesh(new THREE.BoxGeometry(ROOF_WIDTH, ROOF_THICK, PLATFORM_LEN + 2), roofMat, N)
    roof.castShadow = true

    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x1c2028, roughness: 0.5, metalness: 0.3 })
    const fascia = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.5, PLATFORM_LEN + 2), fasciaMat, N)

    const columnMat = new THREE.MeshStandardMaterial({ color: 0x4c5a4a, metalness: 0.35, roughness: 0.55 })
    const columns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, COLUMN_HEIGHT, 0.42), columnMat, N * COLUMN_ZS.length)
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

    const benchMat = new THREE.MeshStandardMaterial({ color: 0x2f6b46, roughness: 0.7 })
    const bench = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.9, 2.4), benchMat, N)
    const vendingMat = new THREE.MeshStandardMaterial({ color: 0xd7dde3, emissive: 0x6fb8ff, emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.2 })
    const vending = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.9, 1.3), vendingMat, N)
    this.vendingMat = vendingMat
    const clockPoleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.4 })
    const clockPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), clockPoleMat, N)
    const clockFaceMat = new THREE.MeshStandardMaterial({ color: 0xf5f3ec, emissive: 0x111111, roughness: 0.5 })
    const clockFace = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 20), clockFaceMat, N)
    const mapBoardMat = new THREE.MeshStandardMaterial({ color: 0xeceadf, roughness: 0.7 })
    const mapBoard = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.1, 1.6), mapBoardMat, N)

    const instancedPools: THREE.InstancedMesh[] = [
      platformSlab, safetyStrip, tactileStrip, roof, fascia, columns, columnBands, struts,
      lampBody, lampHousing, signFrame, signRods, bench, vending, clockPole, clockFace, mapBoard,
    ]

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

    for (let s = 0; s < N; s++) {
      const station = STATIONS[s]
      const marker = this.track.markerFor(s)
      const point = this.track.pointAt(marker.tFraction)
      const tangent = this.track.tangentAt(marker.tFraction)

      const group = new THREE.Group()
      group.position.copy(point)
      group.lookAt(point.clone().add(tangent))
      group.updateMatrixWorld(true)
      this.scene.add(group)

      // side = +1 puts the platform on local +X, -1 on local -X — matching
      // the station's announced door side so the visuals agree with the PA.
      const side = station.doorSide === 'left' ? -1 : 1
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
        code: `JY${String(s + 1).padStart(2, '0')}`,
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
      this.scene.add(mesh)
    }
    this.lampMaterials.push(lampMat)
  }

  private addLandmarkProps(id: string, group: THREE.Group, accent: number) {
    switch (id) {
      case 'tokyo': {
        const facade = new THREE.Mesh(
          new THREE.BoxGeometry(46, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.8 }),
        )
        facade.position.set(0, 8, -55)
        group.add(facade)
        for (const dx of [-18, 0, 18]) {
          const dome = new THREE.Mesh(
            new THREE.SphereGeometry(4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x4a2a20 }),
          )
          dome.position.set(dx, 16, -55)
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
        for (let i = 0; i < 6; i++) {
          const h = 90 + Math.random() * 90
          const tower = new THREE.Mesh(
            new THREE.BoxGeometry(14 + Math.random() * 10, h, 14 + Math.random() * 10),
            new THREE.MeshStandardMaterial({ color: 0x3d4658, emissive: 0x223355, emissiveIntensity: 0, metalness: 0.4, roughness: 0.35 }),
          )
          tower.position.set(-60 + i * 22, h / 2, -60 - (i % 2) * 20)
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
        const vermilion = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.65 })
        const kasagi = new THREE.Mesh(new THREE.BoxGeometry(22, 1.5, 1.6), vermilion)
        kasagi.position.set(0, 13.6, 50)
        for (const end of [-1, 1]) {
          const tip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 1.6), vermilion)
          tip.position.set(end * 11.6, 14.15, 50)
          tip.rotation.z = -end * 0.3
          tip.castShadow = true
          group.add(tip)
        }
        const shimaki = new THREE.Mesh(new THREE.BoxGeometry(19, 1.1, 1.4), vermilion)
        shimaki.position.set(0, 12.3, 50)
        const nuki = new THREE.Mesh(new THREE.BoxGeometry(17, 0.9, 1.1), vermilion)
        nuki.position.set(0, 9.2, 50)
        const legGeo = new THREE.CylinderGeometry(0.85, 0.95, 13, 10)
        const legL = new THREE.Mesh(legGeo, vermilion)
        legL.position.set(-7, 6.5, 50)
        const legR = new THREE.Mesh(legGeo, vermilion)
        legR.position.set(7, 6.5, 50)
        kasagi.castShadow = shimaki.castShadow = legL.castShadow = legR.castShadow = true
        group.add(kasagi, shimaki, nuki, legL, legR)
        const pineTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527 })
        const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 1 })
        for (const [px, pz] of [[-13, 46], [12, 54], [-11, 57], [14, 44]]) {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 3.4, 6), pineTrunkMat)
          trunk.position.set(px, 1.7, pz)
          const foliage = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6.4, 8), pineMat)
          foliage.position.set(px, 6.4, pz)
          trunk.castShadow = foliage.castShadow = true
          group.add(trunk, foliage)
        }
        for (let i = 0; i < 5; i++) {
          const shop = new THREE.Mesh(
            new THREE.BoxGeometry(8, 8 + Math.random() * 6, 8),
            new THREE.MeshStandardMaterial({ color: [0xff5da2, 0xffc857, 0x5ad1e0, 0x8fce6a][i % 4], emissive: 0x111111, emissiveIntensity: 0 }),
          )
          shop.position.set(-40 + i * 20, 5, -55)
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
        bay.position.set(90, -0.4, 0)
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
      const side = station.doorSide === 'left' ? -1 : 1
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
    for (const group of this.themeGroups.values()) {
      group.material.emissiveIntensity = nightFactor * 1.3
    }
    for (const mat of this.videoScreenMaterials) {
      mat.uniforms.uTime.value = this.time
    }
    for (const mat of this.lampMaterials) {
      mat.emissiveIntensity = nightFactor * 1.6
    }
    // Vending machines hum with light around the clock, brighter after dark.
    this.vendingMat.emissiveIntensity = 0.15 + nightFactor * 0.75
    for (const mat of this.nightGlowMaterials) {
      mat.emissiveIntensity = nightFactor * 0.9
    }
    const baseSignGlow = THREE.MathUtils.lerp(0.05, 1.1, nightFactor)
    const pulse = (Math.sin(this.time * 4) * 0.5 + 0.5) * 0.7
    for (const entry of this.signEntries) {
      entry.material.emissiveIntensity = entry.index === targetStationIndex ? baseSignGlow + pulse : baseSignGlow
    }
    this.updatePassengers(crowdDensityForHour(timeOfDay))
  }
}
