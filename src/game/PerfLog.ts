// ————————————————————————————————————————————————————————————————
// Frame-time recorder for real-device sessions.
//
// The point of this is NOT to print "60 fps". An average frame rate hides
// exactly what a player feels: a lap that averages 59 fps but drops three
// 80 ms frames in the Komagome grove reads as janky, while a steady 45 fps
// reads as smooth. So this records the DISTRIBUTION (percentiles from a
// histogram), WHERE on the ring each stall happened, and HOW the ride
// evolves minute by minute — which is what catches a phone thermally
// throttling halfway through a lap, something no summary number shows.
//
// Cost per frame: a few integer increments into preallocated arrays. No
// allocation, no DOM, no timers — the recorder must never be the reason a
// frame is slow.
// ————————————————————————————————————————————————————————————————

/** Histogram resolution: 0.5 ms buckets up to 100 ms, then one overflow bucket. */
const BUCKET_MS = 0.5
const BUCKETS = 200
/** One time-series bin per second of wall clock. */
const BIN_MS = 1000
/** A frame this long is a visible hitch worth recording individually. */
const HITCH_MS = 50
/** Keep the worst hitches only — a bad session must not grow unbounded. */
const MAX_HITCHES = 40
/** ~30 min of lap at one bin/second; a full loop is a few minutes. */
const MAX_BINS = 1800

/** Per-second slice of the ride: [tSec, frames, meanMs, maxMs, draws, tris, speedKmh, progress‰]. */
type Bin = [number, number, number, number, number, number, number, number]

/** One hitch: [tSec, ms, progress‰, station, draws, tris]. */
type Hitch = [number, number, number, number, number, number]

export interface PerfSample {
  frameMs: number
  draws: number
  tris: number
  speedKmh: number
  /** 0..1 around the loop — turns a stall into a PLACE, not just a moment. */
  progress: number
  stationIdx: number
}

export interface PerfSummary {
  seconds: number
  frames: number
  meanFps: number
  /** Frame-time percentiles in ms. p05 exposes the display's ceiling (16.7 = 60 Hz, 8.3 = 120 Hz). */
  p05: number
  p50: number
  p95: number
  p99: number
  maxMs: number
  /** Frames slower than one 60 Hz / 30 Hz refresh, and outright hitches. */
  over17: number
  over33: number
  over50: number
  maxDraws: number
  maxTris: number
  /** Times the loop was suspended (pause menu, phone backgrounded) — excluded from the stats, counted here. */
  gaps: number
}

const STORE_KEY = 'tokyo-loop-perf-log'

function formatHeadline(s: PerfSummary): string {
  const mins = Math.floor(s.seconds / 60)
  const secs = Math.round(s.seconds % 60)
  return (
    `${mins}:${String(secs).padStart(2, '0')} · ${s.meanFps} fps de media · ` +
    `p95 ${s.p95} ms · ${s.over50} tirones · peor ${s.maxMs} ms · máx ${s.maxDraws} draws`
  )
}

export class PerfLog {
  recording = false
  /** Frames captured in the current recording — 0 means there is nothing to hand over yet. */
  frames = 0
  private hist = new Uint32Array(BUCKETS + 1)
  private totalMs = 0
  private maxMs = 0
  private maxDraws = 0
  private maxTris = 0
  private bins: Bin[] = []
  private hitches: Hitch[] = []
  private startedAt = 0
  private binStart = 0
  private binFrames = 0
  private binMs = 0
  private binMax = 0
  private binDraws = 0
  private binTris = 0
  private binSpeed = 0
  private lastPersist = 0
  private gaps = 0
  /** Captured once at start: everything about the device I can't ask for later. */
  private context: Record<string, unknown> = {}

  /** Live frame rate for the on-screen counter, smoothed just enough to be readable. */
  fpsNow = 0

  start(context: Record<string, unknown>) {
    this.hist.fill(0)
    this.frames = 0
    this.totalMs = 0
    this.maxMs = 0
    this.maxDraws = 0
    this.maxTris = 0
    this.bins = []
    this.hitches = []
    this.startedAt = performance.now()
    this.binStart = this.startedAt
    this.binFrames = 0
    this.binMs = 0
    this.binMax = 0
    this.binDraws = 0
    this.binTris = 0
    this.binSpeed = 0
    this.lastPersist = this.startedAt
    this.gaps = 0
    this.context = context
    this.recording = true
  }

  stop() {
    if (!this.recording) return
    this.closeBin(performance.now(), 0)
    this.recording = false
    this.persist()
  }

  /**
   * One frame. `frameMs` must be measured from the animation loop itself
   * (not the game's clamped simulation delta) — a stall that the physics
   * accumulator smooths over is exactly the stall the player saw.
   */
  record(s: PerfSample) {
    // The live counter runs even when not recording, so the chip is useful
    // on its own; a 0.12 smoothing keeps it readable without hiding drops.
    const inst = s.frameMs > 0 ? 1000 / s.frameMs : 0
    this.fpsNow = this.fpsNow === 0 ? inst : this.fpsNow + (inst - this.fpsNow) * 0.12
    if (!this.recording) return

    const now = performance.now()
    // A "frame" longer than a second isn't a frame, it's the loop having been
    // suspended — the pause menu stops rAF outright, and iOS freezes a
    // backgrounded tab. Counting those would put a 30-second hitch in p99 and
    // make the whole log a lie.
    if (s.frameMs > 1000) {
      this.gaps++
      this.closeBin(now, s.progress)
      return
    }
    const bucket = Math.min(BUCKETS, Math.floor(s.frameMs / BUCKET_MS))
    this.hist[bucket]++
    this.frames++
    this.totalMs += s.frameMs
    if (s.frameMs > this.maxMs) this.maxMs = s.frameMs
    if (s.draws > this.maxDraws) this.maxDraws = s.draws
    if (s.tris > this.maxTris) this.maxTris = s.tris

    this.binFrames++
    this.binMs += s.frameMs
    if (s.frameMs > this.binMax) this.binMax = s.frameMs
    if (s.draws > this.binDraws) this.binDraws = s.draws
    if (s.tris > this.binTris) this.binTris = s.tris
    if (s.speedKmh > this.binSpeed) this.binSpeed = s.speedKmh

    if (s.frameMs >= HITCH_MS && this.hitches.length < MAX_HITCHES * 4) {
      this.hitches.push([
        Math.round((now - this.startedAt) / 100) / 10,
        Math.round(s.frameMs),
        Math.round(s.progress * 1000),
        s.stationIdx,
        s.draws,
        Math.round(s.tris / 1000),
      ])
    }

    if (now - this.binStart >= BIN_MS) this.closeBin(now, s.progress)
    // Survive an iOS tab kill mid-lap: the log is worthless if backgrounding
    // the PWA between the ride and the copy button throws it away.
    if (now - this.lastPersist > 5000) this.persist()
  }

  private closeBin(now: number, progress: number) {
    if (this.binFrames > 0 && this.bins.length < MAX_BINS) {
      this.bins.push([
        Math.round((now - this.startedAt) / 1000),
        this.binFrames,
        Math.round((this.binMs / this.binFrames) * 10) / 10,
        Math.round(this.binMax),
        this.binDraws,
        Math.round(this.binTris / 1000),
        Math.round(this.binSpeed),
        Math.round(progress * 1000),
      ])
    }
    this.binStart = now
    this.binFrames = 0
    this.binMs = 0
    this.binMax = 0
    this.binDraws = 0
    this.binTris = 0
    this.binSpeed = 0
  }

  /** Frame-time value (ms) at a given percentile, read straight off the histogram. */
  private percentile(p: number): number {
    if (this.frames === 0) return 0
    const target = p * this.frames
    let seen = 0
    for (let i = 0; i <= BUCKETS; i++) {
      seen += this.hist[i]
      if (seen >= target) return Math.round((i + 0.5) * BUCKET_MS * 10) / 10
    }
    return Math.round(this.maxMs)
  }

  private countOver(ms: number): number {
    let n = 0
    for (let i = Math.ceil(ms / BUCKET_MS); i <= BUCKETS; i++) n += this.hist[i]
    return n
  }

  get summary(): PerfSummary {
    const seconds = this.totalMs / 1000
    return {
      seconds: Math.round(seconds * 10) / 10,
      frames: this.frames,
      meanFps: seconds > 0 ? Math.round((this.frames / seconds) * 10) / 10 : 0,
      p05: this.percentile(0.05),
      p50: this.percentile(0.5),
      p95: this.percentile(0.95),
      p99: this.percentile(0.99),
      maxMs: Math.round(this.maxMs),
      over17: this.countOver(16.7),
      over33: this.countOver(33.3),
      over50: this.countOver(HITCH_MS),
      maxDraws: this.maxDraws,
      maxTris: this.maxTris,
      gaps: this.gaps,
    }
  }

  /** One line for the pause menu — the shape of the session at a glance. */
  get headline(): string {
    // A recording that only lives in memory is one iOS tab-kill away from
    // nothing, so fall back to whatever the last persisted session said:
    // otherwise the menu claims "no data" while sitting next to a Copy button.
    if (this.frames === 0) return PerfLog.storedHeadline()
    return formatHeadline(this.summary)
  }

  static storedHeadline(): string {
    const raw = PerfLog.stored()
    if (!raw) return 'Sin datos todavía.'
    try {
      return `${formatHeadline(JSON.parse(raw).summary)} (sesión anterior)`
    } catch {
      return 'Hay un log guardado.'
    }
  }

  /** The payload to hand back: compact arrays, not objects — a full lap has to fit in a paste. */
  export(): string {
    return JSON.stringify({
      v: 1,
      ctx: this.context,
      summary: this.summary,
      // [tSec, frames, meanMs, maxMs, draws, kTris, kmh, progress‰]
      bins: this.bins,
      // [tSec, ms, progress‰, station, draws, kTris] — worst first, capped
      hitches: this.hitches.slice().sort((a, b) => b[1] - a[1]).slice(0, MAX_HITCHES),
    })
  }

  private persist() {
    this.lastPersist = performance.now()
    try {
      localStorage.setItem(STORE_KEY, this.export())
    } catch {
      // Quota or private mode — the in-memory log still works for this session.
    }
  }

  /** True if a previous session left a log behind (survives a reload or an iOS tab kill). */
  static hasStored(): boolean {
    return !!localStorage.getItem(STORE_KEY)
  }

  static stored(): string {
    return localStorage.getItem(STORE_KEY) ?? ''
  }

  static clearStored() {
    localStorage.removeItem(STORE_KEY)
  }
}
