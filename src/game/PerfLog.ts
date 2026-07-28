// Explicit `.ts`, like worldHash: this module is exercised by test/ under
// node's own runner, which will not guess an extension.
import { WORLD_SEED } from './Rng.ts'

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
 * One hitch: [tSec, ms, renderMs, progress‰, station, draws, kTris,
 *             programasNuevos, texturasSubidas, tagsRecientes].
 *
 * Read `renderMs` first, but read it for what it is: the CPU time BLOCKED
 * inside `renderer.render()`. WebGL is asynchronous, so driver work a draw
 * triggers — linking a program, uploading a texture — need not be paid inside
 * the call that caused it. A high `renderMs` is therefore strong evidence that
 * the stall is render-side; a low one does NOT clear the resource columns,
 * because the cost can land at the next draw or at buffer swap. Ruling GPU
 * work out properly needs real GPU timing (EXT_disjoint_timer_query_webgl2),
 * whose availability is reported in the context.
 *
 * The two resource columns then split an expensive frame into "linked a
 * shader" versus "uploaded a texture" — and all three describe the SAME
 * render, which the first version of this did not.
 */
type Hitch = [number, number, number, number, number, number, number, number, number, string]
/** How far back a hitch looks for game events that might have caused it. */
const MARK_WINDOW_MS = 2000
const MARK_RING = 48

export interface PerfSample {
  /**
   * The interval the player felt — but note WHICH interval: it is measured at
   * the top of the tick, so it spans the PREVIOUS frame's work, not this
   * one's. A render that stalls shows up in the NEXT sample's frameMs.
   */
  frameMs: number
  /**
   * CPU time blocked inside this frame's own `renderer.render()`, measured
   * around the call. Added because pairing `frameMs` with resources read after
   * the render was off by exactly one frame: a 320 ms render that linked two
   * programs booked the programs against a normal-looking frame and the 320 ms
   * against the next one, which had linked none. The column meant to prove
   * compilation would have disproved it every time. `renderMs` and the
   * resource deltas below describe the SAME render.
   *
   * Not GPU time. See the Hitch doc — a low value does not exonerate the
   * resource columns, because WebGL can defer the driver work a draw triggers.
   */
  renderMs: number
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
   * Monotonic count of tracked textures that have reached the GPU — the
   * station name boards and the destination roll, which are built on a canvas
   * and uploaded on first draw.
   *
   * `textures` alone cannot answer this: it counts what is RESIDENT, so the
   * destination board being disposed and rebuilt at every station (the one
   * texture we know churns once per stop) leaves it perfectly flat. A
   * monotonic counter of first uploads does not have that blind spot.
   */
  texUploads: number
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
  /** Textures RESIDENT at each end. Flat totals hide a dispose-and-rebuild — see texUploads. */
  textures0: number
  texturesEnd: number
  /** First GPU uploads of the tracked canvas textures (station boards, destination roll). This is the one that survives churn. */
  texUploads0: number
  texUploadsEnd: number
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
  /** GPU resource counts: baseline taken in start(), from the renderer, before the lap draws anything. */
  private programs0 = 0
  private textures0 = 0
  private programsSeen = 0
  private texturesSeen = 0
  private texUploads0 = 0
  private texUploadsSeen = 0
  private shadowFrames = 0
  /** Previous frame's render time, so the interval that merely REPORTS a slow render isn't logged as a second stall. */
  private lastRenderMs = 0
  /** Whether to write the log to storage mid-run — off for short automated runs, where our own disk writes would be a confound. */
  private persistDuringRun = true

  /** Live frame rate for the on-screen counter, smoothed just enough to be readable. */
  fpsNow = 0

  /**
   * `gpu` is the resource baseline read from the renderer BEFORE the first
   * frame of the lap. It is a parameter rather than something inferred from
   * the first sample because that first render is the likeliest of all to
   * compile something, and inferring the baseline from it would hide exactly
   * that.
   */
  start(context: Record<string, unknown>, gpu: { programs: number; textures: number; texUploads: number }, persistDuringRun = true) {
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
    this.programs0 = gpu.programs
    this.textures0 = gpu.textures
    this.texUploads0 = gpu.texUploads
    this.programsSeen = gpu.programs
    this.texturesSeen = gpu.textures
    this.texUploadsSeen = gpu.texUploads
    this.shadowFrames = 0
    this.lastRenderMs = 0
    this.persistDuringRun = persistDuringRun
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
    // The baseline is taken in start(), from the renderer, BEFORE any frame of
    // the lap is drawn. Taking it from the first sample instead would have
    // swallowed whatever that first render compiled — and the first render
    // after pressing record is exactly the one most likely to compile.
    const newPrograms = Math.max(0, s.programs - this.programsSeen)
    const newTexUploads = Math.max(0, s.texUploads - this.texUploadsSeen)
    this.programsSeen = s.programs
    this.texturesSeen = s.textures
    this.texUploadsSeen = s.texUploads
    if (s.shadowPass) this.shadowFrames++

    this.binFrames++
    this.binMs += s.frameMs
    if (s.frameMs > this.binMax) this.binMax = s.frameMs
    if (s.draws > this.binDraws) this.binDraws = s.draws
    if (s.tris > this.binTris) this.binTris = s.tris
    if (s.speedKmh > this.binSpeed) this.binSpeed = s.speedKmh

    // Trigger on EITHER clock. A stall inside render() is visible here one
    // frame before the interval that reports it, and that earlier record is
    // the one holding the resources it consumed.
    const stallMs = Math.max(s.frameMs, s.renderMs)
    // ...but do not book the same stall twice. When a slow render fires a
    // hitch, the next frame's interval necessarily contains it and would
    // record a near-identical entry with no resources attached — the exact
    // pair that made the first version of this look self-contradictory.
    const echoOfLastRender = s.renderMs < HITCH_MS && this.lastRenderMs >= HITCH_MS
    if (stallMs >= HITCH_MS && !echoOfLastRender && this.hitches.length < MAX_HITCHES * 4) {
      this.hitches.push([
        Math.round((now - this.startedAt) / 100) / 10,
        Math.round(s.frameMs),
        Math.round(s.renderMs),
        Math.round(s.progress * 1000),
        s.stationIdx,
        s.draws,
        Math.round(s.tris / 1000),
        newPrograms,
        newTexUploads,
        // What the game was doing in the run-up. A stall with a name is a bug
        // you can fix; a stall without one is a guess.
        this.recentMarks(now - Math.max(s.frameMs, s.renderMs)),
      ])
    }
    this.lastRenderMs = s.renderMs

    if (now - this.binStart >= BIN_MS) this.closeBin(now, s.progress)
    // Survive an iOS tab kill mid-lap: the log is worthless if backgrounding
    // the PWA between the ride and the copy button throws it away.
    // Timed like everything else now. It serializes the whole log and writes
    // it synchronously, and being the one periodic job nobody had measured
    // made it an unfalsifiable suspect for every unexplained stall.
    //
    // Its SYNCHRONOUS cost turned out to be 1 ms at worst — but WebKit backs
    // localStorage with a database it flushes on its own schedule, and that
    // flush would land exactly where the unexplained 310 ms lands: outside
    // every timer we own. A run that cannot be explained must not also be
    // writing 13 KB to disk every five seconds, so short automated runs turn
    // this off and persist once, at the end.
    if (this.persistDuringRun && now - this.lastPersist > 5000) this.time('perf-persist', () => this.persist())
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
    return this.book(tag, fn, true)
  }

  /**
   * Same, but WITHOUT leaving a mark — for things that run every frame.
   *
   * The mark ring holds 48 entries so a hitch can name what happened just
   * before it. Marking a dozen per-frame phases at 60 Hz would overwrite the
   * whole ring sixteen times a second, and every hitch would come back tagged
   * with whatever phase ran last: the instrument would erase the evidence it
   * exists to preserve. The cost still lands in `costs`, where a phase that
   * blocks 320 ms shows up as a max of 320.
   */
  phase<T>(tag: string, fn: () => T): T {
    return this.book(tag, fn, false)
  }

  private book<T>(tag: string, fn: () => T, leaveMark: boolean): T {
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
      if (leaveMark) this.mark(tag)
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
      programs0: this.programs0,
      programsEnd: this.programsSeen,
      textures0: this.textures0,
      texturesEnd: this.texturesSeen,
      texUploads0: this.texUploads0,
      texUploadsEnd: this.texUploadsSeen,
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
      // v4: hitches carry `renderMs` and a texture-upload column, and the
      // resource baseline moved to start(). v3 shipped with those columns
      // misaligned by one frame, so its numbers must not be compared with
      // these — hence a new number rather than a patched meaning.
      v: 4,
      // Which world this lap was driven through. Two laps are only comparable
      // if this matches — before seeding, every reload dealt a different Japan
      // and draw counts could not be told apart from layout luck.
      seed: WORLD_SEED,
      ctx: this.context,
      summary: this.summary,
      // [tSec, frames, meanMs, maxMs, draws, kTris, kmh, progress‰]
      bins: this.bins,
      // [tSec, ms, renderMs, progress‰, station, draws, kTris, programasNuevos, texturasSubidas, tags] — worst first, capped
      // Sorted by the WORSE of the two clocks, not by the interval. A stall
      // caught inside render() has an ordinary `frameMs` by construction, so
      // sorting on that alone would rank the very records that carry the
      // resource evidence below trivial blips — and then the cap would drop
      // them.
      hitches: this.hitches
        .slice()
        .sort((a, b) => Math.max(b[1], b[2]) - Math.max(a[1], a[2]))
        .slice(0, MAX_HITCHES),
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

/**
 * For per-frame phases: books the cost without touching the mark ring.
 *
 * Added after the automated probe came back with eight ~320 ms stalls that had
 * `renderMs` of 4-6 ms and zero new shaders or textures — so the stall is CPU
 * work outside the render, and the only way to find it without guessing again
 * is to time the frame's own phases and see which one's max is 320.
 */
export function perfPhase<T>(tag: string, fn: () => T): T {
  return active ? active.phase(tag, fn) : fn()
}
