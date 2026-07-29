import type { PlayableNote } from '../data/melodies'
import { ATTENTION_CHIME, RETRO_FANFARE } from '../data/melodies'
import { perfMark, perfTime, perfTimeout } from '../game/PerfLog'
import { PA_CLIPS, type PaLang } from '../data/paClips'

export type Timbre = 'bell' | 'chime' | 'attention' | 'retro'
export type AnnounceLang = 'ja' | 'en' | 'es'

/**
 * One piece of a spoken line: either a recorded clip — `'frag:next'`,
 * `'name:kiyomizu'` — or a beat of silence in seconds.
 *
 * Announcements are assembled from fragments the way real JR ones are, which
 * is why thirty stations cost thirty names instead of sixty sentences. The
 * clips and the table that indexes them come out of `npm run pa:build`.
 */
export type PaPiece = string | number

export interface AnnounceSegment {
  lang: AnnounceLang
  pieces: PaPiece[]
}

export interface AnnounceOptions {
  fanfare?: boolean
  /**
   * Checked before the announcement starts AND before each language: an
   * arrival announcement for a station already behind you is worse than
   * silence. Blowing through the loop at speed used to queue them until the
   * PA was two stations out of date.
   */
  valid?: () => boolean
  /**
   * Announcements of the same kind replace each other while waiting in the
   * queue (e.g. a newer "depart" makes a stale queued "depart" pointless),
   * but a playing announcement is never cut off mid-sentence.
   */
  kind?: string
}

interface QueuedAnnouncement {
  segments: AnnounceSegment[]
  fanfare: boolean
  kind: string
  valid?: () => boolean
}

/** Pause between languages within one announcement, and between two queued announcements — breathing room so the PA never feels rushed. */
const SEGMENT_GAP_MS = 750
const ANNOUNCEMENT_GAP_MS = 1400

// A natural, clear masculine voice for English — the retro chiptune fanfare
// and chime already carry the "80s videogame" flavor, so the voice itself
// should just read well (a robotic novelty voice here was tried and vetoed).


/**
 * Almost all sound here is synthesized live with the Web Audio API: the
 * station melodies are original compositions (see data/melodies.ts) and the
 * motor, brakes and room tone are procedural noise, not recordings.
 *
 * The ONE exception is the spoken announcements, and it is worth knowing why
 * the game gave up its "no audio assets to ship" property for them. They used
 * to come from the browser's Web Speech API, which on iOS runs in its own
 * audio session: every time the utterance queue drained, the main thread
 * froze for about a third of a second — measured, once per station, and
 * proven by a cold muted lap that had none of them. It also meant the voice
 * could never enter this graph, so it could not have the platform reverb, the
 * ducking, or the band limiting that makes a tannoy sound like a tannoy.
 *
 * So the voice is recorded now, assembled from fragments the way real JR
 * announcements are, and plays as buffers through the chain below. It costs
 * ~110 KB per language. See scripts/build-pa.mjs.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private dryGain: GainNode | null = null
  private wetSend: GainNode | null = null
  private convolver: ConvolverNode | null = null

  private motorOsc: OscillatorNode | null = null
  private motorFilter: BiquadFilterNode | null = null
  private motorGain: GainNode | null = null
  private noiseSource: AudioBufferSourceNode | null = null
  private noiseFilter: BiquadFilterNode | null = null
  private noiseGain: GainNode | null = null
  private roomToneSource: AudioBufferSourceNode | null = null
  private roomToneFilter: BiquadFilterNode | null = null
  private roomToneGain: GainNode | null = null

  private noiseBuffer: AudioBuffer | null = null
  private bitcrushCurveCache: Float32Array<ArrayBuffer> | null = null

  private motorSubOsc: OscillatorNode | null = null

  private duckUntil = 0
  private melodyLoopHandle: number | null = null
  private autoResumeInstalled = false
  private announcing = false
  private announceQueue: QueuedAnnouncement[] = []
  private currentItem: QueuedAnnouncement | null = null
  /** Bumped on every start/abort so stale callbacks from an old sequence die quietly. */
  private announceEpoch = 0
  /** Head of the announcement voice chain — everything spoken enters here. */
  private paVoiceIn: BiquadFilterNode | null = null
  /** Decoded sprites, keyed `lang:group`. Arcs arrive as the train approaches them. */
  private paSprites = new Map<string, AudioBuffer>()
  private paFetching = new Map<string, Promise<void>>()
  /** Sources of the announcement currently sounding, so a stale one can be cut. */
  private paPlaying: AudioBufferSourceNode[] = []
  private lastAmbientAt = 0
  private jointTimer = 0.8
  private ambNextAt = 0
  private paBedGain: GainNode | null = null
  private crowdGain: GainNode | null = null
  private footstepNextAt = 0
  private stationMurmurGain: GainNode | null = null
  private stationMurmurPanner: StereoPannerNode | null = null
  private rainWashGain: GainNode | null = null
  private rainPatterGain: GainNode | null = null
  /** Kept so the patter can be re-voiced per frame — speed opens it up, doors open it further. */
  private rainPatterFilter: BiquadFilterNode | null = null
  private rainWashFilter: BiquadFilterNode | null = null
  /** The actual looping sources — created when the layer wakes, STOPPED once it has faded out (see sleepLayer). */
  private rainSources: AudioBufferSourceNode[] = []
  private rainStopHandle: number | null = null
  private rainLevel = 0
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private windSource: AudioBufferSourceNode | null = null
  private windStopHandle: number | null = null
  private windLevel = 0
  /** Sea wash for the Kamakura coast stretch — same sleep discipline as the rain. */
  private shoreGain: GainNode | null = null
  private shoreFilter: BiquadFilterNode | null = null
  private shoreSource: AudioBufferSourceNode | null = null
  private shoreStopHandle: number | null = null
  private shoreLevel = 0
  /** All small nature voices route through this bus + lowpass, so rain can genuinely muffle them (not just duck). */
  private natureBus: GainNode | null = null
  private natureLP: BiquadFilterNode | null = null
  /** Season shapes the insect chorus — set from the game, defaults to spring. */
  private season: 'spring' | 'summer' | 'autumn' | 'winter' = 'spring'
  /** 0 = open air, 1 = inside the tunnel: more reverb, louder reflections, weather gone. */
  private tunnelFactor = 0
  /** Master mute: silences the Web Audio graph AND the speech announcements, then suspends the context to save battery. */
  private muted = false
  private muteSuspendHandle: number | null = null

  get ready() {
    return this.ctx !== null
  }

  /**
   * Must be called from a user gesture (tap-to-start) to satisfy mobile
   * autoplay rules. iOS Safari in particular often creates the AudioContext
   * already `suspended` even from a real tap, and separately requires
   * speechSynthesis.speak() to run at least once synchronously inside a
   * gesture before *later* (setTimeout-scheduled) speak() calls are allowed
   * to actually produce sound — so both get an explicit kick here, plus an
   * ongoing safety net in case anything still ends up suspended (e.g. after
   * the phone screen locks and the page comes back).
   */
  unlock() {
    if (this.ctx) {
      this.resumeContext()
      return
    }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.85
    this.master.connect(this.ctx.destination)

    this.dryGain = this.ctx.createGain()
    this.dryGain.gain.value = 1
    this.dryGain.connect(this.master)

    // Nature voices (birds, cicadas, crickets) live behind a shared lowpass:
    // rain rolls the cutoff down so the chorus goes MUFFLED and distant, the
    // way small sounds actually behave under a downpour — the old gain-only
    // duck kept them crisp, just quieter.
    this.natureLP = this.ctx.createBiquadFilter()
    this.natureLP.type = 'lowpass'
    this.natureLP.frequency.value = 16000
    this.natureBus = this.ctx.createGain()
    this.natureBus.connect(this.natureLP)
    this.natureLP.connect(this.dryGain)

    this.convolver = this.ctx.createConvolver()
    this.convolver.buffer = this.buildImpulseResponse()
    this.wetSend = this.ctx.createGain()
    this.wetSend.gain.value = 0.22
    this.wetSend.connect(this.convolver)
    this.convolver.connect(this.master)
    // A touch of the nature chorus reaches the reverb too (birdsong used to).
    const natureWet = this.ctx.createGain()
    natureWet.gain.value = 0.4
    this.natureLP!.connect(natureWet)
    natureWet.connect(this.wetSend)

    // The platform speaker the announcements come out of. Recorded voice can
    // finally go through the graph — the synthesized one never could, because
    // iOS runs it in a separate audio session — so it gets the band limiting
    // that makes a tannoy sound like a tannoy, and the station reverb with it.
    const paHP = this.ctx.createBiquadFilter()
    paHP.type = 'highpass'
    paHP.frequency.value = 300
    const paLP = this.ctx.createBiquadFilter()
    paLP.type = 'lowpass'
    paLP.frequency.value = 3400
    const paPresence = this.ctx.createBiquadFilter()
    paPresence.type = 'peaking'
    paPresence.frequency.value = 1800
    paPresence.Q.value = 0.9
    paPresence.gain.value = 4
    this.paVoiceIn = paHP
    paHP.connect(paLP)
    paLP.connect(paPresence)
    paPresence.connect(this.dryGain)
    paPresence.connect(this.wetSend)

    this.noiseBuffer = this.buildNoiseBuffer()
    this.startAmbientBed()
    this.ensurePaBed()
    // If the weather was already rainy before the tap-to-start unlock, the
    // rain bed has a level waiting for its nodes.
    if (this.rainLevel > 0) this.setRain(this.rainLevel)
    if (this.windLevel > 0) this.setWind(this.windLevel)
    if (this.shoreLevel > 0) this.setShore(this.shoreLevel)

    this.resumeContext()
    this.kickSilentBuffer()
    this.installAutoResume()
    if (this.muted) this.applyMute(true)
  }

  /** Resumes the AudioContext if the platform left it (or put it back) in a suspended state. */
  private resumeContext() {
    if (this.muted) return // a muted engine stays suspended on purpose
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {})
    }
  }

  get isMuted(): boolean {
    return this.muted
  }

  /**
   * The HUD mute switch. More than a gain of zero: speech synthesis renders
   * OUTSIDE the Web Audio graph (a master at 0 would not silence the PA), and
   * a muted context might as well stop burning battery — so announcements are
   * dropped at the door and the context is suspended once the fade lands.
   */
  setMuted(muted: boolean) {
    this.muted = muted
    if (this.ctx) this.applyMute(muted)
  }

  private applyMute(muted: boolean) {
    const ctx = this.ctx!
    if (this.muteSuspendHandle !== null) {
      window.clearTimeout(this.muteSuspendHandle)
      this.muteSuspendHandle = null
    }
    if (muted) {
      this.stopMelodyLoop()
      this.announceQueue.length = 0
      this.abortCurrentAnnouncement()
      this.master!.gain.setTargetAtTime(0, ctx.currentTime, 0.06)
      this.muteSuspendHandle = window.setTimeout(() => {
        if (this.muted) ctx.suspend().catch(() => {})
      }, 350)
    } else {
      ctx.resume().catch(() => {})
      this.master!.gain.setTargetAtTime(0.85, ctx.currentTime, 0.08)
    }
  }

  /** The old "silent 1-sample buffer" trick — belt-and-braces alongside resume() for older iOS/Safari builds. */
  private kickSilentBuffer() {
    if (!this.ctx) return
    const buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    source.start(0)
  }

  /** Keeps retrying resume() on later taps/visibility changes, in case the initial unlock didn't fully take. */
  private installAutoResume() {
    if (this.autoResumeInstalled) return
    this.autoResumeInstalled = true
    const retry = () => this.resumeContext()
    document.addEventListener('visibilitychange', retry)
    window.addEventListener('pageshow', retry)
    document.addEventListener('pointerdown', retry)
  }

  private buildNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 2
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  /** A short synthesized impulse response (exponential-decay filtered noise) standing in for platform reverb. */
  private buildImpulseResponse(): AudioBuffer {
    const ctx = this.ctx!
    const duration = 1.7
    const len = Math.floor(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      let prev = 0
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.4)
        const raw = (Math.random() * 2 - 1) * decay
        prev = prev * 0.35 + raw * 0.65 // gentle lowpass so the tail isn't hissy
        data[i] = prev
      }
    }
    return buffer
  }

  /** A stair-stepped transfer curve (quantizes a clean waveform) for the retro/chiptune timbre — an 8-bit "feel" without any loss of clarity. */
  private bitcrushCurve(): Float32Array<ArrayBuffer> {
    if (this.bitcrushCurveCache) return this.bitcrushCurveCache
    const steps = 5
    const n = 512
    const curve = new Float32Array(new ArrayBuffer(n * 4))
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = Math.round(x * steps) / steps
    }
    this.bitcrushCurveCache = curve
    return curve
  }

  private startAmbientBed() {
    const ctx = this.ctx!
    // Motor hum: a triangle fundamental plus a sine an octave below, through
    // a gentle lowpass — rounder and warmer than the old raw sawtooth, which
    // read as an angry buzz rather than a traction motor.
    this.motorOsc = ctx.createOscillator()
    this.motorOsc.type = 'triangle'
    this.motorOsc.frequency.value = 60
    this.motorSubOsc = ctx.createOscillator()
    this.motorSubOsc.type = 'sine'
    this.motorSubOsc.frequency.value = 30
    this.motorFilter = ctx.createBiquadFilter()
    this.motorFilter.type = 'lowpass'
    this.motorFilter.frequency.value = 200
    this.motorGain = ctx.createGain()
    this.motorGain.gain.value = 0
    this.motorOsc.connect(this.motorFilter)
    this.motorSubOsc.connect(this.motorFilter)
    this.motorFilter.connect(this.motorGain)
    this.motorGain.connect(this.master!)
    this.motorOsc.start()
    this.motorSubOsc.start()

    // Rolling wheel/rail noise bed.
    this.noiseSource = ctx.createBufferSource()
    this.noiseSource.buffer = this.noiseBuffer
    this.noiseSource.loop = true
    this.noiseFilter = ctx.createBiquadFilter()
    this.noiseFilter.type = 'bandpass'
    this.noiseFilter.frequency.value = 400
    this.noiseFilter.Q.value = 0.7
    this.noiseGain = ctx.createGain()
    this.noiseGain.gain.value = 0
    this.noiseSource.connect(this.noiseFilter)
    this.noiseFilter.connect(this.noiseGain)
    this.noiseGain.connect(this.master!)
    this.noiseSource.start()

    // Platform "room tone" — reuses the same noise buffer, band-limited to a
    // distant-murmur range, gated on by stillness rather than always-on so it
    // doesn't compete with the motor/rail bed while running.
    this.roomToneSource = ctx.createBufferSource()
    this.roomToneSource.buffer = this.noiseBuffer
    this.roomToneSource.loop = true
    this.roomToneFilter = ctx.createBiquadFilter()
    this.roomToneFilter.type = 'bandpass'
    this.roomToneFilter.frequency.value = 550
    this.roomToneFilter.Q.value = 0.5
    this.roomToneGain = ctx.createGain()
    this.roomToneGain.gain.value = 0
    this.roomToneSource.connect(this.roomToneFilter)
    this.roomToneFilter.connect(this.roomToneGain)
    this.roomToneGain.connect(this.master!)
    this.roomToneSource.start()
  }

  /**
   * speed01: 0..1 fraction of top speed. brakeAmount: 0..1 how hard braking.
   * hour: game time of day, drives the nature/city soundscape. crowd: 0..1
   * how much boarding bustle to play (doors-open amount).
   */
  updateAmbient(speed01: number, brakeAmount: number, hour = 12, crowd = 0, stationMurmur = 0, stationPan = 0) {
    // Muted = suspended context: currentTime is frozen, so every
    // setTargetAtTime would pile un-pruned automation events for the whole
    // silence (Diego's round-1 catch) — the opposite of the battery win.
    if (!this.ctx || this.muted) return
    const t = this.ctx.currentTime
    const dt = Math.min(Math.max(t - this.lastAmbientAt, 0), 0.1)
    this.lastAmbientAt = t
    const eased = Math.pow(speed01, 0.6)
    const ducked = t < this.duckUntil
    const duckMul = ducked ? 0.5 : 1
    // The lining throws the train's own sound straight back at the cab.
    const tunnelBoost = 1 + 0.55 * this.tunnelFactor

    // Softer motor: lower ceiling than before, and the sub follows an octave down.
    this.motorOsc?.frequency.setTargetAtTime(55 + eased * 190, t, 0.08)
    this.motorSubOsc?.frequency.setTargetAtTime((55 + eased * 190) / 2, t, 0.08)
    this.motorFilter?.frequency.setTargetAtTime(130 + eased * 640, t, 0.08)
    this.motorGain?.gain.setTargetAtTime(speed01 > 0.01 ? (0.045 + eased * 0.095) * duckMul * tunnelBoost : 0, t, 0.15)

    this.noiseFilter?.frequency.setTargetAtTime(300 + eased * 2200, t, 0.1)
    this.noiseGain?.gain.setTargetAtTime(speed01 > 0.01 ? (0.02 + eased * 0.055) * duckMul * tunnelBoost : 0, t, 0.15)

    if (brakeAmount > 0.55 && speed01 > 0.03 && speed01 < 0.5) {
      this.noiseFilter?.frequency.setTargetAtTime(1800 + brakeAmount * 1500, t, 0.05)
      this.noiseGain?.gain.setTargetAtTime((0.05 + brakeAmount * 0.1) * duckMul, t, 0.05)
    }

    const stillness = 1 - Math.min(1, speed01 * 6)
    this.roomToneGain?.gain.setTargetAtTime(0.03 * stillness * duckMul, t, 0.4)

    // `crowd` is how far the doors are open (the caller's name for it) —
    // the weather bed cares about that as much as the platform noise does.
    this.updateWeatherBed(t, speed01, crowd, ducked)

    this.updateRailJoints(dt, speed01, duckMul)
    this.updateTimeAmbience(t, hour, speed01, duckMul)
    this.updateCrowd(t, hour, crowd, duckMul)
    this.updateStationMurmur(t, hour, stationMurmur, stationPan, duckMul)
  }

  /**
   * Re-voices rain and wind every frame. Two things decide how weather
   * SOUNDS from inside a train, and neither is the weather itself:
   *
   * - Speed. Standing at a platform you hear the rain out there — a wash,
   *   soft and distant. Running, the drops arrive ON the cab: the patter
   *   band takes over and opens up in frequency. Same rain, different seat.
   * - Doors. Open them and the outside floods in, brighter and louder;
   *   close them and the glass puts it back behind a wall. This is the
   *   moment the weather is loudest in the whole game.
   *
   * The PA duck applies here too — gentler than on the motor, so a storm
   * still breathes underneath an announcement instead of vanishing.
   */
  private updateWeatherBed(t: number, speed01: number, doorsOpen: number, ducked: boolean) {
    const duck = ducked ? 0.65 : 1
    const open = 1 + 0.55 * doorsOpen
    if (this.rainLevel > 0 && this.rainWashGain && this.rainPatterGain) {
      // A statistically constant level is something the ear deletes in
      // minutes, so the wash breathes on a slow ±20% swell.
      const swell = 1 + 0.2 * Math.sin(t * 0.44)
      this.rainWashGain.gain.setTargetAtTime(this.rainLevel * 0.05 * swell * open * duck, t, 0.6)
      this.rainPatterGain.gain.setTargetAtTime(this.rainLevel * 0.016 * (1 + 1.2 * speed01) * open * duck, t, 0.35)
      this.rainPatterFilter?.frequency.setTargetAtTime(3200 + speed01 * 2400 + doorsOpen * 700, t, 0.4)
    }
    if (this.windLevel > 0 && this.windGain) {
      // Two detuned sines: gusts that never land on the same beat twice.
      const gust = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.23) * Math.cos(t * 0.07))
      this.windGain.gain.setTargetAtTime(this.windLevel * 0.055 * gust * open * duck, t, 0.7)
      // The gust whistles as it rises, and the cab's own slipstream adds to it.
      this.windFilter?.frequency.setTargetAtTime(380 + gust * 520 + speed01 * 340, t, 0.6)
    }
    if (this.shoreLevel > 0 && this.shoreGain) {
      // Waves breathe far slower than rain — the ~13-second swell of surf.
      // Ducked under rain (three noise beds stacked in 300-850 Hz read as
      // one mud otherwise), and the filter opens toward ~1.2 kHz on the
      // crest so the foam gets its "shhh" instead of reading as traffic.
      const swell = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.48) * Math.sin(t * 0.31 + 1.2))
      const rainDuck = 1 - 0.6 * Math.min(1, this.rainLevel)
      this.shoreGain.gain.setTargetAtTime(this.shoreLevel * 0.055 * swell * open * duck * rainDuck, t, 0.9)
      // Squared crest: the retreating wave sinks to a distant ~320 Hz rumble
      // and the foam's "shhh" blooms only on the crest itself — linear left
      // the trough at ~800 Hz, close enough to traffic to blur the swell
      // (Diego, round 2).
      const crest = (swell - 0.55) / 0.45
      this.shoreFilter?.frequency.setTargetAtTime(320 + crest * crest * 880, t, 0.8)
    }
  }

  /**
   * Positional platform murmur: swells as the cab nears a station, panned
   * toward the platform side, and scaled by how busy that station is (the
   * caller folds in landmark status; the rush-hour curve is applied here).
   */
  private updateStationMurmur(t: number, hour: number, level: number, pan: number, duckMul: number) {
    const ctx = this.ctx!
    if (!this.stationMurmurGain) perfTime('a:src-murmur', () => {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer
      src.loop = true
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 540
      bp.Q.value = 0.7
      this.stationMurmurGain = ctx.createGain()
      this.stationMurmurGain.gain.value = 0
      this.stationMurmurPanner = ctx.createStereoPanner()
      src.connect(bp)
      bp.connect(this.stationMurmurGain)
      this.stationMurmurGain.connect(this.stationMurmurPanner)
      this.stationMurmurPanner.connect(this.dryGain!)
      this.stationMurmurPanner.connect(this.wetSend!)
      src.start()
    })
    const rush = this.rushFactor(hour)
    // `!` because the assignment above now happens inside a timed callback,
    // which is opaque to the narrowing — it is still assigned by this point.
    this.stationMurmurGain!.gain.setTargetAtTime(level * (0.35 + 0.65 * rush) * 0.05 * duckMul, t, 0.35)
    this.stationMurmurPanner!.pan.setTargetAtTime(pan, t, 0.3)
  }

  setSeason(season: 'spring' | 'summer' | 'autumn' | 'winter') {
    this.season = season
  }

  /**
   * Rain bed: a broadband wash (lowpassed noise) plus a bright patter band —
   * both looping the shared noise buffer, faded by level. The MIX between the
   * two layers is not set here: updateWeatherBed() re-voices it every frame
   * from the train's speed and doors (see the note there).
   *
   * SLEEP DISCIPLINE (the panel's ask): the filter/gain chain is persistent,
   * but the looping SOURCES are stopped a few seconds after the level hits 0
   * and recreated on demand — a clear afternoon no longer drags two silent
   * buffer loops through the whole session. The start() cost only ever lands
   * on a weather change, never on the per-station hot path.
   */
  setRain(level01: number) {
    this.rainLevel = level01
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    if (!this.rainWashGain) {
      // Persistent half of the chain, built once.
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 850
      this.rainWashFilter = lp
      this.rainWashGain = ctx.createGain()
      this.rainWashGain.gain.value = 0
      lp.connect(this.rainWashGain)
      this.rainWashGain.connect(this.master)

      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 3600
      bp.Q.value = 0.6
      this.rainPatterFilter = bp
      this.rainPatterGain = ctx.createGain()
      this.rainPatterGain.gain.value = 0
      bp.connect(this.rainPatterGain)
      this.rainPatterGain.connect(this.master)
    }
    if (level01 > 0) {
      if (this.rainStopHandle !== null) {
        window.clearTimeout(this.rainStopHandle)
        this.rainStopHandle = null
      }
      if (this.rainSources.length === 0) perfTime('a:src-rain', () => {
        const wash = ctx.createBufferSource()
        wash.buffer = this.noiseBuffer
        wash.loop = true
        wash.connect(this.rainWashFilter!)
        wash.start()
        const patter = ctx.createBufferSource()
        patter.buffer = this.noiseBuffer
        patter.loop = true
        patter.playbackRate.value = 1.31 // detune vs the wash so the two layers never phase-lock
        patter.connect(this.rainPatterFilter!)
        patter.start()
        this.rainSources.push(wash, patter)
      })
    } else if (this.rainSources.length > 0 && this.rainStopHandle === null) {
      // Let the 1.2 s fade land first, then genuinely stop the loops.
      this.rainStopHandle = perfTimeout('a:tmr-rain-stop', () => {
        this.rainStopHandle = null
        if (this.rainLevel > 0) return // weather turned again while fading
        for (const src of this.rainSources) {
          try { src.stop() } catch { /* already stopped */ }
          src.disconnect()
        }
        this.rainSources.length = 0
      }, 3000)
    }
    // Slow fades: weather rolls in, it doesn't switch.
    this.rainWashGain.gain.setTargetAtTime(level01 * 0.05, t, 1.2)
    this.rainPatterGain!.gain.setTargetAtTime(level01 * 0.016, t, 1.2)
    // The nature chorus goes muffled under rain: the shared lowpass closes
    // from wide open down toward 2.4 kHz as the rain gets serious.
    this.natureLP?.frequency.setTargetAtTime(16000 - 13600 * Math.min(1, level01 * 1.3), t, 0.8)
  }

  /**
   * Storm wind: a low, wide noise bed with its own gust life. This is the
   * voice a ventisca has and a nevada doesn't — snow itself is silent, so
   * without wind a blizzard sounds exactly like a clear winter afternoon.
   * Level is stored here; the gusting happens per frame in updateWeatherBed.
   * Sleeps like the rain: the source stops once the level has faded to 0.
   */
  setWind(level01: number) {
    this.windLevel = level01
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    if (!this.windGain) {
      this.windFilter = ctx.createBiquadFilter()
      this.windFilter.type = 'bandpass'
      this.windFilter.frequency.value = 480
      this.windFilter.Q.value = 0.5
      this.windGain = ctx.createGain()
      this.windGain.gain.value = 0
      this.windFilter.connect(this.windGain)
      this.windGain.connect(this.master)
    }
    if (level01 > 0) {
      if (this.windStopHandle !== null) {
        window.clearTimeout(this.windStopHandle)
        this.windStopHandle = null
      }
      if (!this.windSource) perfTime('a:src-wind', () => {
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer
        src.loop = true
        src.playbackRate.value = 0.62 // slower than the rain layers: wind is a bigger, lazier noise
        src.connect(this.windFilter!)
        src.start()
        this.windSource = src
      })
    } else {
      this.windGain.gain.setTargetAtTime(0, ctx.currentTime, 1.4)
      if (this.windSource && this.windStopHandle === null) {
        this.windStopHandle = perfTimeout('a:tmr-wind-stop', () => {
          this.windStopHandle = null
          if (this.windLevel > 0 || !this.windSource) return
          try { this.windSource.stop() } catch { /* already stopped */ }
          this.windSource.disconnect()
          this.windSource = null
        }, 3600)
      }
    }
  }

  /**
   * The sea, for the Kamakura coast stretch: a deep, slow wash that only
   * exists while the train is near the water (and mostly when it is slow
   * enough to hear anything past its own motor). Same sleep rules as the
   * rain — inland, this layer is not merely silent, it is OFF.
   */
  setShore(level01: number) {
    this.shoreLevel = level01
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    if (!this.shoreGain) {
      this.shoreFilter = ctx.createBiquadFilter()
      this.shoreFilter.type = 'lowpass'
      this.shoreFilter.frequency.value = 420
      this.shoreGain = ctx.createGain()
      this.shoreGain.gain.value = 0
      this.shoreFilter.connect(this.shoreGain)
      this.shoreGain.connect(this.master)
    }
    if (level01 > 0) {
      if (this.shoreStopHandle !== null) {
        window.clearTimeout(this.shoreStopHandle)
        this.shoreStopHandle = null
      }
      if (!this.shoreSource) perfTime('a:src-shore', () => {
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer
        src.loop = true
        src.playbackRate.value = 0.48 // the sea is the biggest, laziest noise of all
        src.connect(this.shoreFilter!)
        src.start()
        this.shoreSource = src
      })
    } else {
      this.shoreGain.gain.setTargetAtTime(0, ctx.currentTime, 1.6)
      if (this.shoreSource && this.shoreStopHandle === null) {
        this.shoreStopHandle = perfTimeout('a:tmr-shore-stop', () => {
          this.shoreStopHandle = null
          if (this.shoreLevel > 0 || !this.shoreSource) return
          try { this.shoreSource.stop() } catch { /* already stopped */ }
          this.shoreSource.disconnect()
          this.shoreSource = null
        }, 4200)
      }
    }
  }

  /**
   * Inside the tunnel the world changes shape: every sound the train makes
   * comes straight back off the lining (more reverb, louder motor bed), and
   * the sky's voices are simply gone — the caller already zeroes rain/wind,
   * this handles what the tunnel ADDS.
   */
  setTunnel(f01: number) {
    this.tunnelFactor = f01
    if (!this.ctx || !this.wetSend) return
    this.wetSend.gain.setTargetAtTime(0.22 + 0.36 * f01, this.ctx.currentTime, 0.4)
  }

  /**
   * The pressure event of crossing a portal at speed: a 300 ms swell of
   * lowpassed noise with a soft thump under it. Same one-shot pattern as
   * railClack (which starts a fresh source every second of cruising), so it
   * adds nothing new to the iOS start() hot-path story — and it turns the
   * tunnel from a crossfade into an EVENT (Aiko, round 1).
   */
  tunnelWhoosh(entering: boolean, speed01: number) {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime + 0.01
    const vol = (0.05 + 0.1 * speed01) * (entering ? 1 : 0.8)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.playbackRate.value = 0.7
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    // Entering: the world closes in (filter slams shut). Leaving: it opens.
    lp.frequency.setValueAtTime(entering ? 1600 : 500, t)
    lp.frequency.exponentialRampToValueAtTime(entering ? 500 : 1600, t + 0.3)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.09)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    src.connect(lp)
    lp.connect(g)
    g.connect(this.master)
    g.connect(this.wetSend!)
    src.start(t)
    src.stop(t + 0.4)
    // The thump: the cab's own body flexing through the pressure step.
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(64, t)
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.16)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(vol * 0.8, t + 0.02)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
    osc.connect(og)
    og.connect(this.master)
    osc.start(t)
    osc.stop(t + 0.24)
  }

  /**
   * One thunderclap, scheduled `delay` seconds out — the gap between the
   * flash and the sound IS the distance, so the caller times it, not us.
   * `strength` 0..1 shapes what arrives: a far strike is all low rumble with
   * a long tail, a near one leads with a bright crack.
   */
  thunder(strength: number, delay: number) {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.muted) return
    const ctx = this.ctx
    const at = ctx.currentTime + Math.max(0, delay)
    const near = Math.min(1, Math.max(0, strength))
    const body = 2.2 + (1 - near) * 3.4 // far thunder rolls for much longer
    // Loud relative to the rain bed (0.05) on purpose — thunder is the one
    // sound in the game that's allowed to be bigger than the train. UNDER
    // the city, though, the storm is a rumor: the lining eats the clap
    // (Diego's round-1 catch — full-volume thunder into a 0.58 wet send
    // inside a tunnel where every other weather voice is at zero).
    const vol = (0.07 + near * 0.15) * (1 - 0.85 * this.tunnelFactor)

    // Rumble: noise dragged through a lowpass that closes as it decays, so
    // the tail gets darker the way real thunder does rolling off the city.
    const rumble = ctx.createBufferSource()
    rumble.buffer = this.noiseBuffer
    rumble.loop = true
    rumble.playbackRate.value = 0.35 + Math.random() * 0.15
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(220 + near * 420, at)
    lp.frequency.exponentialRampToValueAtTime(70, at + body)
    lp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    // Rolls IN over a beat when far, slams when near.
    g.gain.exponentialRampToValueAtTime(vol, at + 0.06 + (1 - near) * 0.5)
    // Two swells inside the decay keep it from sounding like one noise fade.
    g.gain.exponentialRampToValueAtTime(vol * 0.45, at + body * 0.35)
    g.gain.exponentialRampToValueAtTime(vol * 0.7, at + body * 0.55)
    g.gain.exponentialRampToValueAtTime(0.0001, at + body)
    rumble.connect(lp)
    lp.connect(g)
    g.connect(this.master)
    g.connect(this.wetSend!)
    rumble.start(at)
    rumble.stop(at + body + 0.2)

    // The crack, only for strikes close enough to have one — and never
    // underground, where only the rumble makes it through.
    if (near > 0.45 && this.tunnelFactor < 0.5) {
      const crack = ctx.createBufferSource()
      crack.buffer = this.noiseBuffer
      crack.playbackRate.value = 1.4
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 900
      const cg = ctx.createGain()
      const cvol = (near - 0.45) * 0.22
      cg.gain.setValueAtTime(0.0001, at)
      cg.gain.linearRampToValueAtTime(cvol, at + 0.012)
      cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)
      crack.connect(hp)
      hp.connect(cg)
      cg.connect(this.master)
      cg.connect(this.wetSend!)
      crack.start(at)
      crack.stop(at + 0.6)
    }
  }

  /** Rough crowd curve — peaks at the morning/evening rush, quiet overnight. */
  private rushFactor(hour: number): number {
    const proximity = (center: number, width: number) => Math.max(0, 1 - Math.abs(((hour - center + 36) % 24) - 12) / width)
    return Math.max(proximity(8, 2.5), proximity(18, 2.5))
  }

  /** The da-dum of rail joints: paired soft clacks whose cadence tracks speed. */
  private updateRailJoints(dt: number, speed01: number, duckMul: number) {
    if (speed01 < 0.06) return
    this.jointTimer -= dt
    if (this.jointTimer > 0) return
    this.jointTimer = Math.min(Math.max(1.7 - speed01 * 1.15, 0.55), 1.7)
    const t = this.ctx!.currentTime
    const vol = (0.03 + speed01 * 0.05) * duckMul
    this.railClack(t + 0.01, vol)
    this.railClack(t + 0.105, vol * 0.85)
  }

  private railClack(when: number, vol: number) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.playbackRate.value = 0.8 + Math.random() * 0.3
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 320 + Math.random() * 120
    filter.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(vol, when + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.master!)
    src.start(when)
    src.stop(when + 0.09)
  }

  /**
   * Nature/city soundscape by game hour, loudest when the train is still:
   * dawn songbirds, daytime cicadas, evening higurashi, night crickets.
   */
  private updateTimeAmbience(t: number, hour: number, speed01: number, duckMul: number) {
    if (t < this.ambNextAt) return
    const still = 1 - Math.min(1, speed01 * 0.85)
    const vol = still * duckMul * (1 - 0.9 * this.tunnelFactor)
    if (vol < 0.15) {
      this.ambNextAt = t + 1.2
      return
    }
    // Rain pushes the small voices into the distance — floored, not muted:
    // insects under rain sound far away, they don't cease to exist.
    const rainMute = Math.max(0.25, 1 - this.rainLevel * 1.2)
    // The seasonal chorus: winter is hushed (dawn birds only), spring is
    // birdsong (a cicada in April would be as impossible as October sakura,
    // and without the director's licence), summer howls with cicadas,
    // autumn belongs to the bell crickets.
    const winter = this.season === 'winter'
    if (hour >= 4.5 && hour < 9) {
      this.playBirdChirp(t, 0.032 * vol * rainMute * (winter ? 0.5 : 1))
      this.ambNextAt = t + (winter ? 3.2 : 1.6) + Math.random() * 3.4
    } else if (winter) {
      // Snow hush — the countryside goes quiet outside the dawn chorus.
      this.ambNextAt = t + 3
    } else if (hour >= 9 && hour < 17) {
      if (this.season === 'spring') {
        this.playBirdChirp(t, 0.02 * vol * rainMute)
        this.ambNextAt = t + 2.6 + Math.random() * 4
      } else {
        this.playCicada(t, 0.014 * (this.season === 'summer' ? 2.1 : 0.15) * vol * rainMute)
        this.ambNextAt = t + (this.season === 'summer' ? 1.3 : 2.2) + Math.random() * 3.6
      }
    } else if (hour >= 17 && hour < 19.5) {
      this.playHigurashi(t, 0.022 * vol * rainMute * (this.season === 'summer' ? 1.4 : 1))
      this.ambNextAt = t + 2.6 + Math.random() * 3.2
    } else if (this.season === 'autumn') {
      this.playSuzumushi(t, 0.024 * vol * rainMute)
      this.ambNextAt = t + 0.9 + Math.random() * 1.3
    } else {
      this.playCrickets(t, 0.02 * vol * rainMute)
      this.ambNextAt = t + 0.9 + Math.random() * 1.4
    }
  }

  /** 2–4 quick upward sine sweeps — a generic songbird, uguisu-adjacent. */
  private playBirdChirp(when: number, vol: number) {
    const ctx = this.ctx!
    const n = 2 + Math.floor(Math.random() * 3)
    let start = when + 0.02
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const f0 = 2200 + Math.random() * 900
      osc.frequency.setValueAtTime(f0, start)
      osc.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.3), start + 0.07)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(vol, start + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.1)
      osc.connect(g)
      g.connect(this.natureBus!)
      osc.start(start)
      osc.stop(start + 0.12)
      start += 0.1 + Math.random() * 0.12
    }
  }

  /** A short pulsing high noise band — distant summer cicadas. */
  private playCicada(when: number, vol: number) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 5200
    filter.Q.value = 9
    const g = ctx.createGain()
    const dur = 0.7 + Math.random() * 0.9
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(vol, when + 0.15)
    g.gain.setTargetAtTime(0, when + dur, 0.12)
    // Tremolo: the churring pulse.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 19 + Math.random() * 8
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = vol * 0.5
    lfo.connect(lfoGain)
    lfoGain.connect(g.gain)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.natureBus!)
    src.start(when)
    src.stop(when + dur + 0.6)
    lfo.start(when)
    lfo.stop(when + dur + 0.6)
  }

  /** Descending "kana-kana" glides — the evening higurashi cicada. */
  private playHigurashi(when: number, vol: number) {
    const ctx = this.ctx!
    let start = when
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(3800 - i * 180, start)
      osc.frequency.exponentialRampToValueAtTime(3100 - i * 180, start + 0.32)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(vol, start + 0.04)
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.38)
      osc.connect(g)
      g.connect(this.natureBus!)
      osc.start(start)
      osc.stop(start + 0.42)
      start += 0.42
    }
  }

  /** Triplet pulses of a high sine — crickets after dark. */
  private playCrickets(when: number, vol: number) {
    const ctx = this.ctx!
    let start = when + 0.02
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 4100 + Math.random() * 250
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(vol, start + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.045)
      osc.connect(g)
      g.connect(this.natureBus!)
      osc.start(start)
      osc.stop(start + 0.06)
      start += 0.07
    }
  }

  /**
   * The autumn bell cricket (suzumushi): two longer ~4.5 kHz pulses with a
   * slow vibrato — the "rin, rin" that owns Japanese autumn nights, distinct
   * from the generic cricket's dry triplet.
   */
  private playSuzumushi(when: number, vol: number) {
    const ctx = this.ctx!
    let start = when + 0.02
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 4400 + Math.random() * 220
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 26 + Math.random() * 8
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 55
      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(vol, start + 0.02)
      g.gain.setValueAtTime(vol, start + 0.08)
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.14)
      osc.connect(g)
      g.connect(this.natureBus!)
      osc.start(start)
      osc.stop(start + 0.16)
      lfo.start(start)
      lfo.stop(start + 0.16)
      start += 0.24
    }
  }

  /** Pneumatic hiss + clunk of the doors; `open` alters the envelope slightly. */
  playDoorCycle(open: boolean) {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime + 0.02
    const hiss = ctx.createBufferSource()
    hiss.buffer = this.noiseBuffer
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1400
    const hg = ctx.createGain()
    const hissDur = open ? 0.45 : 0.6
    hg.gain.setValueAtTime(0, t)
    hg.gain.linearRampToValueAtTime(0.07, t + 0.05)
    hg.gain.exponentialRampToValueAtTime(0.0001, t + hissDur)
    hiss.connect(hp)
    hp.connect(hg)
    hg.connect(this.dryGain!)
    hg.connect(this.wetSend!)
    hiss.start(t)
    hiss.stop(t + hissDur + 0.1)

    const clunkAt = (when: number, vol: number) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(110, when)
      osc.frequency.exponentialRampToValueAtTime(65, when + 0.07)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, when)
      g.gain.linearRampToValueAtTime(vol, when + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.11)
      osc.connect(g)
      g.connect(this.dryGain!)
      g.connect(this.wetSend!)
      osc.start(when)
      osc.stop(when + 0.14)
    }
    if (open) clunkAt(t + hissDur - 0.04, 0.11)
    else {
      clunkAt(t + hissDur - 0.05, 0.1)
      clunkAt(t + hissDur + 0.04, 0.13)
    }
  }

  /** Boarding bustle while the doors are open: vocal-band murmur + scattered footsteps, scaled by the rush-hour curve. */
  private updateCrowd(t: number, hour: number, crowd: number, duckMul: number) {
    const ctx = this.ctx!
    if (!this.crowdGain) {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer
      src.loop = true
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 620
      bp.Q.value = 0.9
      this.crowdGain = ctx.createGain()
      this.crowdGain.gain.value = 0
      src.connect(bp)
      bp.connect(this.crowdGain)
      this.crowdGain.connect(this.dryGain!)
      this.crowdGain.connect(this.wetSend!)
      src.start()
    }
    const level = crowd * (0.35 + 0.65 * this.rushFactor(hour))
    this.crowdGain.gain.setTargetAtTime(level * 0.045 * duckMul, t, 0.3)

    if (level > 0.15 && t >= this.footstepNextAt) {
      this.footstepNextAt = t + 0.12 + Math.random() * 0.35 / Math.max(level, 0.25)
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer
      src.playbackRate.value = 0.5 + Math.random() * 0.3
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 260 + Math.random() * 140
      const g = ctx.createGain()
      const vol = (0.02 + Math.random() * 0.025) * level * duckMul
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(vol, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
      const pan = ctx.createStereoPanner()
      pan.pan.value = (Math.random() - 0.5) * 1.2
      src.connect(lp)
      lp.connect(g)
      g.connect(pan)
      pan.connect(this.dryGain!)
      src.start(t)
      src.stop(t + 0.1)
    }
  }

  /** Ducks the motor/rail/room-tone bed for `seconds` so melodies and announcements read clearly. */
  private duckFor(seconds: number) {
    if (!this.ctx) return
    this.duckUntil = Math.max(this.duckUntil, this.ctx.currentTime + seconds)
  }

  playMelody(notes: PlayableNote[], timbre: Timbre = 'bell', volume = 0.5): number {
    if (!this.ctx || !this.master || this.muted) return 0
    let t = this.ctx.currentTime + 0.02
    for (const note of notes) {
      if (note.freq) this.pluck(note.freq, t, note.duration, timbre, volume)
      t += note.duration
    }
    const duration = t - this.ctx.currentTime
    this.duckFor(duration + 0.3)
    return duration
  }

  /** Loops a melody (with a short pause between repeats) until stopMelodyLoop() is called — e.g. while doors are open. */
  startMelodyLoop(notes: PlayableNote[], timbre: Timbre = 'bell', volume = 0.42) {
    this.stopMelodyLoop()
    const playOnce = () => {
      const duration = this.playMelody(notes, timbre, volume) || 1
      this.melodyLoopHandle = window.setTimeout(playOnce, (duration + 0.7) * 1000)
    }
    playOnce()
  }

  /** Lets any currently-sounding notes ring out naturally; only cancels the *next* scheduled repeat. */
  stopMelodyLoop() {
    if (this.melodyLoopHandle !== null) {
      window.clearTimeout(this.melodyLoopHandle)
      this.melodyLoopHandle = null
    }
  }

  private pluck(freq: number, startTime: number, duration: number, timbre: Timbre, volume: number) {
    const ctx = this.ctx!
    const isPercussive = timbre === 'attention' || timbre === 'retro'
    const attack = isPercussive ? 0.003 : 0.008
    const release = isPercussive ? Math.min(Math.max(duration * 0.8, 0.09), 0.22) : Math.max(duration * 0.9, 0.15)
    const stopAt = startTime + attack + release + 0.1

    const envelope = (peak: number, rel: number) => {
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, startTime)
      g.gain.linearRampToValueAtTime(peak, startTime + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + rel)
      g.connect(this.dryGain!)
      g.connect(this.wetSend!)
      return g
    }

    if (timbre === 'attention') {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(envelope(volume, release))
      osc.start(startTime)
      osc.stop(stopAt)
      return
    }

    if (timbre === 'retro') {
      // A clean square wave through a stair-stepped shaper — the classic
      // 8-bit/chiptune arpeggio timbre, snappy and bright rather than muddy.
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = freq
      const shaper = ctx.createWaveShaper()
      shaper.curve = this.bitcrushCurve()
      osc.connect(shaper)
      shaper.connect(envelope(volume, release))
      osc.start(startTime)
      osc.stop(stopAt)
      return
    }

    // A pair of slightly detuned, oppositely-panned fundamentals gives the
    // note some width/chorus instead of a single dead-centered mono tone.
    const fundamentalEnv = envelope(volume, release)
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator()
      osc.type = timbre === 'bell' ? 'sine' : 'triangle'
      osc.frequency.value = freq
      osc.detune.value = detune
      const panner = ctx.createStereoPanner()
      panner.pan.value = detune > 0 ? 0.22 : -0.22
      osc.connect(panner)
      panner.connect(fundamentalEnv)
      osc.start(startTime)
      osc.stop(stopAt)
    }

    // Inharmonic partials (bell/glockenspiel character), decaying faster than the fundamental.
    const partialRatios = timbre === 'bell' ? [2.76, 4.2] : [2.0]
    const partialPeak = timbre === 'bell' ? volume * 0.3 : volume * 0.15
    const partialEnv = envelope(partialPeak, release * (timbre === 'bell' ? 0.55 : 0.6))
    for (const ratio of partialRatios) {
      const partial = ctx.createOscillator()
      partial.type = 'sine'
      partial.frequency.value = freq * ratio
      partial.connect(partialEnv)
      partial.start(startTime)
      partial.stop(stopAt)
    }
  }

  /**
   * Queues a PA announcement: an optional retro chiptune fanfare, an
   * attention chime, then each segment spoken in order with a breathing
   * pause between languages. Announcements NEVER cut each other off —
   * if one is already playing, the new one waits its turn (with a longer
   * pause between announcements), and while waiting, a newer announcement
   * of the same `kind` replaces the stale queued one. Each segment has a
   * fallback timer in case the browser never fires `onend`. Entirely
   * asynchronous — never blocks the game loop or player input.
   */
  announce(segments: AnnounceSegment[], opts: AnnounceOptions = {}) {
    // `segments` may be EMPTY on purpose: the "no voice" setting keeps the
    // chime and the PA bed and says nothing. That path never touches
    // speechSynthesis at all, which is also what isolates it as a suspect —
    // the per-station freezes all land on the announcement's teardown.
    if (!this.ctx || this.muted) return
    const item: QueuedAnnouncement = { segments, fanfare: !!opts.fanfare, kind: opts.kind ?? 'general', valid: opts.valid }
    if (this.announcing) {
      // A newer announcement of the same kind makes the playing one stale, so
      // cut it off rather than letting the queue drift out of sync with the
      // world. `valid` is what decides — the caller knows which station it
      // was about.
      if (this.currentItem?.kind === item.kind && this.currentItem.valid && !this.currentItem.valid()) {
        this.abortCurrentAnnouncement()
        this.playAnnouncement(item)
        return
      }
      const queuedIdx = this.announceQueue.findIndex((q) => q.kind === item.kind)
      if (queuedIdx >= 0) this.announceQueue[queuedIdx] = item
      else if (this.announceQueue.length < 3) this.announceQueue.push(item)
      else this.announceQueue[this.announceQueue.length - 1] = item
      return
    }
    this.playAnnouncement(item)
  }

  get isAnnouncing(): boolean {
    return this.announcing
  }

  /**
   * PA "speaker" dressing: the Web Speech API renders outside the Web Audio
   * graph, so true reverb on the voice itself is impossible — instead a soft
   * speaker-band hiss opens with a keying click and stays under the whole
   * announcement, which reads as "coming through the train's PA".
   */
  /**
   * The PA's carrier hiss. Built ONCE and left running at gain 0 — it used to
   * be created and started per announcement, which put an
   * AudioBufferSourceNode.start() on the main thread at the exact moment the
   * attention chime sounds. That is once per station, which is exactly the
   * cadence of the ~320 ms freezes the first real-device lap recorded, and
   * starting a fresh source is one of the calls iOS is slowest at.
   */
  private ensurePaBed() {
    if (this.paBedGain) return
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1500
    bp.Q.value = 0.35
    this.paBedGain = ctx.createGain()
    this.paBedGain.gain.value = 0
    src.connect(bp)
    bp.connect(this.paBedGain)
    this.paBedGain.connect(this.dryGain!)
    this.paBedGain.connect(this.wetSend!)
    src.start()
  }

  private startPaBed() {
    const ctx = this.ctx!
    this.ensurePaBed()
    const t = ctx.currentTime
    this.paBedGain!.gain.cancelScheduledValues(t)
    this.paBedGain!.gain.setValueAtTime(this.paBedGain!.gain.value, t)
    this.paBedGain!.gain.linearRampToValueAtTime(0.011, t + 0.25)
    // Keying click.
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 820
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.035, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
    osc.connect(g)
    g.connect(this.dryGain!)
    osc.start(t)
    osc.stop(t + 0.05)
  }

  /** Fades the carrier out; the source itself keeps running silently (see ensurePaBed). */
  private stopPaBed() {
    if (!this.ctx || !this.paBedGain) return
    const t = this.ctx.currentTime
    this.paBedGain.gain.cancelScheduledValues(t)
    this.paBedGain.gain.setValueAtTime(this.paBedGain.gain.value, t)
    this.paBedGain.gain.setTargetAtTime(0, t, 0.18)
  }

  /**
   * Fetches and decodes one announcement sprite, once. Decoding happens off
   * the main thread, so a sprite arriving mid-ride cannot cost a frame.
   *
   * A sprite that never arrives is not an error worth shouting about: the
   * announcement simply skips the pieces it cannot find, so a failed download
   * costs you the words, not the chime and not the game.
   */
  private loadSprite(lang: PaLang, group: string): Promise<void> {
    const key = `${lang}:${group}`
    if (this.paSprites.has(key)) return Promise.resolve()
    const pending = this.paFetching.get(key)
    if (pending) return pending
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
    const job = fetch(`${base}audio/pa/${lang}-${group}.m4a`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => this.ctx!.decodeAudioData(bytes))
      .then((buf) => {
        this.paSprites.set(key, buf)
      })
      .catch(() => {
        /* sin voz para ese trozo; el aviso sigue sonando con su campanilla */
      })
      .finally(() => {
        this.paFetching.delete(key)
      })
    this.paFetching.set(key, job)
    return job
  }

  /**
   * Asks for the pieces the next few stations will need: the fixed fragments
   * once, and the arcs of the ring around where the train is. Called as the
   * train moves, so the audio for a station is resident before it is due and
   * the rest of the ring is not.
   */
  preloadAnnouncements(langs: PaLang[], arcs: number[]) {
    if (!this.ctx) return
    for (const lang of langs) {
      if (!PA_CLIPS[lang]) continue
      void this.loadSprite(lang, 'frag')
      for (const arc of arcs) void this.loadSprite(lang, `name${arc}`)
    }
  }

  /**
   * Schedules one language's line back to back and returns how long it runs.
   * Pieces are slices of a sprite — `start(when, offset, duration)` plays an
   * arbitrary cut of a buffer already in memory, so there is no seeking and
   * no per-clip cost.
   */
  private scheduleLine(seg: AnnounceSegment): number {
    const ctx = this.ctx!
    // Only the line being spoken needs to be interruptible, and the previous
    // one has already finished by the time this runs — so the list is reset
    // rather than appended to, which otherwise grows for the whole lap.
    this.paPlaying.length = 0
    const start = ctx.currentTime + 0.03
    let t = start
    for (const piece of seg.pieces) {
      if (typeof piece === 'number') {
        t += piece
        continue
      }
      const [group, key] = piece.split(':')
      const sprite = this.paSprites.get(`${seg.lang}:${group}`)
      const slice = PA_CLIPS[seg.lang]?.[group]?.[key]
      if (!sprite || !slice) continue
      const src = ctx.createBufferSource()
      src.buffer = sprite
      src.connect(this.paVoiceIn!)
      src.start(t, slice.at, slice.dur)
      this.paPlaying.push(src)
      t += slice.dur
    }
    return t - start
  }

  /** Silences whatever is mid-sentence — the graph equivalent of cutting the mic. */
  private stopPaVoice() {
    for (const src of this.paPlaying) {
      try {
        src.stop()
      } catch {
        /* ya había terminado */
      }
    }
    this.paPlaying.length = 0
  }

  /** Cuts the current announcement dead (used when it has gone stale). */
  private abortCurrentAnnouncement() {
    this.announceEpoch++
    this.stopPaVoice()
    this.stopPaBed()
    this.announcing = false
    this.currentItem = null
  }

  private playAnnouncement(item: QueuedAnnouncement) {
    if (item.valid && !item.valid()) {
      // Went stale while it waited its turn — drop it and take the next one.
      const next = this.announceQueue.shift()
      if (next) this.playAnnouncement(next)
      return
    }
    perfMark('announce')
    this.currentItem = item
    const epoch = ++this.announceEpoch
    this.announcing = true
    // The real length, from the clips themselves — the old estimate counted
    // characters because the browser's synthesizer never said how long it
    // would take. The duck can now match the sentence exactly.
    const spoken = item.segments.reduce((n, seg) => n + this.lineDuration(seg), 0)
    const fanfareDuration = item.fanfare ? perfTime('a:fanfare', () => this.playMelody(RETRO_FANFARE, 'retro', 0.4) || 0.8) : 0
    this.duckFor(1.2 + spoken + (item.segments.length - 1) * (SEGMENT_GAP_MS / 1000) + fanfareDuration)
    const chimeDuration = perfTime('chime', () => this.playMelody(ATTENTION_CHIME, 'attention', 0.32) || 0.3)
    perfTime('pa-bed', () => this.startPaBed())

    perfTimeout(
      'a:tmr-speak-start',
      () => {
        if (epoch !== this.announceEpoch) return
        // Nothing to say — the chime-only setting, or a sprite that never
        // arrived. Either way the announcement still happened.
        if (item.segments.length === 0) {
          this.finishAnnouncement()
          return
        }
        const sayLine = (i: number) => {
          // Epoch guard: an aborted announcement must not keep talking from
          // inside its own chain.
          if (epoch !== this.announceEpoch) return
          if (i >= item.segments.length || (item.valid && !item.valid())) {
            this.finishAnnouncement()
            return
          }
          const seconds = this.scheduleLine(item.segments[i])
          // Driven by the clips' own length instead of waiting on an `onend`
          // the browser might never fire — the old path needed a fallback
          // timer for exactly that.
          perfTimeout('a:tmr-segment', () => sayLine(i + 1), seconds * 1000 + SEGMENT_GAP_MS)
        }
        sayLine(0)
      },
      (fanfareDuration + chimeDuration) * 1000 + 150,
    )
  }

  /** How long a line runs, from the table — known before a single sample plays. */
  private lineDuration(seg: AnnounceSegment): number {
    let n = 0
    for (const piece of seg.pieces) {
      if (typeof piece === 'number') n += piece
      else n += PA_CLIPS[seg.lang]?.[piece.split(':')[0]]?.[piece.split(':')[1]]?.dur ?? 0
    }
    return n
  }

  /** Breathing gap after an announcement, then the next queued one (if any) takes the mic. */
  private finishAnnouncement() {
    this.stopPaBed()
    this.currentItem = null
    perfTimeout(
      'a:tmr-announce-gap',
      () => {
        this.announcing = false
        const next = this.announceQueue.shift()
        if (next) this.playAnnouncement(next)
      },
      ANNOUNCEMENT_GAP_MS,
    )
  }

  /**
   * Background/foreground handling: when the page hides (app switch, screen
   * lock, kiosk tab change) the render loop freezes but the Web Audio graph,
   * speech synthesis and melody timers would keep sounding — so everything
   * audible gets suspended, and any in-flight announcement is dropped (it
   * would be stale by the time the player returns anyway).
   */
  setBackgrounded(hidden: boolean) {
    if (!this.ctx) return
    if (hidden) {
      this.stopMelodyLoop()
      this.stopPaBed()
      this.announceQueue.length = 0
      this.announcing = false
      this.stopPaVoice()
      this.ctx.suspend().catch(() => {})
    } else {
      this.resumeContext()
    }
  }

  /**
   * One "kan" of a level-crossing bell — a short, bright damped strike.
   * Called by the game on each blink flip while the train nears the crossing,
   * so light and bell stay in lockstep.
   */
  crossingTick(volume: number) {
    if (!this.ctx || volume <= 0.01 || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 640
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(volume * 0.24, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    osc.connect(g)
    g.connect(this.dryGain!)
    g.connect(this.wetSend!)
    osc.start(t)
    osc.stop(t + 0.2)
  }
}

export const audio = new AudioEngine()
