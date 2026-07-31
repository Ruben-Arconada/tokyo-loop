import * as THREE from 'three'
import { mulberry32 } from './Rng'

// Everything in this file bakes ARTWORK — grime, window grids, tile noise —
// so it runs on a fixed seed rather than a world stream: the textures should
// look the same in every world, and identical between two loads so screenshot
// comparisons mean something. One shared sequence for the module keeps the
// old behaviour exactly (two calls to the same maker still differ, which is
// what gives the ground plane and the embankment their own grain).
const rnd = mulberry32(0x51_6e_a6)

/** Worn metal/plastic panel texture for the cab console and pillars. */
export function makeScuffedPanelTexture(base = '#1c1f26'): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 500; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = 2 + rnd() * 10
    const angle = rnd() * Math.PI * 2
    const shade = rnd() < 0.5 ? 255 : 0
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${(0.08 + rnd() * 0.12).toFixed(3)})`
    ctx.lineWidth = 0.6 + rnd()
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Japan Loop's signature green. A nod to the warbler-green tradition of
 * Tokyo's loop line — color alone is not protectable, and this is our own
 * palette pick, used consistently across signage, HUD and branding.
 */
export const LOOP_LINE_COLOR = 0x8fc31f

export interface StationSignOptions {
  nameEn: string
  nameJa: string
  nameKana: string
  /** e.g. "TL01" */
  code: string
  prevNameEn: string
  nextNameEn: string
}

function drawTracked(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, trackingPx: number) {
  const chars = [...text]
  const widths = chars.map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + trackingPx * (chars.length - 1)
  let x = cx - total / 2
  const prevAlign = ctx.textAlign
  ctx.textAlign = 'left'
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y)
    x += widths[i] + trackingPx
  }
  ctx.textAlign = prevAlign
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Draws a stylized JR-style station sign (kanban) — original artwork, not a reproduction of real JR signage files. */
export function makeStationSignTexture(opts: StationSignOptions): THREE.CanvasTexture {
  const W = 1024
  const H = 384
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const lineHex = '#' + LOOP_LINE_COLOR.toString(16).padStart(6, '0')

  ctx.fillStyle = '#f5f3ec'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = lineHex
  ctx.fillRect(0, 0, W, 44)
  ctx.fillRect(0, H - 56, W, 56)

  const badgeX = 28
  const badgeY = 58
  const badgeW = 152
  const badgeH = 152
  ctx.fillStyle = lineHex
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 20)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '700 30px Arial, sans-serif'
  ctx.fillText(opts.code.replace(/[0-9]/g, ''), badgeX + badgeW / 2, badgeY + 46)
  ctx.font = '800 78px Arial, sans-serif'
  ctx.fillText(opts.code.replace(/\D/g, ''), badgeX + badgeW / 2, badgeY + 132)

  const textCenterX = badgeX + badgeW + (W - (badgeX + badgeW)) / 2

  ctx.fillStyle = '#4a4a4a'
  ctx.font = '500 28px "Hiragino Sans", "Noto Sans JP", sans-serif'
  ctx.fillText(opts.nameKana, textCenterX, 84)

  ctx.fillStyle = '#161616'
  ctx.font = '700 98px "Hiragino Sans", "Noto Sans JP", sans-serif'
  ctx.fillText(opts.nameJa, textCenterX, 192)

  ctx.fillStyle = '#333333'
  ctx.font = '600 42px "Frutiger LT Std", "Myriad Pro", "Segoe UI", Arial, sans-serif'
  drawTracked(ctx, opts.nameEn.toUpperCase(), textCenterX, 252, 3)

  ctx.fillStyle = '#ffffff'
  ctx.font = '600 30px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('◀ ' + opts.prevNameEn.toUpperCase(), 28, H - 20)
  ctx.textAlign = 'right'
  ctx.fillText(opts.nextNameEn.toUpperCase() + ' ▶', W - 28, H - 20)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16
  return tex
}

/** LED-style destination roll sign, used on the cab dashboard's "next stop" readout. */
export function makeDestinationTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ffb703'
  ctx.font = '700 56px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Generates a tileable platform floor texture: light tile grid + subtle tonal variation. */
export function makePlatformTileTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#b9b3a4'
  ctx.fillRect(0, 0, size, size)
  const tile = 32
  for (let y = 0; y < size; y += tile) {
    for (let x = 0; x < size; x += tile) {
      const shade = 4 + Math.floor(rnd() * 10)
      ctx.fillStyle = `rgba(0,0,0,${(shade / 255).toFixed(3)})`
      ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2)
    }
  }
  ctx.strokeStyle = 'rgba(60,55,45,0.35)'
  ctx.lineWidth = 1.5
  for (let i = 0; i <= size; i += tile) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(size, i)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Tileable ballast (crushed gravel) texture + matching roughness map for the track bed. */
export function makeBallastTexture(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rCanvas = document.createElement('canvas')
  rCanvas.width = size
  rCanvas.height = size
  const rCtx = rCanvas.getContext('2d')!

  ctx.fillStyle = '#4a463f'
  ctx.fillRect(0, 0, size, size)
  rCtx.fillStyle = '#999999'
  rCtx.fillRect(0, 0, size, size)

  for (let i = 0; i < 2200; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = 1 + rnd() * 2.2
    const shade = 40 + Math.floor(rnd() * 70)
    ctx.fillStyle = `rgb(${shade + 20},${shade + 14},${shade})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    const rough = 140 + Math.floor(rnd() * 100)
    rCtx.fillStyle = `rgb(${rough},${rough},${rough})`
    rCtx.beginPath()
    rCtx.arc(x, y, r, 0, Math.PI * 2)
    rCtx.fill()
  }

  const map = new THREE.CanvasTexture(canvas)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.colorSpace = THREE.SRGBColorSpace
  const roughnessMap = new THREE.CanvasTexture(rCanvas)
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  return { map, roughnessMap }
}

/** Raised-dot tactile paving strip texture (also used as a pseudo bump map). */
export function makeTactilePavingTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c9a227'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#8a6d15'
  const step = size / 4
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      ctx.beginPath()
      ctx.arc(x * step + step / 2, y * step + step / 2, step * 0.28, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export interface WindowGridOptions {
  /** Unlit window glass tint. */
  glass?: string
  /** Facade tone between windows (multiplied by the material color). */
  facade?: string
  /** Chance each window is lit at night. */
  litChance?: number
  /** Pool of lit-window colors — mostly warm whites, sometimes a colorful one. */
  litColors?: string[]
}

/** Procedural window-lit texture for building facades: a grid of rectangles, some randomly "lit". */
export function makeWindowGridTexture(cols: number, rows: number, opts: WindowGridOptions = {}): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const { glass = '#3d4552', facade = '#2a2e36', litChance = 0.4, litColors = ['#fff6da', '#fff6da', '#fff6da', '#ffe9b0'] } = opts
  // 256² is indistinguishable at the distances facades are ever seen from,
  // and a quarter of the VRAM of the old 512² canvases.
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const emCanvas = document.createElement('canvas')
  emCanvas.width = size
  emCanvas.height = size
  const emCtx = emCanvas.getContext('2d')!

  ctx.fillStyle = facade
  ctx.fillRect(0, 0, size, size)
  // The emissive canvas stays TRANSPARENT: each lit window is drawn with a
  // random alpha that acts as its personal "switch-on threshold" — the
  // progressive-windows shader lights a window once dusk passes its alpha.
  emCtx.clearRect(0, 0, size, size)

  const stepX = size / cols
  const stepY = size / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * stepX + stepX * 0.18
      const y = r * stepY + stepY * 0.18
      const w = stepX * 0.64
      const h = stepY * 0.64
      ctx.fillStyle = glass
      ctx.fillRect(x, y, w, h)
      if (rnd() < litChance) {
        const hex = litColors[Math.floor(rnd() * litColors.length)]
        const rr = parseInt(hex.slice(1, 3), 16)
        const gg = parseInt(hex.slice(3, 5), 16)
        const bb = parseInt(hex.slice(5, 7), 16)
        const key = 0.08 + rnd() * 0.9
        emCtx.fillStyle = `rgba(${rr},${gg},${bb},${key.toFixed(3)})`
        emCtx.fillRect(x, y, w, h)
      }
    }
  }
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  const emissiveMap = new THREE.CanvasTexture(emCanvas)
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  // No mipmaps on the threshold-alpha map: averaging alpha against the
  // transparent background would make distant facades switch on in blocks
  // (and shift with LOD) instead of window by window.
  emissiveMap.generateMipmaps = false
  emissiveMap.minFilter = THREE.LinearFilter
  return { map, emissiveMap }
}

/**
 * Kawara roof-tile pattern: horizontal courses with staggered joints and
 * per-tile shade variation, drawn in neutral grays so each roof's instance
 * tint colors it. Mapped up the slope (v) and along the eave (u).
 */
export function makeRoofTileTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#8f8f92'
  ctx.fillRect(0, 0, size, size)
  const rows = 9
  const cols = 12
  const rowH = size / rows
  const colW = size / cols
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW / 2)
    for (let c = -1; c < cols; c++) {
      // Per-tile tonal wobble.
      const shade = 128 + Math.floor((rnd() - 0.5) * 34)
      ctx.fillStyle = `rgb(${shade},${shade},${Math.min(255, shade + 3)})`
      ctx.fillRect(c * colW + offset + 1, r * rowH + 1, colW - 2, rowH - 2)
      // Rounded tile-cap hint at the course edge.
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.fillRect(c * colW + offset + 1, r * rowH + 1, colW - 2, 3)
    }
    // Course shadow line — what makes the rows read as overlapping tiles.
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.fillRect(0, (r + 1) * rowH - 2.5, size, 2.5)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Worn trackside ground band: oily gravel and dead grass tones near the
 * rails, alpha-fading to nothing at both edges so it melts into the ground
 * plane without a visible seam.
 */
export function makeTracksideWearTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  const tones = ['#3d3a32', '#46423a', '#38352c', '#4a443a', '#403c30', '#35322b']
  for (let i = 0; i < 240; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const r = 10 + rnd() * 42
    // Fade strength by distance from horizontal center so blobs thin out
    // toward the edges before the hard alpha ramp even kicks in.
    const centerFade = 1 - Math.abs(x / w - 0.5) * 2
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const tone = tones[Math.floor(rnd() * tones.length)]
    g.addColorStop(0, tone + Math.round(200 * centerFade).toString(16).padStart(2, '0'))
    g.addColorStop(1, tone + '00')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Shared dusk progress for every window-lit material: 0 = broad daylight
 * (all windows dark), 1 = deep night (all lit). Driven once per frame from
 * the day/night cycle.
 */
export const WINDOW_DUSK_UNIFORM = { value: 0 }

/**
 * Patches a MeshStandardMaterial so each emissive-map window switches on
 * individually when dusk passes the window's baked alpha threshold —
 * instead of the whole facade fading in at once. One uniform shared by all
 * patched materials; zero extra draw calls.
 */
export function applyProgressiveWindows(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowDusk = WINDOW_DUSK_UNIFORM
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uWindowDusk;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
  totalEmissiveRadiance *= emissiveColor.rgb * step( 1.0 - uWindowDusk, emissiveColor.a );
#endif`,
      )
  }
  mat.customProgramCacheKey = () => 'progressive-windows'
}

/** Soft radial glow disc for the sun — bright core fading out, so it reads as a glowing body instead of a hard square sprite. */
export function makeSunTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,246,214,1)')
  g.addColorStop(0.34, 'rgba(255,230,160,0.55)')
  g.addColorStop(0.62, 'rgba(255,214,130,0.16)')
  g.addColorStop(1, 'rgba(255,200,110,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Full moon with subtle maria blotches and a soft halo. */
export function makeMoonTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const halo = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2)
  halo.addColorStop(0, 'rgba(222,230,255,0.35)')
  halo.addColorStop(1, 'rgba(222,230,255,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#e8edfa'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2)
  ctx.fill()
  // Maria: a few soft gray blotches, deterministic layout so every load matches.
  const blotches = [
    [0.42, 0.38, 0.10], [0.58, 0.45, 0.08], [0.5, 0.6, 0.12], [0.38, 0.55, 0.06], [0.62, 0.6, 0.05],
  ]
  ctx.fillStyle = 'rgba(150,160,190,0.4)'
  for (const [bx, by, br] of blotches) {
    ctx.beginPath()
    ctx.arc(size * bx, size * by, size * br, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Soft cumulus blob — overlapping radial gradients on a transparent canvas.
 * Every gradient is sized to fade fully out INSIDE the canvas: puffs that
 * reached the edges used to get chopped into hard horizontal cuts on the
 * biggest clouds.
 */
// Raw pixels on purpose, NOT a 2D canvas: canvas backing stores are alpha-
// premultiplied, and un-premultiplying on texture upload divides each channel
// by a near-zero alpha along the puffs' soft edges. On iOS's GPU canvas the
// rounding error in that division exploded into saturated per-channel confetti
// speckles all over the cloud bodies. A DataTexture never premultiplies:
// RGB stays a constant 255 and only the analytic alpha varies.
export function makeCloudTexture(): THREE.DataTexture {
  const w = 512
  const h = 256
  // px, py, radius as fraction of height — chosen so px*w ± r and py*h ± r
  // always stay within the canvas.
  const puffs: [number, number, number][] = [
    [0.34, 0.56, 0.34], [0.5, 0.5, 0.4], [0.66, 0.56, 0.32], [0.42, 0.44, 0.28], [0.58, 0.42, 0.24], [0.26, 0.62, 0.2], [0.74, 0.62, 0.18],
  ]
  // Same ramp the old radial gradient described: 0.85 core → 0 at the rim.
  const profile = (t: number): number => {
    if (t >= 1) return 0
    if (t < 0.55) return 0.85 + (0.38 - 0.85) * (t / 0.55)
    if (t < 0.85) return 0.38 + (0.08 - 0.38) * ((t - 0.55) / 0.3)
    return 0.08 * (1 - (t - 0.85) / 0.15)
  }
  const radii = puffs.map(([px, py, pr]) =>
    Math.min(h * pr, w * px - 2, w * (1 - px) - 2, h * py - 2, h * (1 - py) - 2),
  )
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0
      for (let p = 0; p < puffs.length; p++) {
        const dx = x - w * puffs[p][0]
        const dy = y - h * puffs[p][1]
        const pa = profile(Math.hypot(dx, dy) / radii[p])
        a += pa * (1 - a) // source-over stacking, like the old painted circles
      }
      const i = (y * w + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  const tex = new THREE.DataTexture(data, w, h)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = true // match the CanvasTexture orientation this replaced
  // Clouds are always mid-size on screen; pinning mip level 0 avoids the
  // trilinear shimmer Apple GPUs make of low-alpha 8-bit mip chains.
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** One vertical neon sign: colored panel, vertical kanji column, thin border — Tokyo backstreet style. */
export function makeNeonSignTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const W = 96
  const H = 512
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = fg
  ctx.lineWidth = 5
  ctx.strokeRect(6, 6, W - 12, H - 12)
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chars = [...text]
  const fontPx = Math.min(64, Math.floor((H - 60) / chars.length) - 8)
  ctx.font = `700 ${fontPx}px "Hiragino Sans", "Noto Sans JP", sans-serif`
  const totalH = chars.length * (fontPx + 8)
  let y = H / 2 - totalH / 2 + (fontPx + 8) / 2
  for (const ch of chars) {
    if (ch === 'ー') {
      // In vertical writing (tategaki) the long-vowel mark rotates 90° —
      // stacked unrotated it reads as the kanji 一.
      ctx.save()
      ctx.translate(W / 2, y)
      ctx.rotate(Math.PI / 2)
      ctx.fillText(ch, 0, 0)
      ctx.restore()
    } else {
      ctx.fillText(ch, W / 2, y)
    }
    y += fontPx + 8
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Soft, irregular urban mottling for the ground plane — overlapping tonal
 * blotches with no hard edges or straight lines, so no tiling grid ever
 * reads from the cab. (An earlier version drew a street grid; from eye
 * height it looked like graph paper, not a city.)
 */
export function makeGroundTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // ~0.42 luma base (was ~0.18): the old near-black felt meant every season
  // had to overdrive its vertex colors ×1.8–2.7 to read at all, crushing the
  // texture's own detail. A lighter base carries the detail through and the
  // seasonal gains come down to civilized values (see Seasons.ts 'terrain').
  ctx.fillStyle = '#6d7361'
  ctx.fillRect(0, 0, size, size)

  // Large soft blotches in near-identical tones — reads as patchy earth,
  // asphalt and scrub from a distance without any recognizable pattern.
  const tones = ['#71776a', '#666c5e', '#747a6c', '#6b7168', '#787e69', '#687062']
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = 30 + rnd() * 110
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const tone = tones[Math.floor(rnd() * tones.length)]
    g.addColorStop(0, tone + 'cc')
    g.addColorStop(1, tone + '00')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Fine speckle for a little texture up close.
  for (let i = 0; i < 1600; i++) {
    const shade = rnd() < 0.5 ? 0 : 255
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(0.02 + rnd() * 0.04).toFixed(3)})`
    ctx.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 3, 2 + rnd() * 3)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ── Cab instruments ─────────────────────────────────────────────────────────
// Everything below draws a gauge face, and NONE of it touches the module's
// shared `rnd`. That is deliberate: these run while the cab is built, and a
// single extra draw from the shared sequence would re-grain every texture
// made after them. Instruments are precise objects anyway — their wear comes
// from the scuffed panel they are mounted on, not from speckle of their own.

export interface GaugeFaceOptions {
  /** Top of the scale in the gauge's own units. */
  max: number
  /** Numerals are drawn every this many units; ticks at half of it. */
  majorEvery: number
  /** Small caption under the hub, e.g. "km/h" or "kPa". */
  unit: string
  /** Optional red band from this value to `max` — the limit you must not pass. */
  redFrom?: number
  /** Second scale drawn inside the first, for the twin-needle pressure gauge. */
  inner?: { max: number; majorEvery: number; color: string }
  face?: string
  ink?: string
}

/** Sweep of every dial in this cab: 7 o'clock round to 5 o'clock, the usual 270°. */
const GAUGE_START = Math.PI * 0.75
const GAUGE_SWEEP = Math.PI * 1.5

/** Fraction along the scale (0..1) to the angle its needle points at. */
export function gaugeAngle(fraction: number): number {
  return GAUGE_START + THREE.MathUtils.clamp(fraction, 0, 1) * GAUGE_SWEEP
}

/**
 * A round instrument face on a transparent background, drawn once at build
 * time. The needle is NOT part of this texture — it is a separate mesh that
 * rotates, because redrawing a canvas every frame is exactly the kind of cost
 * this project measures and refuses.
 */
export function makeGaugeFaceTexture(opts: GaugeFaceOptions): THREE.CanvasTexture {
  // 256, not 512. The speedometer is 0.35 m across at 2.13 m from the eye:
  // about 12% of screen height, ~105 real pixels on the phone once pixelRatio
  // is capped. 512 was oversampled five times over, for 2.1 MB of VRAM.
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  const face = opts.face ?? '#0d1016'
  const ink = opts.ink ?? '#e8ecf2'

  // Dial well, with a soft vignette so the face reads as recessed metal.
  const well = ctx.createRadialGradient(c, c * 0.82, size * 0.05, c, c, c)
  well.addColorStop(0, '#1b202a')
  well.addColorStop(0.72, face)
  well.addColorStop(1, '#05070b')
  ctx.fillStyle = well
  ctx.beginPath()
  ctx.arc(c, c, c - 3, 0, Math.PI * 2)
  ctx.fill()

  const ring = (radius: number, width: number, style: string) => {
    ctx.strokeStyle = style
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.arc(c, c, radius, 0, Math.PI * 2)
    ctx.stroke()
  }
  ring(c - 4, 4.5, '#2f3540')
  ring(c - 7.5, 1, '#565e6b')

  const polar = (angle: number, radius: number): [number, number] => [c + Math.cos(angle) * radius, c + Math.sin(angle) * radius]

  // The red band goes UNDER the ticks so the marks stay readable on top of it.
  if (opts.redFrom !== undefined) {
    ctx.strokeStyle = 'rgba(214,58,58,0.85)'
    ctx.lineWidth = 7.5
    ctx.beginPath()
    ctx.arc(c, c, c - 15, gaugeAngle(opts.redFrom / opts.max), gaugeAngle(1))
    ctx.stroke()
  }

  const drawScale = (max: number, majorEvery: number, radius: number, color: string, numerals: boolean) => {
    const steps = Math.round(max / majorEvery)
    for (let i = 0; i <= steps * 2; i++) {
      const value = (i * majorEvery) / 2
      if (value > max) break
      const major = i % 2 === 0
      const a = gaugeAngle(value / max)
      const outer = radius
      const inner = radius - (major ? 13 : 6.5)
      const [x1, y1] = polar(a, outer)
      const [x2, y2] = polar(a, inner)
      ctx.strokeStyle = color
      ctx.lineWidth = major ? 3 : 1.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      if (major && numerals) {
        const [tx, ty] = polar(a, radius - 27)
        ctx.fillStyle = color
        ctx.font = '700 21px Arial, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(Math.round(value)), tx, ty)
      }
    }
  }

  drawScale(opts.max, opts.majorEvery, c - 11, ink, true)
  if (opts.inner) drawScale(opts.inner.max, opts.inner.majorEvery, c - 59, opts.inner.color, false)

  ctx.fillStyle = 'rgba(232,236,242,0.72)'
  ctx.font = '600 17px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(opts.unit, c, c + 46)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * The row of annunciators over the desk: doors, ATS, and the emergency lamp.
 * Drawn as one strip so the whole row is a single quad — the lit state is a
 * separate emissive plane per lamp, which is what actually changes.
 */
export function makeCabAnnunciatorTexture(labels: string[]): THREE.CanvasTexture {
  const w = 128 * labels.length
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#14171d'
  ctx.fillRect(0, 0, w, 128)
  labels.forEach((label, i) => {
    const x = i * 128
    ctx.fillStyle = '#0a0c11'
    ctx.fillRect(x + 8, 18, 112, 92)
    ctx.strokeStyle = '#3b424f'
    ctx.lineWidth = 3
    ctx.strokeRect(x + 8, 18, 112, 92)
    ctx.fillStyle = '#9aa3b2'
    ctx.font = '700 44px "Hiragino Sans", "Yu Gothic", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + 64, 66)
  })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The clipped paper timetable on the driver's desk.
 *
 * It is intentionally a single small texture instead of geometry per row:
 * the card needs to read as real operating paperwork, but no phone will ever
 * resolve raised letters at this size. The times are part of the cab artwork,
 * not the simulation clock.
 */
export function makeCabTimetableTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ddd8c7'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#34352f'
  ctx.lineWidth = 7
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20)

  ctx.fillStyle = '#252720'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 28px "Hiragino Sans", "Yu Gothic", sans-serif'
  ctx.fillText('運転時刻表（下り）', canvas.width / 2, 43)

  const rows = [
    ['東京', '08:11', '08:11'],
    ['横浜', '08:18', '08:19'],
    ['すすきの', '08:25', '08:26'],
    ['錦', '08:32', '08:33'],
    ['奈良', '08:39', '08:40'],
    ['高野山', '08:47', '08:48'],
    ['金沢', '08:55', '08:56'],
    ['高山', '09:03', '09:04'],
  ] as const
  const x = [20, 176, 274, 364]
  const top = 68
  const rowH = 51

  ctx.strokeStyle = '#55574e'
  ctx.lineWidth = 2
  for (const xx of x) {
    ctx.beginPath()
    ctx.moveTo(xx, top)
    ctx.lineTo(xx, top + rowH * (rows.length + 1))
    ctx.stroke()
  }
  for (let r = 0; r <= rows.length + 1; r++) {
    const yy = top + r * rowH
    ctx.beginPath()
    ctx.moveTo(x[0], yy)
    ctx.lineTo(x[x.length - 1], yy)
    ctx.stroke()
  }

  ctx.font = '700 20px "Hiragino Sans", "Yu Gothic", sans-serif'
  ctx.fillText('駅名', (x[0] + x[1]) / 2, top + rowH / 2)
  ctx.fillText('着', (x[1] + x[2]) / 2, top + rowH / 2)
  ctx.fillText('発', (x[2] + x[3]) / 2, top + rowH / 2)

  ctx.font = '600 19px "Hiragino Sans", "Yu Gothic", sans-serif'
  rows.forEach((row, i) => {
    const cy = top + rowH * (i + 1.5)
    ctx.fillText(row[0], (x[0] + x[1]) / 2, cy)
    ctx.fillText(row[1], (x[1] + x[2]) / 2, cy)
    ctx.fillText(row[2], (x[2] + x[3]) / 2, cy)
  })

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Five labelled desk switches, baked into one face under five physical toggles. */
export function makeCabSwitchBankTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 192
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#343a35'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#171a18'
  ctx.lineWidth = 8
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)

  const labels = ['前照灯', '室内灯', '電笛', 'パンタ', '制御電源']
  const cell = canvas.width / labels.length
  labels.forEach((label, i) => {
    const cx = cell * (i + 0.5)
    ctx.fillStyle = '#d7d0b8'
    ctx.font = '700 27px "Hiragino Sans", "Yu Gothic", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx, 40)
    ctx.fillStyle = '#151816'
    ctx.fillRect(cx - 27, 68, 54, 68)
    ctx.strokeStyle = '#73796f'
    ctx.lineWidth = 4
    ctx.strokeRect(cx - 27, 68, 54, 68)
    ctx.fillStyle = '#aaa994'
    ctx.font = '600 19px "Hiragino Sans", "Yu Gothic", sans-serif'
    ctx.fillText(i < 3 ? '切　入' : '下　上', cx, 165)
  })

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * One service plate for the cab side wall: line-voltage dial, speaker grille
 * and safety labels. These fittings are read at a grazing angle, so one
 * authored plane communicates more than a handful of tiny 3D boxes would.
 */
export function makeCabEquipmentTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#323832'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#111411'
  ctx.lineWidth = 8
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)

  ctx.fillStyle = '#d8cfb1'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 24px "Hiragino Sans", "Yu Gothic", sans-serif'
  ctx.fillText('架線電圧', canvas.width / 2, 34)

  ctx.fillStyle = '#171a18'
  ctx.beginPath()
  ctx.arc(canvas.width / 2, 116, 70, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#8e9488'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.fillStyle = '#dcd8ca'
  ctx.font = '700 22px Arial, sans-serif'
  ctx.fillText('1.5', canvas.width / 2, 111)
  ctx.font = '600 15px Arial, sans-serif'
  ctx.fillText('kV', canvas.width / 2, 139)
  ctx.strokeStyle = '#f0ba54'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(canvas.width / 2, 116)
  ctx.lineTo(92, 151)
  ctx.stroke()

  ctx.fillStyle = '#181b19'
  ctx.fillRect(35, 206, 186, 112)
  ctx.fillStyle = '#6f756c'
  for (let y = 224; y < 306; y += 16) {
    for (let x = 55; x < 210; x += 18) {
      ctx.beginPath()
      ctx.arc(x, y, 4.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const plates = [
    ['信号炎管', '#d6cbb0', '#292b26'],
    ['非常通報', '#b4483c', '#fff0db'],
  ] as const
  plates.forEach(([label, bg, fg], i) => {
    const y = 348 + i * 67
    ctx.fillStyle = bg
    ctx.fillRect(31, y, 194, 48)
    ctx.fillStyle = fg
    ctx.font = '700 24px "Hiragino Sans", "Yu Gothic", sans-serif'
    ctx.fillText(label, canvas.width / 2, y + 25)
  })

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
