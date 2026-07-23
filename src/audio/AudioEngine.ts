import type { PlayableNote } from '../data/melodies'
import { ATTENTION_CHIME, RETRO_FANFARE } from '../data/melodies'

export type Timbre = 'bell' | 'chime' | 'attention' | 'retro'
export type AnnounceLang = 'ja' | 'en' | 'es'
export interface AnnounceSegment {
  lang: AnnounceLang
  text: string
}

export interface AnnounceOptions {
  fanfare?: boolean
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
}

/** Pause between languages within one announcement, and between two queued announcements — breathing room so the PA never feels rushed. */
const SEGMENT_GAP_MS = 750
const ANNOUNCEMENT_GAP_MS = 1400

const JA_VOICE_PREFERENCE = ['Google 日本語', 'O-Ren', 'Kyoko', 'Sayaka', 'Ayumi', 'Haruka']
// A natural, clear masculine voice for English — the retro chiptune fanfare
// and chime already carry the "80s videogame" flavor, so the voice itself
// should just read well (a robotic novelty voice here was tried and vetoed).
const EN_VOICE_PREFERENCE = [
  'Google UK English Male',
  'Microsoft David', 'Microsoft Guy', 'Microsoft Mark', 'Microsoft Ryan',
  'Daniel', 'Alex', 'Arthur', 'Oliver', 'Gordon', 'Aaron', 'Nathan', 'Tom',
]
const ES_VOICE_PREFERENCE = ['Google español', 'Mónica', 'Paulina', 'Jorge', 'Diego', 'Juan']

const LANG_TAG: Record<AnnounceLang, string> = { ja: 'ja-JP', en: 'en-US', es: 'es-ES' }
const LANG_RATE: Record<AnnounceLang, number> = { ja: 0.88, en: 0.92, es: 0.92 }
const LANG_PITCH_PREFERRED: Record<AnnounceLang, number> = { ja: 0.97, en: 0.9, es: 0.97 }
const LANG_PITCH_FALLBACK: Record<AnnounceLang, number> = { ja: 1.08, en: 1.0, es: 1.02 }

/**
 * All sound in this game is synthesized live with the Web Audio API — there
 * are no external audio assets to license or ship. Station melodies are
 * original compositions (see data/melodies.ts); the motor/brake/room-tone
 * sounds are procedural noise, not recordings. Spoken announcements use the
 * browser's built-in Web Speech API, which plays outside the Web Audio graph
 * — so the reverb bus below can process bells/chimes but not the voice
 * itself; the attention chime + a chiptune fanfare + preferring genuinely
 * synthetic-sounding system voices is what gives the PA its retro character
 * without ever degrading the actual speech.
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
  private voiceMap: Record<AnnounceLang, { voice: SpeechSynthesisVoice | null; preferred: boolean }> = {
    ja: { voice: null, preferred: false },
    en: { voice: null, preferred: false },
    es: { voice: null, preferred: false },
  }
  private voicesReady = false

  private motorSubOsc: OscillatorNode | null = null

  private duckUntil = 0
  private melodyLoopHandle: number | null = null
  private autoResumeInstalled = false
  private announcing = false
  private announceQueue: QueuedAnnouncement[] = []
  private lastAmbientAt = 0
  private jointTimer = 0.8
  private ambNextAt = 0
  private paBedGain: GainNode | null = null
  private paBedSource: AudioBufferSourceNode | null = null
  private crowdGain: GainNode | null = null
  private footstepNextAt = 0
  private stationMurmurGain: GainNode | null = null
  private stationMurmurPanner: StereoPannerNode | null = null

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

    this.convolver = this.ctx.createConvolver()
    this.convolver.buffer = this.buildImpulseResponse()
    this.wetSend = this.ctx.createGain()
    this.wetSend.gain.value = 0.22
    this.wetSend.connect(this.convolver)
    this.convolver.connect(this.master)

    this.noiseBuffer = this.buildNoiseBuffer()
    this.startAmbientBed()
    this.loadVoices()

    this.resumeContext()
    this.kickSilentBuffer()
    this.primeSpeechSynthesis()
    this.installAutoResume()
  }

  /** Resumes the AudioContext if the platform left it (or put it back) in a suspended state. */
  private resumeContext() {
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {})
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

  /** Speaking one silent utterance synchronously inside the gesture unlocks later async speak() calls on iOS Safari. */
  private primeSpeechSynthesis() {
    if (!('speechSynthesis' in window)) return
    try {
      speechSynthesis.cancel()
      const primer = new SpeechSynthesisUtterance('.')
      primer.volume = 0
      primer.rate = 10
      speechSynthesis.speak(primer)
    } catch {
      // Speech synthesis is best-effort — a priming failure shouldn't block the rest of unlock().
    }
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
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const dt = Math.min(Math.max(t - this.lastAmbientAt, 0), 0.1)
    this.lastAmbientAt = t
    const eased = Math.pow(speed01, 0.6)
    const ducked = t < this.duckUntil
    const duckMul = ducked ? 0.5 : 1

    // Softer motor: lower ceiling than before, and the sub follows an octave down.
    this.motorOsc?.frequency.setTargetAtTime(55 + eased * 190, t, 0.08)
    this.motorSubOsc?.frequency.setTargetAtTime((55 + eased * 190) / 2, t, 0.08)
    this.motorFilter?.frequency.setTargetAtTime(130 + eased * 640, t, 0.08)
    this.motorGain?.gain.setTargetAtTime(speed01 > 0.01 ? (0.045 + eased * 0.095) * duckMul : 0, t, 0.15)

    this.noiseFilter?.frequency.setTargetAtTime(300 + eased * 2200, t, 0.1)
    this.noiseGain?.gain.setTargetAtTime(speed01 > 0.01 ? (0.02 + eased * 0.055) * duckMul : 0, t, 0.15)

    if (brakeAmount > 0.55 && speed01 > 0.03 && speed01 < 0.5) {
      this.noiseFilter?.frequency.setTargetAtTime(1800 + brakeAmount * 1500, t, 0.05)
      this.noiseGain?.gain.setTargetAtTime((0.05 + brakeAmount * 0.1) * duckMul, t, 0.05)
    }

    const stillness = 1 - Math.min(1, speed01 * 6)
    this.roomToneGain?.gain.setTargetAtTime(0.03 * stillness * duckMul, t, 0.4)

    this.updateRailJoints(dt, speed01, duckMul)
    this.updateTimeAmbience(t, hour, speed01, duckMul)
    this.updateCrowd(t, hour, crowd, duckMul)
    this.updateStationMurmur(t, hour, stationMurmur, stationPan, duckMul)
  }

  /**
   * Positional platform murmur: swells as the cab nears a station, panned
   * toward the platform side, and scaled by how busy that station is (the
   * caller folds in landmark status; the rush-hour curve is applied here).
   */
  private updateStationMurmur(t: number, hour: number, level: number, pan: number, duckMul: number) {
    const ctx = this.ctx!
    if (!this.stationMurmurGain) {
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
    }
    const rush = this.rushFactor(hour)
    this.stationMurmurGain.gain.setTargetAtTime(level * (0.35 + 0.65 * rush) * 0.05 * duckMul, t, 0.35)
    this.stationMurmurPanner!.pan.setTargetAtTime(pan, t, 0.3)
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
    const vol = still * duckMul
    if (vol < 0.15) {
      this.ambNextAt = t + 1.2
      return
    }
    if (hour >= 4.5 && hour < 9) {
      this.playBirdChirp(t, 0.032 * vol)
      this.ambNextAt = t + 1.6 + Math.random() * 3.4
    } else if (hour >= 9 && hour < 17) {
      this.playCicada(t, 0.014 * vol)
      this.ambNextAt = t + 2.2 + Math.random() * 3.6
    } else if (hour >= 17 && hour < 19.5) {
      this.playHigurashi(t, 0.022 * vol)
      this.ambNextAt = t + 2.6 + Math.random() * 3.2
    } else {
      this.playCrickets(t, 0.02 * vol)
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
      g.connect(this.dryGain!)
      g.connect(this.wetSend!)
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
    g.connect(this.dryGain!)
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
      g.connect(this.dryGain!)
      g.connect(this.wetSend!)
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
      g.connect(this.dryGain!)
      osc.start(start)
      osc.stop(start + 0.06)
      start += 0.07
    }
  }

  /** Pneumatic hiss + clunk of the doors; `open` alters the envelope slightly. */
  playDoorCycle(open: boolean) {
    if (!this.ctx) return
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
    if (!this.ctx || !this.master) return 0
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

  private loadVoices() {
    // Guard: an embedding WebView without Web Speech support (rare, but seen
    // in some older/stripped Android WebViews) must not throw here — the PA
    // announcements degrade to silent rather than crashing the whole unlock
    // path a tap on "start" runs through.
    if (!('speechSynthesis' in window)) return
    const pick = () => {
      const voices = speechSynthesis.getVoices()
      if (!voices.length) return
      const assign = (key: AnnounceLang, preference: string[]) => {
        const byPreference = this.pickByPreference(voices, preference)
        const fallback = voices.find((v) => v.lang.startsWith(key)) || null
        this.voiceMap[key] = { voice: byPreference || fallback, preferred: !!byPreference }
      }
      assign('ja', JA_VOICE_PREFERENCE)
      assign('en', EN_VOICE_PREFERENCE)
      assign('es', ES_VOICE_PREFERENCE)
      this.voicesReady = true
    }
    pick()
    if (!this.voicesReady && 'onvoiceschanged' in speechSynthesis) {
      speechSynthesis.onvoiceschanged = pick
    }
  }

  private pickByPreference(voices: SpeechSynthesisVoice[], preference: string[]): SpeechSynthesisVoice | null {
    for (const name of preference) {
      const found = voices.find((v) => v.name.toLowerCase().includes(name.toLowerCase()))
      if (found) return found
    }
    return null
  }

  private buildUtterance(lang: AnnounceLang, text: string): SpeechSynthesisUtterance {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = LANG_TAG[lang]
    utter.rate = LANG_RATE[lang]
    const entry = this.voiceMap[lang]
    utter.pitch = entry.preferred ? LANG_PITCH_PREFERRED[lang] : LANG_PITCH_FALLBACK[lang]
    if (entry.voice) utter.voice = entry.voice
    return utter
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
    if (!this.ctx || !('speechSynthesis' in window) || !segments.length) return
    const item: QueuedAnnouncement = { segments, fanfare: !!opts.fanfare, kind: opts.kind ?? 'general' }
    if (this.announcing) {
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
  private startPaBed() {
    const ctx = this.ctx!
    if (this.paBedGain) return
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1500
    bp.Q.value = 0.35
    this.paBedGain = ctx.createGain()
    const t = ctx.currentTime
    this.paBedGain.gain.setValueAtTime(0, t)
    this.paBedGain.gain.linearRampToValueAtTime(0.011, t + 0.25)
    src.connect(bp)
    bp.connect(this.paBedGain)
    this.paBedGain.connect(this.dryGain!)
    this.paBedGain.connect(this.wetSend!)
    src.start()
    this.paBedSource = src
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

  private stopPaBed() {
    if (!this.ctx || !this.paBedGain) return
    const t = this.ctx.currentTime
    this.paBedGain.gain.setTargetAtTime(0, t, 0.18)
    const src = this.paBedSource
    window.setTimeout(() => src?.stop(), 900)
    this.paBedGain = null
    this.paBedSource = null
  }

  private playAnnouncement(item: QueuedAnnouncement) {
    this.announcing = true
    const totalChars = item.segments.reduce((n, s) => n + s.text.length, 0)
    const fanfareDuration = item.fanfare ? this.playMelody(RETRO_FANFARE, 'retro', 0.4) || 0.8 : 0
    this.duckFor(3.5 + totalChars * 0.06 + fanfareDuration)
    const chimeDuration = this.playMelody(ATTENTION_CHIME, 'attention', 0.32) || 0.3
    this.startPaBed()

    window.setTimeout(() => {
      // Clear only leftovers (e.g. the unlock primer) — by construction
      // nothing of ours is speaking when a new sequence starts.
      speechSynthesis.cancel()
      const utterances = item.segments.map((seg) => this.buildUtterance(seg.lang, seg.text))

      const speakAt = (i: number) => {
        if (i >= utterances.length) {
          this.finishAnnouncement()
          return
        }
        const utter = utterances[i]
        let advanced = false
        const advance = () => {
          if (advanced) return
          advanced = true
          window.setTimeout(() => speakAt(i + 1), SEGMENT_GAP_MS)
        }
        utter.onend = advance
        // Fallback in case `onend` never fires (a known flakiness in some browsers' queued-utterance handling).
        window.setTimeout(advance, item.segments[i].text.length * 140 + 2200)
        speechSynthesis.speak(utter)
      }
      speakAt(0)
    }, (fanfareDuration + chimeDuration) * 1000 + 150)
  }

  /** Breathing gap after an announcement, then the next queued one (if any) takes the mic. */
  private finishAnnouncement() {
    this.stopPaBed()
    window.setTimeout(() => {
      this.announcing = false
      const next = this.announceQueue.shift()
      if (next) this.playAnnouncement(next)
    }, ANNOUNCEMENT_GAP_MS)
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
      if ('speechSynthesis' in window) speechSynthesis.cancel()
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
    if (!this.ctx || volume <= 0.01) return
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
