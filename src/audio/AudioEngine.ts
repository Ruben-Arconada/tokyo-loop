import type { PlayableNote } from '../data/melodies'
import { ATTENTION_CHIME, RETRO_FANFARE } from '../data/melodies'

export type Timbre = 'bell' | 'chime' | 'attention' | 'retro'
export type AnnounceLang = 'ja' | 'en' | 'es'
export interface AnnounceSegment {
  lang: AnnounceLang
  text: string
}

const JA_VOICE_PREFERENCE = ['Google 日本語', 'O-Ren', 'Kyoko', 'Sayaka', 'Ayumi', 'Haruka']
// Zarvox/Trinoids/Whisper/Fred/Albert are the classic synthetic-sounding
// system voices (macOS/eSpeak) — genuinely retro-computer timbre when
// available; real, clear voices remain the fallback so quality never drops.
const EN_VOICE_PREFERENCE = ['Zarvox', 'Trinoids', 'Whisper', 'Fred', 'Albert', 'Google US English', 'Samantha', 'Daniel', 'Karen']
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

  private duckUntil = 0
  private melodyLoopHandle: number | null = null
  private announceToken = 0
  private autoResumeInstalled = false

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
    // Motor hum: a low sawtooth run through a lowpass, pitch/gain track speed.
    this.motorOsc = ctx.createOscillator()
    this.motorOsc.type = 'sawtooth'
    this.motorOsc.frequency.value = 60
    this.motorFilter = ctx.createBiquadFilter()
    this.motorFilter.type = 'lowpass'
    this.motorFilter.frequency.value = 200
    this.motorGain = ctx.createGain()
    this.motorGain.gain.value = 0
    this.motorOsc.connect(this.motorFilter)
    this.motorFilter.connect(this.motorGain)
    this.motorGain.connect(this.master!)
    this.motorOsc.start()

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

  /** speed01: 0..1 fraction of top speed. brakeAmount: 0..1 how hard braking. */
  updateAmbient(speed01: number, brakeAmount: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const eased = Math.pow(speed01, 0.6)
    const ducked = t < this.duckUntil
    const duckMul = ducked ? 0.5 : 1

    this.motorOsc?.frequency.setTargetAtTime(55 + eased * 220, t, 0.08)
    this.motorFilter?.frequency.setTargetAtTime(150 + eased * 900, t, 0.08)
    this.motorGain?.gain.setTargetAtTime(speed01 > 0.01 ? (0.05 + eased * 0.12) * duckMul : 0, t, 0.15)

    this.noiseFilter?.frequency.setTargetAtTime(300 + eased * 2200, t, 0.1)
    this.noiseGain?.gain.setTargetAtTime(speed01 > 0.01 ? (0.02 + eased * 0.06) * duckMul : 0, t, 0.15)

    if (brakeAmount > 0.55 && speed01 > 0.03 && speed01 < 0.5) {
      this.noiseFilter?.frequency.setTargetAtTime(1800 + brakeAmount * 1500, t, 0.05)
      this.noiseGain?.gain.setTargetAtTime((0.05 + brakeAmount * 0.1) * duckMul, t, 0.05)
    }

    const stillness = 1 - Math.min(1, speed01 * 6)
    this.roomToneGain?.gain.setTargetAtTime(0.03 * stillness * duckMul, t, 0.4)
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
   * Plays a PA announcement: an optional retro chiptune fanfare, an
   * attention chime, then each segment spoken in order with a fixed pause
   * between them. A newer announce() call supersedes an older one still in
   * flight (rather than letting them queue up and pile behind each other,
   * e.g. after the player skips several stations in a row), and each segment
   * has a fallback timer in case the browser never fires `onend`. Entirely
   * asynchronous — never blocks the game loop or player input.
   */
  announce(segments: AnnounceSegment[], opts: { fanfare?: boolean } = {}) {
    if (!this.ctx || !('speechSynthesis' in window) || !segments.length) return
    const myToken = ++this.announceToken
    const totalChars = segments.reduce((n, s) => n + s.text.length, 0)
    const fanfareDuration = opts.fanfare ? this.playMelody(RETRO_FANFARE, 'retro', 0.4) || 0.8 : 0
    this.duckFor(3.5 + totalChars * 0.05 + fanfareDuration)
    const chimeDuration = this.playMelody(ATTENTION_CHIME, 'attention', 0.32) || 0.3

    window.setTimeout(() => {
      if (myToken !== this.announceToken) return
      speechSynthesis.cancel()
      const utterances = segments.map((seg) => this.buildUtterance(seg.lang, seg.text))

      const speakAt = (i: number) => {
        if (myToken !== this.announceToken || i >= utterances.length) return
        const utter = utterances[i]
        let advanced = false
        const advance = () => {
          if (advanced) return
          advanced = true
          window.setTimeout(() => speakAt(i + 1), 550)
        }
        utter.onend = advance
        // Fallback in case `onend` never fires (a known flakiness in some browsers' queued-utterance handling).
        window.setTimeout(advance, segments[i].text.length * 130 + 1800)
        speechSynthesis.speak(utter)
      }
      speakAt(0)
    }, (fanfareDuration + chimeDuration) * 1000 + 100)
  }
}

export const audio = new AudioEngine()
