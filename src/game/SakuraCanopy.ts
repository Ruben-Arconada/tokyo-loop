import * as THREE from 'three'
import type { Season } from './Seasons'
import { mulberry32, Rng } from './Rng'
import { tagGroup } from './worldHash'

// ————————————————————————————————————————————————————————————————
// Billboard-cloud sakura canopies (Rubén: the sphere blobs "se ven bastante
// feas sobre todo en las uniones"). Each crown is ~11 camera-facing cards
// with a baked blossom-clump sprite — the classic leaf-card technique — so
// the silhouette is all fluff and individual flowers instead of smooth
// intersecting spheres. Every card of every tree on the ring rides ONE
// InstancedBufferGeometry (1 draw call), billboarded in the vertex shader
// from viewMatrix rows (NOT cameraPosition — see the Passengers lesson).
//
// Seasons change the card's SHAPE as well as its tint: the atlas has one
// row per season (bloom / dense leaf / sparse amber / bare twigs) and
// setSeason rewrites one instanced attribute. Tints stay in the existing
// Seasons pool machinery — the pools now point at this cloud's color
// attribute instead of the old spheres'.
// ————————————————————————————————————————————————————————————————

const COLS = 4 // variant columns
const ROWS = 8 // sakura seasons on rows 0-3, broadleaf seasons on rows 4-7
const CELL = 128
const ATLAS_W = COLS * CELL
const ATLAS_H = ROWS * CELL

const SEASON_ROW: Record<Season, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 }

export type CanopyFamily = 'sakura' | 'broadleaf'
const FAMILY_ROW_BASE: Record<CanopyFamily, number> = { sakura: 0, broadleaf: 4 }

// The sphere era multiplied every instance tint by the material's own pink
// (0xf5c9dc); the cards' atlas is near-white, so that factor lives in the
// tint now — without it the crowns read white, not sakura.
const BLOSSOM_BASE = new THREE.Color(0xf5c9dc)

// One stream for the whole canopy system: where the cards and the fallen
// petals sit in the world. The atlas below is artwork, not world layout, so
// it keeps a FIXED seed — the sprites must look the same in every world.
const canopyRng = new Rng('canopy')

/**
 * The clump sprites are painted near-white with value jitter; the instance
 * tint (driven by the seasonal pools) carries all the hue. Alpha is a hard
 * cutout — alphaTest rendering never blends, so the canvas premultiply
 * round-trip that once grained the iOS clouds cannot bite here.
 */
function bakeClumpAtlas(): THREE.CanvasTexture {
  const cnv = document.createElement('canvas')
  cnv.width = ATLAS_W
  cnv.height = ATLAS_H
  const ctx = cnv.getContext('2d')!
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H)

  const rand = mulberry32(0x5a4b)
  /** Irregular blob membership test: union of 3 ellipses per cell, drawn fresh per cell so no two variants share a silhouette. */
  const blobTest = () => {
    const lobes: { cx: number; cy: number; rx: number; ry: number }[] = []
    const n = 3
    for (let i = 0; i < n; i++) {
      lobes.push({
        cx: 0.5 + (rand() - 0.5) * 0.3,
        cy: 0.48 + (rand() - 0.5) * 0.24,
        rx: 0.24 + rand() * 0.14,
        ry: 0.2 + rand() * 0.12,
      })
    }
    return (u: number, v: number) => lobes.some((l) => ((u - l.cx) / l.rx) ** 2 + ((v - l.cy) / l.ry) ** 2 < 1)
  }

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * CELL
      const y0 = row * CELL
      const inBlob = blobTest()
      const dot = (u: number, v: number, r: number, value: number, squish = 1) => {
        // Lower-half dots sit in the crown's own shade: cheap volume.
        const shade = value * (0.82 + 0.18 * (1 - v))
        const c = Math.round(255 * Math.min(1, shade))
        ctx.fillStyle = `rgb(${c},${Math.round(c * 0.97)},${Math.round(c * 0.94)})`
        ctx.beginPath()
        ctx.ellipse(x0 + u * CELL, y0 + v * CELL, r, r * squish, rand() * Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
      // Rows 0-3: sakura. Rows 4-7: broadleaf — same seasons, its own build.
      const season = row % 4
      const broadleaf = row >= 4

      if (broadleaf) {
        if (season === 3) {
          // Bare broadleaf: a slightly denser skeleton than the cherry's.
          twigs(ctx, x0, y0, rand, 7, 0.92)
        } else {
          // Round overlapping leaf masses — lumpy and full, nothing like
          // the cherry's posies. Autumn keeps the FULL mass (koyo is dense;
          // the tint does the burning).
          const n = season === 1 ? 48 : 40
          for (let i = 0; i < n; i++) {
            const u = rand()
            const v = rand()
            if (!inBlob(u, v)) continue
            dot(u, v, 5.5 + rand() * 3.6, 0.7 + rand() * 0.3)
          }
        }
      } else if (season === SEASON_ROW.spring) {
        // Bloom: cauliflower of small 5-petal posies; edge posies stay
        // distinct so the rim reads as flowers, not fuzz.
        for (let i = 0; i < 30; i++) {
          const u = rand()
          const v = rand()
          if (!inBlob(u, v)) continue
          const value = 0.8 + rand() * 0.2
          const pr = (5.5 + rand() * 3.5) / CELL
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2 + rand() * 0.6
            dot(u + Math.cos(a) * pr * 0.7, v + Math.sin(a) * pr * 0.7, pr * 0.55 * CELL, value)
          }
          dot(u, v, pr * 0.5 * CELL, Math.min(1, value + 0.08))
        }
      } else if (season === SEASON_ROW.summer) {
        // Dense leaf: pointed little ellipses, tighter packing.
        for (let i = 0; i < 46; i++) {
          const u = rand()
          const v = rand()
          if (!inBlob(u, v)) continue
          dot(u, v, 4.5 + rand() * 3, 0.72 + rand() * 0.28, 0.6)
        }
      } else if (season === SEASON_ROW.autumn) {
        // Sparse amber: fewer, smaller clumps with daylight between them,
        // and a few twig strokes showing through the gaps.
        twigs(ctx, x0, y0, rand, 3, 0.62)
        for (let i = 0; i < 15; i++) {
          const u = rand()
          const v = rand()
          if (!inBlob(u, v)) continue
          dot(u, v, 4 + rand() * 2.6, 0.68 + rand() * 0.3, 0.75)
        }
      } else {
        // Winter: bare twig tracery only — the pool tint turns it dark.
        twigs(ctx, x0, y0, rand, 6, 0.92)
      }
    }
  }
  const tex = new THREE.CanvasTexture(cnv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

/** A handful of forked branch strokes across a cell — winter's whole outfit, autumn's underlay. */
function twigs(ctx: CanvasRenderingContext2D, x0: number, y0: number, rand: () => number, count: number, value: number) {
  const c = Math.round(255 * value)
  ctx.strokeStyle = `rgb(${c},${Math.round(c * 0.95)},${Math.round(c * 0.9)})`
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i++) {
    let bx = x0 + CELL * (0.5 + (rand() - 0.5) * 0.2)
    let by = y0 + CELL * (0.78 - rand() * 0.1)
    let angle = -Math.PI / 2 + (rand() - 0.5) * 1.1
    let len = CELL * (0.2 + rand() * 0.12)
    let width = 3
    for (let seg = 0; seg < 3; seg++) {
      const ex = bx + Math.cos(angle) * len
      const ey = by + Math.sin(angle) * len
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(ex, ey)
      ctx.stroke()
      // A side shoot at each fork keeps it reading as a crown, not a broom.
      const sa = angle + (rand() < 0.5 ? 1 : -1) * (0.5 + rand() * 0.5)
      ctx.lineWidth = width * 0.6
      ctx.beginPath()
      ctx.moveTo(ex, ey)
      ctx.lineTo(ex + Math.cos(sa) * len * 0.55, ey + Math.sin(sa) * len * 0.55)
      ctx.stroke()
      bx = ex
      by = ey
      angle += (rand() - 0.5) * 0.7
      len *= 0.72
      width *= 0.65
    }
  }
}

/**
 * A sphere whose vertices are pushed in and out by deterministic noise —
 * for the blob geometry that STAYS instanced (scrub bushes): overlapping
 * perfect spheres show their intersection seams, overlapping lumps read
 * as one organic mass (Rubén: "algo de transición entre las uniones").
 */
export function makeLumpySphereGeometry(radius: number, widthSegs: number, heightSegs: number, amount = 0.22): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(radius, widthSegs, heightSegs)
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i)
    // Position-hashed, not index-hashed: the sphere's seam column shares
    // positions between duplicated vertices, and hashing the position keeps
    // those duplicates moving together (no cracks).
    const n = Math.sin(v.x * 7.3 + v.y * 5.1) * Math.cos(v.z * 6.7 - v.y * 3.9)
    v.multiplyScalar(1 + n * amount)
    posAttr.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

// The atlas PRNG is the shared mulberry32 with a FIXED seed, not a world
// stream: the blossom sprites are artwork, identical in every world.

interface PendingCard {
  x: number
  y: number
  z: number
  size: number
  col: number
  phase: number
  r: number
  g: number
  b: number
  /** First atlas row of this card's family (0 sakura, 4 broadleaf). */
  rowBase: number
  /** true = the Komagome grove: bloom row in every season. */
  evergreen: boolean
}

export class SakuraCanopyCloud {
  private pending: PendingCard[] = []
  private rowAttr: THREE.InstancedBufferAttribute | null = null
  private rowBases: Uint8Array | null = null
  private evergreenFlags: Uint8Array | null = null
  /** The seasonal pools recolor THIS attribute (rgb per card). */
  colorAttr: THREE.InstancedBufferAttribute | null = null
  private uniforms = {
    uMap: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uNight: { value: 0 },
  }
  private readonly tint = new THREE.Color()

  /**
   * Registers one tree's cards. Card order is the call order, so cluster
   * ranges stay contiguous for the pool registrations. Each family has its
   * own crown build: the cherry is a tall lush ball of bloom (Rubén: "más
   * grandes y más frondosos, el tronco casi igual"), the broadleaf a
   * rounder, slightly lower head. Broadleaf callers pass their as-built
   * tint (the pool's spring baseline); sakura mixes its own pink.
   */
  addTree(x: number, groundY: number, z: number, scale: number, family: CanopyFamily, evergreen: boolean, tint?: THREE.Color) {
    const sakura = family === 'sakura'
    const cards = sakura ? 15 : 9
    const cores = sakura ? 3 : 2
    const crownY = groundY + (sakura ? 4.3 : 3.3) * scale
    for (let i = 0; i < cards; i++) {
      // Shell placement: big CORE cards fill the heart of the crown
      // (without them the shell read as popcorn with daylight through the
      // middle), the rest hug an ellipsoid, and the last two drop lower as
      // a skirt so the silhouette never reads as an egg.
      const core = i < cores
      const skirt = i >= cards - 2
      const a = canopyRng.random() * Math.PI * 2
      const shell = sakura ? 0.5 + canopyRng.random() * 1.2 : 0.4 + canopyRng.random() * 0.9
      const rXZ = (core ? 0.25 : skirt ? (sakura ? 1.5 : 1.1) : shell) * scale
      const yOff = core
        ? (canopyRng.random() - 0.4) * 0.7 * scale
        : skirt
          ? (sakura ? -1.2 : -0.85) * scale
          : (canopyRng.random() - 0.38) * (sakura ? 2.1 : 1.5) * scale
      if (sakura) this.tint.setHSL(0.93 + canopyRng.random() * 0.03, 0.55, 0.82 + canopyRng.random() * 0.08).multiply(BLOSSOM_BASE)
      else this.tint.copy(tint!)
      this.pending.push({
        x: x + Math.cos(a) * rXZ,
        y: crownY + yOff,
        z: z + Math.sin(a) * rXZ,
        size: (core ? (sakura ? 4.4 : 3.3) : sakura ? 3.2 + canopyRng.random() * 1.7 : 2.5 + canopyRng.random() * 1.2) * scale,
        col: Math.floor(canopyRng.random() * COLS),
        phase: canopyRng.random() * Math.PI * 2,
        r: this.tint.r,
        g: this.tint.g,
        b: this.tint.b,
        rowBase: FAMILY_ROW_BASE[family],
        evergreen,
      })
    }
  }

  get cardCount(): number {
    return this.pending.length
  }

  /** Builds the single instanced mesh from everything addTree collected. */
  finalize(scene: THREE.Scene): void {
    const n = this.pending.length
    if (!n) return
    const geo = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    geo.index = quad.index
    geo.setAttribute('position', quad.getAttribute('position'))
    geo.setAttribute('uv', quad.getAttribute('uv'))
    geo.instanceCount = n

    const pos = new Float32Array(n * 3)
    const data = new Float32Array(n * 3) // size, atlas col, sway phase
    const rows = new Float32Array(n)
    const colors = new Float32Array(n * 3)
    this.evergreenFlags = new Uint8Array(n)
    this.rowBases = new Uint8Array(n)
    this.pending.forEach((c, i) => {
      pos[i * 3] = c.x
      pos[i * 3 + 1] = c.y
      pos[i * 3 + 2] = c.z
      data[i * 3] = c.size
      data[i * 3 + 1] = c.col
      data[i * 3 + 2] = c.phase
      rows[i] = c.rowBase // everyone ships in spring (row 0 of its family)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
      this.rowBases![i] = c.rowBase
      this.evergreenFlags![i] = c.evergreen ? 1 : 0
    })
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3))
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 3))
    this.rowAttr = new THREE.InstancedBufferAttribute(rows, 1)
    geo.setAttribute('aRow', this.rowAttr)
    this.colorAttr = new THREE.InstancedBufferAttribute(colors, 3)
    geo.setAttribute('aTint', this.colorAttr)
    this.pending = []

    this.uniforms.uMap.value = bakeClumpAtlas()
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: /* glsl */ `
        attribute vec3 aPos;
        attribute vec3 aData; // size, atlas col, sway phase
        attribute float aRow;
        attribute vec3 aTint;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vTint;
        #include <fog_pars_vertex>
        void main() {
          float size = aData.x;
          // Full spherical billboard from the viewMatrix rows — the crown
          // must stay a puff from the drone orbit and the CCTV mast too.
          vec3 camRight = vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
          vec3 camUp = vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
          // A whisper of sway, per-card phase — the 1% of life rule.
          float sway = sin(uTime * 0.8 + aData.z) * 0.05 * size;
          vec3 world = aPos
            + camRight * (position.x * size + sway)
            + camUp * (position.y * size * 0.92);
          vUv = vec2((aData.y + uv.x) / ${COLS}.0, (${ROWS}.0 - 1.0 - aRow + uv.y) / ${ROWS}.0);
          vTint = aTint;
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uNight;
        varying vec2 vUv;
        varying vec3 vTint;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(uMap, vUv);
          if (c.a < 0.5) discard;
          // Hand-dimmed at night like the passenger sprites (unlit cards).
          gl_FragColor = vec4(c.rgb * vTint * mix(1.05, 0.34, uNight), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      fog: true,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false // cards span the whole loop
    scene.add(tagGroup(mesh, 'canopy-cards'))
  }

  /** Shape change on season change: one attribute rewrite, no rebuild. The grove (evergreen) blooms in all four. */
  setSeason(season: Season): void {
    if (!this.rowAttr || !this.evergreenFlags || !this.rowBases) return
    const arr = this.rowAttr.array as Float32Array
    const off = SEASON_ROW[season]
    for (let i = 0; i < arr.length; i++) arr[i] = this.rowBases[i] + (this.evergreenFlags[i] ? 0 : off)
    this.rowAttr.needsUpdate = true
  }

  /** Per-frame: sway clock + night dimmer (call from Scenery.update). */
  tick(time: number, night: number): void {
    this.uniforms.uTime.value = time
    this.uniforms.uNight.value = night
  }
}

// ————————————————————————————————————————————————————————————————
// The fallen-petal carpet: flat cutout discs speckled with petals, laid
// around each cluster's trees. The Komagome grove keeps its carpet all
// year (the garden sheds forever); everyone else only in spring — the
// same y = -120 parking trick the drifting petals use.
// ————————————————————————————————————————————————————————————————

function bakePetalGroundTexture(): THREE.CanvasTexture {
  const cnv = document.createElement('canvas')
  cnv.width = cnv.height = 128
  const ctx = cnv.getContext('2d')!
  ctx.clearRect(0, 0, 128, 128)
  const rand = mulberry32(0xbeb1)
  // Density thins toward the rim so the disc has no visible edge.
  for (let i = 0; i < 420; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 62
    if (rand() < (r / 62) ** 2 * 0.85) continue
    const x = 64 + Math.cos(a) * r
    const y = 64 + Math.sin(a) * r
    const v = 0.86 + rand() * 0.14
    const c = Math.round(255 * v)
    ctx.fillStyle = `rgb(${c},${Math.round(c * 0.93)},${Math.round(c * 0.95)})`
    ctx.beginPath()
    ctx.ellipse(x, y, 1.6 + rand() * 1.6, 1 + rand() * 1.1, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(cnv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export interface CarpetSpot {
  x: number
  y: number
  z: number
  radius: number
  evergreen: boolean
}

export class PetalCarpet {
  private mesh: THREE.InstancedMesh | null = null
  private baseY: Float32Array | null = null
  private evergreenFlags: Uint8Array | null = null
  private readonly dummy = new THREE.Object3D()

  build(scene: THREE.Scene, spots: CarpetSpot[]): void {
    if (!spots.length) return
    const mat = new THREE.MeshLambertMaterial({
      map: bakePetalGroundTexture(),
      alphaTest: 0.35,
      transparent: false,
      color: 0xffb9d4,
      // Hovering 6 cm over ground that itself undulates: bias the depth so
      // the carpet always wins against its own floor, never against feet.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10), mat, spots.length)
    this.baseY = new Float32Array(spots.length)
    this.evergreenFlags = new Uint8Array(spots.length)
    spots.forEach((s, i) => {
      this.dummy.position.set(s.x, s.y + 0.06, s.z)
      this.dummy.rotation.set(-Math.PI / 2, 0, canopyRng.random() * Math.PI * 2)
      this.dummy.scale.setScalar(s.radius)
      this.dummy.updateMatrix()
      this.mesh!.setMatrixAt(i, this.dummy.matrix)
      this.baseY![i] = s.y + 0.06
      this.evergreenFlags![i] = s.evergreen ? 1 : 0
    })
    this.mesh.receiveShadow = true
    this.mesh.instanceMatrix.needsUpdate = true
    scene.add(tagGroup(this.mesh, 'petal-carpet'))
  }

  setSeason(season: Season): void {
    if (!this.mesh || !this.baseY || !this.evergreenFlags) return
    const spring = season === 'spring'
    for (let i = 0; i < this.baseY.length; i++) {
      this.mesh.getMatrixAt(i, this.dummy.matrix)
      this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale)
      this.dummy.position.y = spring || this.evergreenFlags[i] ? this.baseY[i] : -120
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
