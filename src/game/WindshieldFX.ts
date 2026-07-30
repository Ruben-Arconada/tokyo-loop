// ————————————————————————————————————————————————————————————————
// The windscreen itself: a 2D canvas overlay drawn between the WebGL view
// and the HUD, active only in the cab view. Deliberately NOT a shader pass —
// a fullscreen post-process is exactly the kind of cost a thermally-
// throttling phone cannot afford, while a handful of pre-rendered sprites
// and gradients on a 2D canvas are nothing.
//
// Three layers now live here, cheapest possible home for each:
// · RAIN/SNOW — drops that bead, trickle and smear with speed; flakes that
//   melt. (The original layer.)
// · GLASS — the pane's own presence: a whisper of top tint, corner shading
//   and old wiper haze, plus WINTER: frost creeping in from the corners and
//   a breath of condensation around the edges. Redrawn only when its state
//   changes — a parked frame costs nothing.
// · SUN FLARE — when the sun stands inside the windscreen on a clear day,
//   a soft core, a horizontal streak and two ghosts along the lens axis.
//   Position comes projected from Game; zero GL cost, zero when absent.
// ————————————————————————————————————————————————————————————————

interface Drop {
  x: number
  y: number
  r: number
  /** Remaining life in seconds — drops dry out even if they never leave the glass. */
  life: number
  maxLife: number
  /** Trickle phase offset so no two drops wobble in step. */
  wobble: number
  /** Some drops sit still, some run — a per-drop weight (heavier = runs sooner). */
  weight: number
}

const MAX_DROPS = 64
/** Overlay resolution cap — glass drops don't need retina, and the canvas is blended over everything. */
const DPR_CAP = 1.25

/**
 * What the cab asks of this overlay beyond the weather: the sun flare. Only
 * SCREEN-space optics live here now — the pane's own dressing (tint, wiper
 * haze, frost) moved onto the 3D glass in CabInterior after Rubén caught the
 * screen-space version "accompanying" his head turns: an axis-aligned canvas
 * rectangle can neither foreshorten nor keep frame-perfect step with the
 * camera. A flare, being a lens artifact, is exactly what SHOULD live in
 * screen space.
 */
export interface GlassState {
  /** 0..1 — flare strength (0 = sun absent/behind/overcast/tunnel). */
  flare: number
  /** Flare centre in canvas NDC (-1..1), only read when flare > 0. */
  flareX: number
  flareY: number
  /**
   * Multiplier on the flare CORE only. Game lowers it when a low sun stands
   * in a tower district — the poor man's occlusion (Haruto, round 3). The
   * veil and ghosts keep their strength; only the "naked disc" concedes.
   */
  coreMul: number
}

export class WindshieldFX {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  /** Fixed pool + live count with swap-remove: zero allocation once warm (Marco's rule). */
  private drops: Drop[] = Array.from({ length: MAX_DROPS }, () => ({ x: 0, y: 0, r: 0, life: 0, maxLife: 1, wobble: 0, weight: 0.5 }))
  private alive = 0
  private spawnCarry = 0
  private dropSprite: HTMLCanvasElement
  private flakeSprite: HTMLCanvasElement
  private flareCore: HTMLCanvasElement
  private ghostGreen: HTMLCanvasElement
  private ghostViolet: HTMLCanvasElement
  private shown = false
  private w = 0
  private h = 0
  private dpr = 1
  private lastFlare = 0
  /** A mode switch (cab ↔ outside) leaves paint beyond the clip — clear it once. */
  private lastWasClipped = false
  /** Last frame's pane rect in pixels — the clear must cover ITS union with the new one. */
  private lastPx0 = 0
  private lastPy0 = 0
  private lastPx1 = 0
  private lastPy1 = 0

  constructor(mount: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'windshield-fx'
    // Directly ABOVE the GL canvas and below everything else (HUD, lever,
    // overlays): appended at the end it painted over the controls — the
    // opposite of what glass on the far side of the HUD should do.
    const gl = mount.querySelector('canvas.game-canvas')
    mount.insertBefore(this.canvas, gl ? gl.nextSibling : mount.firstChild)
    this.ctx = this.canvas.getContext('2d')!
    this.dropSprite = makeDropSprite()
    this.flakeSprite = makeFlakeSprite()
    // Flare parts pre-rendered like the drops: blitting a sprite with a
    // transform allocates nothing (the file's own rule).
    this.flareCore = makeFlareCoreSprite()
    this.ghostGreen = makeGhostSprite(196, 255, 214)
    this.ghostViolet = makeGhostSprite(214, 196, 255)
    // No listener of its own: Game.onResize() calls resize() — it is the one
    // place that also hears visualViewport changes, which plain window
    // resize misses on iOS toolbar collapse.
    this.resize()
  }

  resize() {
    // Same viewport source as the renderer (visualViewport when available),
    // so the drop overlay and the GL view can never disagree when iOS
    // collapses its toolbar.
    const vv = window.visualViewport
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    this.w = Math.max(1, Math.round((vv?.width ?? window.innerWidth) * this.dpr))
    this.h = Math.max(1, Math.round((vv?.height ?? window.innerHeight) * this.dpr))
    this.canvas.width = this.w
    this.canvas.height = this.h
  }

  /**
   * @param intensity 0..1 how hard it's coming down (0 hides the layer)
   * @param snow true = flakes that melt, false = drops that trickle
   * @param speed01 0..1 of line speed — drives the upward/outward smear
   * @param visible false outside the cab view (the glass belongs to the cab)
   */
  /**
   * `clip` is the windscreen in normalised device coords. Drops are born inside
   * it and drawing is clipped to it, so rain stays on the glass instead of
   * running down the instrument panel. Null = the whole canvas, which is what
   * the outside views want.
   */
  update(dt: number, intensity: number, snow: boolean, speed01: number, visible: boolean, clip: { x0: number; y0: number; x1: number; y1: number } | null = null, glass: GlassState | null = null) {
    const rainActive = visible && intensity > 0.02
    // The flare belongs to the cab — which is exactly when a clip rect is
    // handed in. Outside views get drops only (legacy behaviour).
    const flare = visible && clip !== null && glass !== null ? glass.flare : 0
    // Nothing on screen and nothing to erase: hide entirely. A dry, flare-less
    // cab pays nothing for this overlay. lastFlare keeps us alive one more
    // frame so a dying flare gets erased before the canvas goes away.
    if (!rainActive && this.alive === 0 && flare <= 0.01 && this.lastFlare <= 0.01) {
      if (this.shown) {
        this.shown = false
        this.canvas.style.display = 'none'
        // Hidden paint would survive to the next show — force the full
        // clear path when we come back.
        this.lastWasClipped = false
      }
      this.lastFlare = 0
      return
    }
    if (!this.shown) {
      this.shown = true
      this.canvas.style.display = 'block'
    }

    // Spawn: heavier weather beads the glass faster; at speed more drops
    // arrive (the cab is driving INTO the rain).
    if (rainActive) {
      this.spawnCarry += dt * intensity * (snow ? 10 : 7) * (1 + 1.6 * speed01)
      while (this.spawnCarry >= 1 && this.alive < MAX_DROPS) {
        this.spawnCarry -= 1
        const d = this.drops[this.alive++]
        const maxLife = snow ? 1.6 + Math.random() * 2.2 : 4 + Math.random() * 7
        if (clip) {
          d.x = (clip.x0 + Math.random() * (clip.x1 - clip.x0)) * 0.5 * this.w + this.w * 0.5
          d.y = this.h * 0.5 - (clip.y0 + Math.random() * (clip.y1 - clip.y0)) * 0.5 * this.h
        } else {
          d.x = Math.random() * this.w
          d.y = Math.random() * this.h * 0.9
        }
        d.r = (snow ? 2.2 + Math.random() * 3 : 2.4 + Math.random() * 4.6) * this.dpr
        d.life = maxLife
        d.maxLife = maxLife
        d.wobble = Math.random() * Math.PI * 2
        d.weight = 0.35 + Math.random() * 0.65
      }
      if (this.spawnCarry > 2) this.spawnCarry = 2
    }

    const ctx = this.ctx
    if (clip) {
      const px0 = clip.x0 * 0.5 * this.w + this.w * 0.5
      const px1 = clip.x1 * 0.5 * this.w + this.w * 0.5
      const py0 = this.h * 0.5 - clip.y1 * 0.5 * this.h
      const py1 = this.h * 0.5 - clip.y0 * 0.5 * this.h
      // Only the pane changes in cab view — clearing the whole canvas paid
      // for a million dead pixels per frame (Marco, round 2). The clear is
      // the UNION of last frame's rect and this one: clearing only the
      // current rect left the previous frame's paint smeared outside it
      // during a head sweep (Marco again, round 3 — traced, not hypothesis).
      // One full clear when arriving from an unclipped view sweeps its
      // leftovers.
      if (this.lastWasClipped) {
        const ux0 = Math.min(px0, this.lastPx0) - 2
        const uy0 = Math.min(py0, this.lastPy0) - 2
        const ux1 = Math.max(px1, this.lastPx1) + 2
        const uy1 = Math.max(py1, this.lastPy1) + 2
        ctx.clearRect(ux0, uy0, ux1 - ux0, uy1 - uy0)
      } else {
        ctx.clearRect(0, 0, this.w, this.h)
      }
      this.lastWasClipped = true
      this.lastPx0 = px0
      this.lastPy0 = py0
      this.lastPx1 = px1
      this.lastPy1 = py1
      ctx.save()
      ctx.beginPath()
      ctx.rect(px0, py0, px1 - px0, py1 - py0)
      ctx.clip()
      if (flare > 0.01) {
        const fx = glass!.flareX * 0.5 * this.w + this.w * 0.5
        const fy = this.h * 0.5 - glass!.flareY * 0.5 * this.h
        this.drawFlare(fx, fy, flare, (px0 + px1) / 2, (py0 + py1) / 2, glass!.coreMul)
      }
    } else {
      ctx.clearRect(0, 0, this.w, this.h)
      this.lastWasClipped = false
    }
    this.lastFlare = flare
    const cx = this.w / 2
    const cy = this.h * 0.42 // vanishing point sits a little above center

    // Above ~half line speed the airstream owns the glass: drops smear along
    // their radial travel direction instead of sitting as round beads.
    const smear = Math.max(0, (speed01 - 0.4) / 0.6)
    for (let i = this.alive - 1; i >= 0; i--) {
      const d = this.drops[i]
      d.life -= dt
      let dead = d.life <= 0
      const ox = d.x - cx
      const oy = d.y - cy
      const olen = Math.hypot(ox, oy) || 1
      if (!dead && !snow) {
        // Gravity trickle when slow; at speed the airstream wins and drags
        // the water up and outward from the center of the glass.
        const trickle = (8 + d.weight * 26) * (1 - speed01 * 0.85) * this.dpr
        const air = speed01 * speed01 * (46 + d.weight * 40) * this.dpr
        d.x += ((ox / olen) * air + Math.sin(d.life * 3 + d.wobble) * 2 * this.dpr) * dt
        d.y += (trickle - (oy < 0 ? air * 0.8 : -air * 0.5) * (Math.abs(oy) / olen)) * dt
        if (d.y > this.h + 12 || d.x < -12 || d.x > this.w + 12) dead = true
      }
      if (dead) {
        // Swap-remove into the freed slot: no splice, no shifting, no garbage.
        this.alive--
        this.drops[i] = this.drops[this.alive]
        this.drops[this.alive] = d
        continue
      }
      const fade = Math.min(1, d.life / (d.maxLife * 0.35))
      ctx.globalAlpha = (snow ? 0.75 : 0.6) * fade * Math.min(1, intensity * 1.6)
      const sprite = snow ? this.flakeSprite : this.dropSprite
      const size = d.r * 2
      if (!snow && smear > 0.02) {
        // Rotate to the radial travel direction and stretch: a bead becomes
        // a streak of water racing outward across the glass.
        ctx.save()
        ctx.translate(d.x, d.y)
        ctx.rotate(Math.atan2(oy, ox) + Math.PI / 2)
        ctx.drawImage(sprite, -d.r, -d.r, size, size * (1.25 + smear * (1.6 + d.weight)))
        ctx.restore()
      } else {
        ctx.drawImage(sprite, d.x - d.r, d.y - d.r, size, snow ? size : size * 1.25)
      }
    }
    ctx.globalAlpha = 1
    if (clip) ctx.restore()
  }

  /**
   * Sun in the glass: a warm core, a horizontal streak, and two ghosts
   * walking the line from the sun through the pane's centre — the classic
   * lens signature, quiet enough to feel found rather than added. All four
   * parts are pre-rendered sprites blitted with a transform: zero gradient
   * objects per frame (Marco, round 1).
   */
  private drawFlare(sx: number, sy: number, strength: number, cx: number, cy: number, coreMul: number) {
    const ctx = this.ctx
    const base = Math.min(this.w, this.h)
    ctx.globalCompositeOperation = 'lighter'
    const rCore = base * 0.14 * (0.7 + 0.6 * strength)
    ctx.globalAlpha = strength * coreMul
    ctx.drawImage(this.flareCore, sx - rCore, sy - rCore, rCore * 2, rCore * 2)
    // Horizontal anamorphic streak: the same round sprite, crushed flat.
    // Humbler than v1 — the streak is a cinema-lens artefact, and the core
    // and veil should carry the moment from a driver's seat (Haruto, r2).
    const rStreak = rCore * 2.6
    ctx.globalAlpha = 0.38 * strength
    ctx.drawImage(this.flareCore, sx - rStreak, sy - rStreak * 0.055, rStreak * 2, rStreak * 0.11)
    // Ghosts mirrored along the axis through the pane centre. Below the
    // pane's midline they fade harder: that is where the driver reads the
    // track, and a ghost has no business parking on the vanishing point
    // (Lena, round 1).
    const gx = cx - sx
    const gy = cy - sy
    const ghost = (sprite: HTMLCanvasElement, k: number, r: number, a: number) => {
      const px = sx + gx * k
      const py = sy + gy * k
      ctx.globalAlpha = a * strength * (py > cy ? 0.45 : 1)
      ctx.drawImage(sprite, px - r, py - r, r * 2, r * 2)
    }
    ghost(this.ghostGreen, 0.65, rCore * 0.3, 0.1)
    ghost(this.ghostViolet, 1.35, rCore * 0.48, 0.08)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** The flare's warm heart, rendered once at full strength. */
function makeFlareCoreSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 160
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(80, 80, 2, 80, 80, 78)
  g.addColorStop(0, 'rgba(255,246,228,0.5)')
  g.addColorStop(0.3, 'rgba(255,224,176,0.16)')
  g.addColorStop(1, 'rgba(255,210,150,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 160, 160)
  return c
}

/** One lens ghost, tinted at build time. */
function makeGhostSprite(r: number, gr: number, b: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31)
  g.addColorStop(0, `rgba(${r},${gr},${b},1)`)
  g.addColorStop(0.7, `rgba(${r},${gr},${b},0.4)`)
  g.addColorStop(1, `rgba(${r},${gr},${b},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return c
}

/** A single glass bead, pre-rendered: highlight up-left, refracted shadow low. */
function makeDropSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')!
  const body = ctx.createRadialGradient(16, 14, 1, 16, 16, 14)
  body.addColorStop(0, 'rgba(210,228,248,0.65)')
  body.addColorStop(0.55, 'rgba(160,190,222,0.34)')
  body.addColorStop(1, 'rgba(120,150,190,0)')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.ellipse(16, 16, 13, 15, 0, 0, Math.PI * 2)
  ctx.fill()
  const hi = ctx.createRadialGradient(11, 9, 0.5, 11, 9, 5)
  hi.addColorStop(0, 'rgba(255,255,255,0.85)')
  hi.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hi
  ctx.beginPath()
  ctx.arc(11, 9, 5, 0, Math.PI * 2)
  ctx.fill()
  return c
}

/** A snowflake speck: soft white dot, slightly irregular. */
function makeFlakeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 24
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(12, 12, 0.5, 12, 12, 10)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.6, 'rgba(240,246,252,0.55)')
  g.addColorStop(1, 'rgba(230,238,248,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(12, 12, 10, 0, Math.PI * 2)
  ctx.fill()
  return c
}
