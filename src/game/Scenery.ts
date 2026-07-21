import * as THREE from 'three'
import type { Track } from './Track'
import type { DayNightCycle } from './DayNightCycle'
import { STATIONS } from '../data/stations'
import { makeCloudTexture, makeNeonSignTexture, makeWindowGridTexture } from './signage'

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

// Billboarded cloud quads in one InstancedMesh: the vertex shader re-derives
// each instance's center + scale and re-expands the quad along the camera's
// right/up axes, so all clouds face the cab from anywhere on the loop in a
// single draw call.
const CLOUD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 center = instanceMatrix[3].xyz;
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
  private sakuraClusters: { x: number; z: number }[] = []
  private petalsMesh: THREE.Points | null = null
  private petalSeeds!: Float32Array
  /** True while the twin red lamps are lit (train nearby) — Game reads flips to drive the kan-kan bell. */
  crossingBellActive = false
  crossingBlinkPhase = false

  constructor(scene: THREE.Scene, track: Track) {
    this.scene = scene
    this.track = track
    this.buildHorizonLandmarks()
    this.buildRainbowBridge()
    this.buildSkylineRing()
    this.buildVegetation()
    this.buildSakuraPetals()
    this.buildHouseRows()
    this.buildUtilityPoles()
    this.buildNeonSigns()
    this.buildCrossings()
    this.buildClouds()
  }

  /**
   * Rainbow Bridge off the bay stretch (outward from Takanawa Gateway):
   * two white suspension towers, a deck, and main cables — with the famous
   * soft rainbow illumination after dark. The bay district's own landmark.
   */
  private buildRainbowBridge() {
    const base = this.outwardFrom('takanawa-gateway', 620)
    const g = new THREE.Group()
    g.position.copy(base)
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
    this.scene.add(g)
  }

  /**
   * A light drift of sakura petals around each green-station tree cluster —
   * one Points cloud, positions nudged on the CPU (a few hundred verts, cheap)
   * so the trees get their 1% of life.
   */
  private buildSakuraPetals() {
    const PETALS_PER_CLUSTER = 40
    const total = this.sakuraClusters.length * PETALS_PER_CLUSTER
    if (!total) return
    const positions = new Float32Array(total * 3)
    this.petalSeeds = new Float32Array(total * 4) // cx offset, cz offset, phase, fall speed
    let i = 0
    for (const c of this.sakuraClusters) {
      for (let k = 0; k < PETALS_PER_CLUSTER; k++) {
        const ox = (Math.random() - 0.5) * 26
        const oz = (Math.random() - 0.5) * 26
        positions[i * 3] = c.x + ox
        positions[i * 3 + 1] = 1 + Math.random() * 7
        positions[i * 3 + 2] = c.z + oz
        this.petalSeeds[i * 4] = c.x + ox
        this.petalSeeds[i * 4 + 1] = c.z + oz
        this.petalSeeds[i * 4 + 2] = Math.random() * Math.PI * 2
        this.petalSeeds[i * 4 + 3] = 0.55 + Math.random() * 0.7
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
    this.scene.add(this.petalsMesh)
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
    const tex = makeWindowGridTexture(7, 12, { glass: '#4a5361', facade: '#565d68', litChance: 0.45 })
    this.skylineMat = new THREE.MeshStandardMaterial({
      color: 0x8b93a0,
      map: tex.map,
      emissive: 0xffffff,
      emissiveMap: tex.emissiveMap,
      emissiveIntensity: 0,
      roughness: 0.85,
    })
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
      const t = (outer ? i / outerCount : (i - outerCount) / innerCount) + Math.random() * 0.004
      const p = this.track.pointAt(t)
      dir.set(p.x, 0, p.z).normalize()
      const off = (outer ? 1 : -1) * (260 + Math.random() * (outer ? 950 : 700))
      const x = p.x + dir.x * off + (Math.random() - 0.5) * 200
      const z = p.z + dir.z * off + (Math.random() - 0.5) * 200
      const h = 45 + Math.random() * 130
      const w = 30 + Math.random() * 45
      dummy.position.set(x, h / 2 - 2, z)
      dummy.scale.set(w, h, 30 + Math.random() * 45)
      dummy.rotation.set(0, Math.random() * Math.PI, 0)
      dummy.updateMatrix()
      ring.setMatrixAt(i, dummy.matrix)
      tint.setHSL(0.6, 0.04 + Math.random() * 0.05, 0.55 + Math.random() * 0.2)
      ring.setColorAt(i, tint)
    }
    ring.instanceMatrix.needsUpdate = true
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true
    this.scene.add(ring)
  }

  /** Loop-center-relative outward placement: from a station's track point, step away from the loop center. */
  private outwardFrom(stationId: string, distance: number, y = 0): THREE.Vector3 {
    const idx = STATIONS.findIndex((s) => s.id === stationId)
    const marker = this.track.markerFor(Math.max(0, idx))
    const p = this.track.pointAt(marker.tFraction)
    const out = new THREE.Vector3(p.x, 0, p.z).normalize()
    return new THREE.Vector3(p.x + out.x * distance, y, p.z + out.z * distance)
  }

  private buildHorizonLandmarks() {
    // ——— Mount Fuji, far to the southwest, drawn fog-free like a distant
    // backdrop; its color is retinted every frame to sit against the sky.
    // Kept slim and far away so it reads as a mountain ~100 km out, not a
    // hill beside the tracks.
    this.fujiBodyMat = new THREE.MeshBasicMaterial({ color: 0x5a6b8a, fog: false })
    this.fujiSnowMat = new THREE.MeshBasicMaterial({ color: 0xe8edf5, fog: false })
    const fuji = new THREE.Mesh(new THREE.ConeGeometry(1550, 760, 48, 1, true), this.fujiBodyMat)
    const fujiPos = new THREE.Vector3(-3650, 310, 2600)
    fuji.position.copy(fujiPos)
    this.scene.add(fuji)
    const snow = new THREE.Mesh(new THREE.ConeGeometry(1550 * 0.34, 760 * 0.34, 48, 1, false), this.fujiSnowMat)
    snow.position.set(fujiPos.x, fujiPos.y + 760 * 0.33, fujiPos.z)
    this.scene.add(snow)

    // ——— Tokyo Tower near Hamamatsucho: red/white banded lattice silhouette.
    // NEGATIVE outward distance = inland, INSIDE the loop — the real tower
    // stands west of Hamamatsucho, not on the bay side (thanks, Haruto).
    // Landmark materials ignore fog — real towers pierce the haze and stay
    // visible as icons; update() fakes atmospheric fading by day instead.
    this.towerGlowMat = new THREE.MeshStandardMaterial({ color: 0xd8442a, emissive: 0xff5514, emissiveIntensity: 0, roughness: 0.6, fog: false })
    const towerBase = this.outwardFrom('hamamatsucho', -420)
    const tower = new THREE.Group()
    tower.position.copy(towerBase)
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
    this.scene.add(tower)

    // ——— Tokyo Skytree beyond the northeast rim: slender lattice spire, cool white at night.
    this.skytreeMat = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, roughness: 0.45, metalness: 0.3, fog: false })
    this.skytreeGlowMat = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, emissive: 0x9fd8ff, emissiveIntensity: 0, roughness: 0.45, fog: false })
    // Biased toward -z (game east): the real Skytree sits ESE of Nippori,
    // across the Sumida river, not due north.
    const skytreeBase = this.outwardFrom('nippori', 950).add(new THREE.Vector3(-300, 0, -700))
    const skytree = new THREE.Group()
    skytree.position.copy(skytreeBase)
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
    this.scene.add(skytree)
  }

  private buildVegetation() {
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()

    // ——— Sakura: clustered near green-district stations, plus a light
    // sprinkle elsewhere. One instanced trunk + three jittered canopy puffs.
    const greenStations = STATIONS.map((s, i) => ({ s, i })).filter(({ s }) => s.theme.district === 'green')
    const sakuraPerStation = 14
    const sakuraCount = greenStations.length * sakuraPerStation
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.95 })
    const sakuraTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.42, 3.2, 6), trunkMat, sakuraCount)
    const blossomMat = new THREE.MeshStandardMaterial({ color: 0xf5c9dc, roughness: 0.9 })
    const sakuraCanopies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), blossomMat, sakuraCount * 3)
    sakuraCanopies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sakuraCount * 3 * 3), 3)
    sakuraTrunks.castShadow = sakuraCanopies.castShadow = true

    let ti = 0
    let ci = 0
    for (const { i } of greenStations) {
      const marker = this.track.markerFor(i)
      let sumX = 0
      let sumZ = 0
      for (let k = 0; k < sakuraPerStation; k++) {
        // Spread along the approach to the station, on the side opposite the platform.
        const t = marker.tFraction + (Math.random() - 0.35) * 0.012
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = STATIONS[i].doorSide === 'left' ? 1 : -1
        const off = 17 + Math.random() * 24
        const pos = p.clone().addScaledVector(normal, side * off)
        const scale = 0.8 + Math.random() * 0.7
        sumX += pos.x
        sumZ += pos.z

        dummy.position.set(pos.x, 1.6 * scale, pos.z)
        dummy.scale.setScalar(scale)
        dummy.rotation.set(0, Math.random() * Math.PI, 0)
        dummy.updateMatrix()
        sakuraTrunks.setMatrixAt(ti++, dummy.matrix)

        for (let b = 0; b < 3; b++) {
          const br = (2.0 + Math.random() * 1.2) * scale
          dummy.position.set(
            pos.x + (Math.random() - 0.5) * 2.4 * scale,
            (3.6 + Math.random() * 1.4) * scale,
            pos.z + (Math.random() - 0.5) * 2.4 * scale,
          )
          dummy.scale.set(br, br * 0.8, br)
          dummy.rotation.set(0, 0, 0)
          dummy.updateMatrix()
          sakuraCanopies.setMatrixAt(ci, dummy.matrix)
          tint.setHSL(0.93 + Math.random() * 0.03, 0.55, 0.82 + Math.random() * 0.08)
          sakuraCanopies.setColorAt(ci, tint)
          ci++
        }
      }
      this.sakuraClusters.push({ x: sumX / sakuraPerStation, z: sumZ / sakuraPerStation })
    }
    sakuraTrunks.count = ti
    sakuraCanopies.count = ci
    sakuraTrunks.instanceMatrix.needsUpdate = true
    sakuraCanopies.instanceMatrix.needsUpdate = true
    if (sakuraCanopies.instanceColor) sakuraCanopies.instanceColor.needsUpdate = true
    this.scene.add(sakuraTrunks, sakuraCanopies)

    // ——— Pines: dark conifers dotted along the whole loop, denser near
    // shitamachi and green stretches — the classic rail-side tree line.
    const pineCount = 160
    const pineTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.32, 2.6, 5), trunkMat, pineCount)
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.95 })
    const pineFoliage = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.4, 7), pineMat, pineCount)
    pineFoliage.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pineCount * 3), 3)
    pineTrunks.castShadow = pineFoliage.castShadow = true
    for (let k = 0; k < pineCount; k++) {
      const t = Math.random()
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const side = Math.random() < 0.5 ? 1 : -1
      const off = 14 + Math.random() * 55
      const pos = p.clone().addScaledVector(normal, side * off)
      const scale = 0.7 + Math.random() * 0.9

      dummy.position.set(pos.x, 1.3 * scale, pos.z)
      dummy.scale.setScalar(scale)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      pineTrunks.setMatrixAt(k, dummy.matrix)

      dummy.position.set(pos.x, (2.6 + 2.2) * scale, pos.z)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      pineFoliage.setMatrixAt(k, dummy.matrix)
      tint.setHSL(0.32 + Math.random() * 0.05, 0.32, 0.2 + Math.random() * 0.1)
      pineFoliage.setColorAt(k, tint)
    }
    pineTrunks.instanceMatrix.needsUpdate = true
    pineFoliage.instanceMatrix.needsUpdate = true
    if (pineFoliage.instanceColor) pineFoliage.instanceColor.needsUpdate = true
    this.scene.add(pineTrunks, pineFoliage)
  }

  /**
   * Low shitamachi-style houses filling the near band between the track and
   * the big background buildings: box walls + pitched prism roofs, with a
   * small warm window texture that lights up at night.
   */
  private buildHouseRows() {
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()
    const houseCount = 320

    // Pitched roof as a triangular prism (unit size, scaled per instance).
    const roofGeo = new THREE.BufferGeometry()
    const hw = 0.62 // slight eave overhang beyond the unit wall
    const verts = new Float32Array([
      // front triangle
      -hw, 0, 0.62, hw, 0, 0.62, 0, 0.5, 0.62,
      // back triangle
      hw, 0, -0.62, -hw, 0, -0.62, 0, 0.5, -0.62,
      // left slope
      -hw, 0, 0.62, 0, 0.5, 0.62, 0, 0.5, -0.62, -hw, 0, 0.62, 0, 0.5, -0.62, -hw, 0, -0.62,
      // right slope
      hw, 0, 0.62, hw, 0, -0.62, 0, 0.5, -0.62, hw, 0, 0.62, 0, 0.5, -0.62, 0, 0.5, 0.62,
    ])
    roofGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    roofGeo.computeVertexNormals()

    const windowTex = (() => {
      // Tiny warm-window texture reused from the building generator via import
      // would drag in bigger grids; a 2x2 warm grid reads right at house scale.
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#9a9186'
      ctx.fillRect(0, 0, 64, 64)
      const em = document.createElement('canvas')
      em.width = em.height = 64
      const emCtx = em.getContext('2d')!
      emCtx.fillStyle = '#000'
      emCtx.fillRect(0, 0, 64, 64)
      for (const [x, y] of [[10, 22], [38, 22]]) {
        ctx.fillStyle = '#3a3f46'
        ctx.fillRect(x, y, 16, 20)
        if (Math.random() < 0.75) {
          emCtx.fillStyle = '#ffdf9e'
          emCtx.fillRect(x, y, 16, 20)
        }
      }
      const map = new THREE.CanvasTexture(canvas)
      map.colorSpace = THREE.SRGBColorSpace
      const emissiveMap = new THREE.CanvasTexture(em)
      emissiveMap.colorSpace = THREE.SRGBColorSpace
      return { map, emissiveMap }
    })()

    this.houseWindowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: windowTex.map,
      emissive: 0xffffff,
      emissiveMap: windowTex.emissiveMap,
      emissiveIntensity: 0,
      roughness: 0.9,
    })
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.houseWindowMat, houseCount)
    walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(houseCount * 3), 3)
    walls.castShadow = walls.receiveShadow = true

    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, houseCount)
    roofs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(houseCount * 3), 3)
    roofs.castShadow = true

    const wallTones = [0xcfc4b0, 0xbfb6a6, 0xd8d2c4, 0xa89c8a, 0xc4b8b0, 0xb0a898]
    const roofTones = [0x3a4453, 0x46424a, 0x54423a, 0x3d4a42, 0x424b58]

    let idx = 0
    for (let s = 0; s < N && idx < houseCount; s++) {
      const station = STATIONS[s]
      // Houses belong to the low-rise districts; business/bay stretches keep their towers.
      if (station.theme.district === 'business' || station.theme.district === 'bay') continue
      const markerA = this.track.markerFor(s).tFraction
      const markerB = this.track.markerFor((s + 1) % N).tFraction
      const span = ((markerB - markerA + 1) % 1) || 0.02
      const here = Math.min(houseCount - idx, 18)
      for (let k = 0; k < here; k++) {
        // Keep clear of the platform zone at the segment's start.
        const t = markerA + span * (0.18 + 0.72 * ((k + 0.5) / here))
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = k % 2 === 0 ? 1 : -1
        const off = 15 + Math.random() * 16
        const pos = p.clone().addScaledVector(normal, side * off)
        const w = 5 + Math.random() * 4
        const h = 3.2 + Math.random() * 2.8
        const d = 5 + Math.random() * 4
        const yaw = Math.atan2(tangent.x, tangent.z) + (Math.random() - 0.5) * 0.3

        dummy.position.set(pos.x, h / 2, pos.z)
        dummy.scale.set(w, h, d)
        dummy.rotation.set(0, yaw, 0)
        dummy.updateMatrix()
        walls.setMatrixAt(idx, dummy.matrix)
        tint.setHex(wallTones[Math.floor(Math.random() * wallTones.length)])
        walls.setColorAt(idx, tint)

        dummy.position.set(pos.x, h, pos.z)
        dummy.scale.set(w, h * 0.55, d)
        dummy.updateMatrix()
        roofs.setMatrixAt(idx, dummy.matrix)
        tint.setHex(roofTones[Math.floor(Math.random() * roofTones.length)])
        roofs.setColorAt(idx, tint)
        idx++
      }
    }
    walls.count = roofs.count = idx
    walls.instanceMatrix.needsUpdate = true
    roofs.instanceMatrix.needsUpdate = true
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true
    if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true
    this.scene.add(walls, roofs)
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
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, poleH, 6), poleMat, count)
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.09, 0.09), poleMat, count * 2)
    poles.castShadow = true

    const dummy = new THREE.Object3D()
    const tops: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      const t = i / count
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const base = p.clone().addScaledVector(normal, offset)
      dummy.position.set(base.x, base.y + poleH / 2, base.z)
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
    this.scene.add(poles, arms)

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
    this.scene.add(wires)
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

    const neonDistricts = new Set(['downtown', 'youth', 'business'])
    for (let s = 0; s < N; s++) {
      const station = STATIONS[s]
      if (!neonDistricts.has(station.theme.district)) continue
      const marker = this.track.markerFor(s)
      const signsHere = station.landmark ? 8 : 4
      for (let k = 0; k < signsHere; k++) {
        const design = Math.floor(Math.random() * NEON_SIGNS.length)
        if (counters[design] + 2 > perDesign) continue
        const t = marker.tFraction + (Math.random() - 0.3) * 0.014
        const p = this.track.pointAt(t)
        const tangent = this.track.tangentAt(t)
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        const side = Math.random() < 0.5 ? 1 : -1
        const off = 13 + Math.random() * 24
        const pos = p.clone().addScaledVector(normal, side * off)
        const yaw = Math.atan2(normal.x, normal.z) + (side < 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.5
        const scale = 0.85 + Math.random() * 0.6
        const y = 4.5 + Math.random() * 5
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
      this.scene.add(mesh)
    })
  }

  /**
   * THE level crossing. The real Yamanote famously keeps exactly one —
   * Dai-ni Nakazato, on the Tabata→Komagome stretch; everywhere else the
   * line runs on viaduct or in cutting. Yellow/black striped poles, the
   * Japanese yellow crossbuck, and twin red lamps that alternate-blink (with
   * a kan-kan bell fed by the Game) only while the train approaches.
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

    const idx = STATIONS.findIndex((s) => s.id === 'tabata')
    const markerA = this.track.markerFor(idx).tFraction
    const markerB = this.track.markerFor((idx + 1) % N).tFraction
    const t = markerA + (((markerB - markerA + 1) % 1) || 0.02) * 0.55
    this.crossingT = t
    const p = this.track.pointAt(t)
    const tangent = this.track.tangentAt(t)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()

    for (const side of [1, -1]) {
      const base = p.clone().addScaledVector(normal, side * 6.5)
      const g = new THREE.Group()
      g.position.copy(base)
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
      this.scene.add(g)
    }
  }

  private buildClouds() {
    const tex = makeCloudTexture()
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        tint: { value: new THREE.Color(0xffffff) },
        opacity: { value: 0.85 },
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
    const clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.cloudMat, CLOUD_COUNT)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const angle = (i / CLOUD_COUNT) * Math.PI * 2 + Math.random() * 0.4
      // Kept far out, with width capped relative to distance, so no single
      // transparent quad ever eats a huge slice of mobile fill rate.
      const radius = 1500 + Math.random() * 2400
      const w = Math.min(320 + Math.random() * 480, radius * 0.28)
      dummy.position.set(Math.cos(angle) * radius, 300 + Math.random() * 380, Math.sin(angle) * radius)
      dummy.scale.set(w, w * 0.42, 1)
      dummy.updateMatrix()
      clouds.setMatrixAt(i, dummy.matrix)
    }
    clouds.instanceMatrix.needsUpdate = true
    clouds.frustumCulled = false
    this.scene.add(clouds)
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

    // Fuji sits against the sky: tint toward the horizon color by day, nearly
    // silhouette-black at night, warm at dawn/dusk automatically because the
    // horizon color itself warms.
    this.fujiBodyMat.color.copy(horizon).lerp(FUJI_TINT, 0.62).multiplyScalar(1 - night * 0.55)
    this.fujiSnowMat.color.copy(SNOW_TINT).lerp(horizon, 0.35).multiplyScalar(1 - night * 0.5)

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
    this.houseWindowMat.emissiveIntensity = night * 1.1
    this.skylineMat.emissiveIntensity = night * 1.2

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

    // Sakura petals drift and fall on a gentle sinusoidal breeze.
    if (this.petalsMesh) {
      const attr = this.petalsMesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const n = arr.length / 3
      for (let i = 0; i < n; i++) {
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

    // Clouds: white by day, dusk-tinted, near-invisible dark at night.
    const tint = this.cloudMat.uniforms.tint.value as THREE.Color
    tint.copy(horizon).lerp(WHITE, 0.55).multiplyScalar(1 - night * 0.82)
    this.cloudMat.uniforms.opacity.value = 0.85 - night * 0.55
  }
}

// Fixed palette used by update() every frame — hoisted so the per-frame path
// allocates nothing.
const FUJI_TINT = new THREE.Color(0x3d4a63)
const SNOW_TINT = new THREE.Color(0xeef2f8)
const TOWER_RED = new THREE.Color(0xd8442a)
const SKYTREE_STEEL = new THREE.Color(0xb8c4cc)
const SKYTREE_IKI = new THREE.Color(0x9fd8ff)
const SKYTREE_MIYABI = new THREE.Color(0xc9a0e8)
const WHITE = new THREE.Color(0xffffff)
