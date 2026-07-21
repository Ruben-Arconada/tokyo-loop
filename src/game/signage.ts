import * as THREE from 'three'

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
    const x = Math.random() * size
    const y = Math.random() * size
    const len = 2 + Math.random() * 10
    const angle = Math.random() * Math.PI * 2
    const shade = Math.random() < 0.5 ? 255 : 0
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${(0.08 + Math.random() * 0.12).toFixed(3)})`
    ctx.lineWidth = 0.6 + Math.random()
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

/** JR Yamanote Line's official platform-sign color ("uguisu-iro"), the same on all 30 stations. */
export const YAMANOTE_LINE_COLOR = 0x8fc31f

export interface StationSignOptions {
  nameEn: string
  nameJa: string
  nameKana: string
  /** e.g. "JY01" */
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
  const lineHex = '#' + YAMANOTE_LINE_COLOR.toString(16).padStart(6, '0')

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
      const shade = 4 + Math.floor(Math.random() * 10)
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
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 1 + Math.random() * 2.2
    const shade = 40 + Math.floor(Math.random() * 70)
    ctx.fillStyle = `rgb(${shade + 20},${shade + 14},${shade})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    const rough = 140 + Math.floor(Math.random() * 100)
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
  emCtx.fillStyle = '#000000'
  emCtx.fillRect(0, 0, size, size)

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
      if (Math.random() < litChance) {
        emCtx.fillStyle = litColors[Math.floor(Math.random() * litColors.length)]
        emCtx.fillRect(x, y, w, h)
      }
    }
  }
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  const emissiveMap = new THREE.CanvasTexture(emCanvas)
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  return { map, emissiveMap }
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
export function makeCloudTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // px, py, radius as fraction of height — chosen so px*w ± r and py*h ± r
  // always stay within the canvas.
  const puffs: [number, number, number][] = [
    [0.34, 0.56, 0.34], [0.5, 0.5, 0.4], [0.66, 0.56, 0.32], [0.42, 0.44, 0.28], [0.58, 0.42, 0.24], [0.26, 0.62, 0.2], [0.74, 0.62, 0.18],
  ]
  for (const [px, py, pr] of puffs) {
    const r = Math.min(h * pr, w * px - 2, w * (1 - px) - 2, h * py - 2, h * (1 - py) - 2)
    const g = ctx.createRadialGradient(w * px, h * py, 0, w * px, h * py, r)
    g.addColorStop(0, 'rgba(255,255,255,0.85)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.38)')
    g.addColorStop(0.85, 'rgba(255,255,255,0.08)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(w * px, h * py, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
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
  ctx.fillStyle = '#2b302a'
  ctx.fillRect(0, 0, size, size)

  // Large soft blotches in near-identical tones — reads as patchy earth,
  // asphalt and scrub from a distance without any recognizable pattern.
  const tones = ['#2d332c', '#292e28', '#2f342e', '#2c312e', '#31372d', '#2a2f2b']
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 30 + Math.random() * 110
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const tone = tones[Math.floor(Math.random() * tones.length)]
    g.addColorStop(0, tone + 'cc')
    g.addColorStop(1, tone + '00')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Fine speckle for a little texture up close.
  for (let i = 0; i < 1600; i++) {
    const shade = Math.random() < 0.5 ? 0 : 255
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(0.02 + Math.random() * 0.04).toFixed(3)})`
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 3, 2 + Math.random() * 3)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
