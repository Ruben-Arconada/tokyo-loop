import { WORLD_SEED } from './Rng'

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

/**
 * One hitch: [tSec, ms, progress‰, station, draws, kTris, programasNuevos, tagsRecientes].
 *
 * `programasNuevos` is the decisive column. If a 320 ms frame linked a shader
 * program, the stall is compilation and no amount of audio work explains it;
 * if it linked none, compilation is ruled out and the remaining suspects are
 * the ones that leave no JS cost behind.
 */
type Hitch = [number, number, number, number, number, number, number, string]
/** How far back a hitch looks for game events that might have caused it. */
const MARK_WINDOW_MS = 2000
const MARK_RING = 48

export interface PerfSample {
  frameMs: number
  draws: number
  tris: number
  speedKmh: number
  /** 0..1 around the loop — turns a stall into a PLACE, not just a moment. */
  progress: number
  stationIdx: number
  /**
   * How many shader programs the renderer has LINKED so far, and how many
   * textures it holds. Both only ever grow during a lap, and the growth is
   * the point: a program is linked the first frame a material is actually
   * drawn, and on iOS that link is a synchronous main-thread stall of
   * hundreds of milliseconds.
   *
   * This is here because the first real-device lap showed 22 freezes of
   * 313-404 ms — a near-constant cost, once per station, at only 88-130 draws
   * — and NONE of them had a speech call in the two seconds before. A fixed
   * cost that happens once per place and never again is what first-draw work
   * looks like; the previous suspect (the announcement path) fires at all
   * thirty stations equally and would not skip the one we start at.
   */
  programs: number
  textures: number
  /**
   * Whether the sun was ACTUALLY casting this frame. `shadows` in the context
   * is only `renderer.shadowMap.enabled`, and under a closed sky the sun stops
   * casting (DayNightCycle), so a rainy lap can report shadows on and never
   * pay for the pass — which makes it useless as a worst case.
   */
  shadowPass: boolean
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
  /** Shader programs linked BEFORE the lap and DURING it. A lap that compiles nothing cannot be stalling on compiles. */
  programs0: number
  programsEnd: number
  /** Same for textures uploaded to the GPU. */
  textures0: number
  texturesEnd: number
  /** Frames where the sun actually cast — 0 means this lap never exercised the shadow pass, whatever `ctx.shadows` says. */
  shadowFrames: number
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
  /** Ring of recent game events, so a hitch can name what happened just before it. */
  private markTags: string[] = new Array(MARK_RING).fill('')
  private markTimes = new Float64Array(MARK_RING)
  private markHead = 0
  /** Synchronous cost per instrumented block: tag → [veces, msTotal, msPeor]. */
  private costs = new Map<string, [number, number, number]>()
  /** GPU resource counts: baseline at the first frame (-1 = not set yet) and running totals. */
  private programs0 = -1
  private textures0 = -1
  private programsSeen = 0
  private texturesSeen = 0
  private shadowFrames = 0

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
    this.markTimes.fill(0)
    this.markHead = 0
    this.costs.clear()
    this.programs0 = -1
    this.textures0 = -1
    this.programsSeen = 0
    this.texturesSeen = 0
    this.shadowFrames = 0
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
    // First sample of the lap establishes the baseline: everything already
    // linked and uploaded before the recording started does not belong to it.
    if (this.programs0 < 0) {
      this.programs0 = s.programs
      this.textures0 = s.textures
      // Seed the running counters too, or the first frame would report every
      // program linked before the lap as if the lap had just compiled it.
      this.programsSeen = s.programs
      this.texturesSeen = s.textures
    }
    const newPrograms = Math.max(0, s.programs - this.programsSeen)
    this.programsSeen = s.programs
    this.texturesSeen = s.textures
    if (s.shadowPass) this.shadowFrames++

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
        newPrograms,
        // What the game was doing in the run-up. A stall with a name is a bug
        // you can fix; a stall without one is a guess.
        this.recentMarks(now - s.frameMs),
      ])
    }

    if (now - this.binStart >= BIN_MS) this.closeBin(now, s.progress)
    // Survive an iOS tab kill mid-lap: the log is worthless if backgrounding
    // the PWA between the ride and the copy button throws it away.
    // Timed like everything else now. It serializes the whole log and writes
    // it synchronously, and being the one periodic job nobody had measured
    // made it an unfalsifiable suspect for every unexplained stall.
    if (now - this.lastPersist > 5000) this.time('perf-persist', () => this.persist())
  }

  /** Notes that a game event happened right now (cheap: two array writes). */
  mark(tag: string) {
    if (!this.recording) return
    this.markHead = (this.markHead + 1) % MARK_RING
    this.markTags[this.markHead] = tag
    this.markTimes[this.markHead] = performance.now()
  }

  /** Runs `fn` and books how long it blocked, under `tag`. Also leaves a mark. */
  time<T>(tag: string, fn: () => T): T {
    if (!this.recording) return fn()
    const t0 = performance.now()
    try {
      return fn()
    } finally {
      const ms = performance.now() - t0
      const c = this.costs.get(tag)
      if (c) {
        c[0]++
        c[1] += ms
        if (ms > c[2]) c[2] = ms
      } else {
        this.costs.set(tag, [1, ms, ms])
      }
      this.mark(tag)
    }
  }

  /** Tags seen in the window before `at` — the frame's own duration is subtracted by the caller so a mark made DURING the stall still counts. */
  private recentMarks(at: number): string {
    const out: string[] = []
    let newest = ''
    let newestAge = Infinity
    for (let i = 0; i < MARK_RING; i++) {
      const idx = (this.markHead - i + MARK_RING) % MARK_RING
      const t = this.markTimes[idx]
      if (!t || t > at + 400) continue
      const age = at - t
      if (age < newestAge) {
        newestAge = age
        newest = this.markTags[idx]
      }
      if (age > MARK_WINDOW_MS) continue
      const tag = this.markTags[idx]
      if (!out.includes(tag)) out.push(tag)
    }
    // An empty string used to mean two different things — "nothing was going
    // on" and "whatever caused this happened more than two seconds ago" — and
    // sixteen of the twenty-two big freezes in the first real lap came back
    // empty. Naming the last event and its age makes the difference readable
    // without widening the window and drowning every hitch in tags.
    if (!out.length) return newest ? `~${newest}+${(newestAge / 1000).toFixed(1)}s` : ''
    return out.join(',')
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
      programs0: Math.max(0, this.programs0),
      programsEnd: this.programsSeen,
      textures0: Math.max(0, this.textures0),
      texturesEnd: this.texturesSeen,
      shadowFrames: this.shadowFrames,
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
      // v3: hitches gained a `programasNuevos` column and the summary gained
      // the GPU-resource and shadow-pass counters. A v2 reader would silently
      // read the new column as the tag string, so the number has to move.
      v: 3,
      // Which world this lap was driven through. Two laps are only comparable
      // if this matches — before seeding, every reload dealt a different Japan
      // and draw counts could not be told apart from layout luck.
      seed: WORLD_SEED,
      ctx: this.context,
      summary: this.summary,
      // [tSec, frames, meanMs, maxMs, draws, kTris, kmh, progress‰]
      bins: this.bins,
      // [tSec, ms, progress‰, station, draws, kTris, programasNuevos, tags] — worst first, capped
      hitches: this.hitches.slice().sort((a, b) => b[1] - a[1]).slice(0, MAX_HITCHES),
      // tag: [veces, msTotal, msPeor] — el bloqueo síncrono medido EN SU MÓVIL.
      costs: Object.fromEntries(
        [...this.costs.entries()].sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => [k, v.map((n) => Math.round(n * 10) / 10)]),
      ),
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

// ————————————————————————————————————————————————————————————————
// Hooks so systems that know nothing about the recorder (audio, scenery) can
// still label what they were doing. No-ops until a recording is running.
// ————————————————————————————————————————————————————————————————

let active: PerfLog | null = null

export function setActivePerfLog(log: PerfLog | null) {
  active = log
}

export function perfMark(tag: string) {
  active?.mark(tag)
}

export function perfTime<T>(tag: string, fn: () => T): T {
  return active ? active.time(tag, fn) : fn()
}
