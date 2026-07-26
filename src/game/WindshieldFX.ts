// ————————————————————————————————————————————————————————————————
// Raindrops on the windshield: a 2D canvas overlay drawn between the WebGL
// view and the HUD, active only in the cab view while something is falling.
// Deliberately NOT a shader pass — a fullscreen post-process is exactly the
// kind of cost a thermally-throttling phone cannot afford, while a couple of
// dozen pre-rendered sprites on a 2D canvas are nothing.
//
// The drops know two things about the train: how hard it is raining (spawn
// rate/opacity) and how fast it is going — parked, drops bead up and trickle
// down under gravity; at speed the airstream drags them up and outward the
// way real windshield water behaves without wipers. Snow lands as small soft
// dots that melt (fade) instead of trickling.
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

export class WindshieldFX {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  /** Fixed pool + live count with swap-remove: zero allocation once warm (Marco's rule). */
  private drops: Drop[] = Array.from({ length: MAX_DROPS }, () => ({ x: 0, y: 0, r: 0, life: 0, maxLife: 1, wobble: 0, weight: 0.5 }))
  private alive = 0
  private spawnCarry = 0
  private dropSprite: HTMLCanvasElement
  private flakeSprite: HTMLCanvasElement
  private shown = false
  private w = 0
  private h = 0
  private dpr = 1

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
  update(dt: number, intensity: number, snow: boolean, speed01: number, visible: boolean) {
    const active = visible && intensity > 0.02
    if (!active && this.alive === 0) {
      if (this.shown) {
        this.shown = false
        this.canvas.style.display = 'none'
      }
      return
    }
    if (!this.shown) {
      this.shown = true
      this.canvas.style.display = 'block'
    }

    // Spawn: heavier weather beads the glass faster; at speed more drops
    // arrive (the cab is driving INTO the rain).
    if (active) {
      this.spawnCarry += dt * intensity * (snow ? 10 : 7) * (1 + 1.6 * speed01)
      while (this.spawnCarry >= 1 && this.alive < MAX_DROPS) {
        this.spawnCarry -= 1
        const d = this.drops[this.alive++]
        const maxLife = snow ? 1.6 + Math.random() * 2.2 : 4 + Math.random() * 7
        d.x = Math.random() * this.w
        d.y = Math.random() * this.h * 0.9
        d.r = (snow ? 2.2 + Math.random() * 3 : 2.4 + Math.random() * 4.6) * this.dpr
        d.life = maxLife
        d.maxLife = maxLife
        d.wobble = Math.random() * Math.PI * 2
        d.weight = 0.35 + Math.random() * 0.65
      }
      if (this.spawnCarry > 2) this.spawnCarry = 2
    }

    const ctx = this.ctx
    ctx.clearRect(0, 0, this.w, this.h)
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
  }
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
