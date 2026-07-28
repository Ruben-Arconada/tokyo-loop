import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Track, TrackOffsetCurve, CatenaryCurve, HILL_PEAK, EMBANKMENT, embankmentSurface, terrainRelief, trenchPortalOffset } from './Track'
import { Train, notchLabel, MIN_NOTCH, MAX_NOTCH, MAX_SPEED_KMH, SPEED_SCALE, OPEN_INSTANT_SECONDS, OPEN_QUICK_SECONDS, CLOSE_WINDOW_SECONDS, CLOSE_HURRY_SECONDS, RAIL_ADVISORY_KMH, type DoorActionInfo, type RailCondition } from './Train'
import { WindshieldFX } from './WindshieldFX'
import { City } from './City'
import { Passengers } from './Passengers'
import { Precipitation } from './Precipitation'
import { TrainConsist, CAB_OFFSET } from './TrainConsist'
import type { CameraMode } from './cameraModes'
import { PerfLog, setActivePerfLog, perfMark, perfPhase } from './PerfLog'
import { PassengerFlow, TRAIN_CAPACITY } from './PassengerFlow'
import { Schedule, ON_TIME_TOLERANCE, LATE_TOLERANCE, type ScheduleLevel } from './Schedule'
import { registerPool, applySeasonToPool, overcastTarget, precipProfile, type Season, type Weather, type SeasonalPool } from './Seasons'
import { WORLD_SEED, worldStream } from './Rng'
import { CANONICAL_SCENARIO, FORCE_CANONICAL, tagGroup, type WorldScenario } from './worldHash'
import { TextureUploadWatch } from './textureWatch'
import { Scenery } from './Scenery'
import { DayNightCycle } from './DayNightCycle'
import { audio } from '../audio/AudioEngine'
import { Controls } from '../ui/Controls'
import { UI } from '../ui/UI'
import { STATIONS } from '../data/stations'
import { getStationMelody, DOOR_CHIME_OPEN, DOOR_CHIME_CLOSE, BOARDING_DONE_CUE } from '../data/melodies'
import { makeBallastTexture, makeScuffedPanelTexture, makeDestinationTexture, makeGroundTexture, makeTracksideWearTexture, WINDOW_DUSK_UNIFORM } from './signage'

const LOOK_YAW_LIMIT = 1.7 // ~97°, enough to look out the side windows
const LOOK_PITCH_LIMIT = 0.55

// Fixed-timestep physics: train integration/scoring must be identical
// regardless of device frame rate. FIXED_DT matches the original ~60Hz
// tuning (notch accel/brake tables, stop-zone width) so play feel doesn't
// shift; MAX_FRAME_DT/MAX_CATCHUP_STEPS bound how much simulated time a
// single stall (GC pause, tab hitch) can demand, so a long stall spreads
// its catch-up over a couple of frames instead of freezing the render loop.
const FIXED_DT = 1 / 60
const MAX_FRAME_DT = 0.25
const MAX_CATCHUP_STEPS = 15

// ————————————————————————————————————————————————————————————————
// PA language. Japanese is never dropped — it IS the sound of the line — but
// three languages per stop take ~15 s, and at line speed you pass a station
// every ~14 s, so the announcements piled up and drifted a station or two
// behind the train (Rubén, on the first real lap). Two languages fit inside
// the gap. The second one follows the player's browser; the pause menu can
// override it.
// ————————————————————————————————————————————————————————————————
export type PaSecondLang = 'en' | 'es'
const PA_LANG_KEY = 'yamanote-pa-lang'

function detectSecondLang(): PaSecondLang {
  const stored = localStorage.getItem(PA_LANG_KEY)
  if (stored === 'en' || stored === 'es') return stored
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Door-side wording per language, so every announcement really states the side. */
function doorSidePhrases(side: 'left' | 'right'): { ja: string; en: string; es: string } {
  return side === 'left'
    ? { ja: '左側', en: 'left', es: 'izquierdo' }
    : { ja: '右側', en: 'right', es: 'derecho' }
}

const CAMERA_KEY = 'yamanote-camera'
const SCHEDULE_KEY = 'yamanote-schedule'
const INTERRUPT_TIP_KEY = 'yamanote-tip-interrupt'
/** Punctuality points: on time pays, late costs, and the cap keeps one bad stop from ruining a lap. */
const ON_TIME_POINTS = 40
const LATE_PENALTY_PER_SECOND = 2
const LATE_PENALTY_CAP = 90

const BEST_SCORE_KEY = 'yamanote-best-score'
const SEASON_KEY = 'yamanote-season'
const WEATHER_KEY = 'yamanote-weather'
const WEATHER_AUTO_KEY = 'yamanote-weather-auto'
const MUTE_KEY = 'yamanote-muted'
const ATMO_SEEN_KEY = 'yamanote-atmo-seen'
const RAIL_TIP_KEY = 'yamanote-tip-rail'

// ————————————————————————————————————————————————————————————————
// H3: the sky with a life of its own. In AUTO mode weather fronts arrive and
// pass on their own schedule — a Markov walk over the four states, with
// dwell times long enough that a front feels like an EVENT and short enough
// that an 8-minute game day usually sees one. Picking any specific weather
// in the panel takes manual control back; the AUTO chip hands it over again.
// ————————————————————————————————————————————————————————————————
const FRONT_CHAIN: Record<Weather, [Weather, number][]> = {
  clear: [['cloudy', 0.8], ['clear', 0.2]],
  cloudy: [['rain', 0.45], ['clear', 0.4], ['storm', 0.15]],
  rain: [['cloudy', 0.5], ['storm', 0.3], ['rain', 0.2]],
  storm: [['rain', 0.6], ['cloudy', 0.4]],
}
const FRONT_DWELL: Record<Weather, [number, number]> = {
  clear: [80, 200],
  cloudy: [60, 150],
  rain: [70, 150],
  storm: [45, 95],
}
/** The Kamakura coast arc of the loop (see Scenery.buildCoast) — where the sea is audible. */
const BAY_T0 = 0.775
const BAY_T1 = 0.955
/** Arcade scoring per stop grade; perfects chain into a streak bonus. */
const GRADE_POINTS: Record<string, number> = { perfect: 100, good: 60, ok: 30 }
const STREAK_BONUS = 25
const STREAK_BONUS_CAP = 200
/** Door-work bonuses — the conductor half of the job. */
const DOOR_OPEN_INSTANT_POINTS = 30
const DOOR_OPEN_QUICK_POINTS = 15
const DOOR_CLOSE_SHARP_POINTS = 30
/** Boarding takes longer in the rush hours: base + crowd-scaled extra. */
/** Platform edge offset from the track centreline (City's TRACK_CLEARANCE). */
const PLATFORM_INNER = 3
/** Height of the driver's eye above the rail head. */
const CAB_EYE_Y = 3.15
/** Orbit radius of the outside view, and what it aims at. */
const EXT_DISTANCE = 36
const EXT_FOCUS_Y = 2.8
/** Elevation limits: never at train height, never a map view. */
const EXT_PITCH_MIN = 0.18
const EXT_PITCH_MAX = 0.95
/** How far past a platform the train must get before the platform camera hands over. */
const PLATFORM_HANDOVER_UNITS = 150
/** Where the station's own camera hangs: high, at the back, under the canopy. */
const CCTV_HEIGHT = 5.15
const CCTV_LATERAL = 12.2
const CCTV_BACK = 22
/** Pan/tilt limits from its mount — enough to follow the platform, never enough to lose it. */
const CCTV_YAW_LIMIT = 0.62
const CCTV_PITCH_MIN = -0.28
const CCTV_PITCH_MAX = 0.2
/** Security lenses are wide; the game's normal view is not. */
const CCTV_FOV = 84
const NORMAL_FOV = 68
/** Shared read-only up vector for camera solves — never mutated. */
const WORLD_UP = new THREE.Vector3(0, 1, 0)
/**
 * Sleeper jitter comes from the seed like the rest of the built world. The
 * weather-front timers in this file deliberately stay on Math.random(): they
 * are gameplay, not layout, and a front you can predict is a worse front.
 */
const tracksideRnd = worldStream('trackside')
/**
 * How far ahead of the cab the tunnel looks when deciding to restore the
 * far plane (world units). Restored this early the whole ring is drawing
 * again ~3.5 s before the portal at line speed — while the cab is still
 * fully enclosed and the fog still ends at 260, so the world fades back in
 * through the opening fog instead of popping into place at the exit
 * (Rubén saw the pop leaving at 95 km/h).
 */
const FAR_RESTORE_LOOKAHEAD = 110
const BOARDING_BASE_SECONDS = 5.5
const BOARDING_CROWD_SECONDS = 5.5
/** A skipped station can sting, but it must never wipe a good run. */
const SKIP_PENALTY_CAP = 120
/** What the air inside the tunnel looks like — warm-dark, sodium-tinged. */
const TUNNEL_FOG = new THREE.Color(0x16120d)

export class Game {
  private renderer: THREE.WebGLRenderer
  /** Readable so the dev fingerprint harness can walk the built world. */
  readonly scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private track: Track
  private train: Train
  private city: City
  private passengers: Passengers
  private scenery: Scenery
  private dayNight: DayNightCycle
  private precipitation: Precipitation
  private windshield!: WindshieldFX
  private consist!: TrainConsist
  private cabRig!: THREE.Group
  /**
   * Which eye the player is looking through. The train is only BUILT into the
   * world in the outside views, so the default cab view costs exactly what it
   * always did.
   */
  private cameraMode: CameraMode = (localStorage.getItem(CAMERA_KEY) as CameraMode) || 'cab'
  // `?canon` pins season/weather/auto to the scenario the reference hashes are
  // quoted in, so a capture cannot silently inherit whatever this browser
  // profile was last left on. See CANONICAL_SCENARIO in worldHash.
  private season: Season = FORCE_CANONICAL ? CANONICAL_SCENARIO.season : (localStorage.getItem(SEASON_KEY) as Season) || 'spring'
  private weather: Weather = FORCE_CANONICAL ? CANONICAL_SCENARIO.weather : (localStorage.getItem(WEATHER_KEY) as Weather) || 'clear'
  /** Last rain/wind levels actually pushed to the audio engine — the per-frame profile only reaches it when they have moved. */
  private lastRainAudioLevel = -1
  private lastWindAudioLevel = -1
  private lastShoreAudioLevel = -1
  private lastTunnelAudioF = -1
  /** 0 = open air, 1 = inside the Shibuya tunnel — recomputed each frame from the cab's position. */
  private tunnelF = 0
  private wasInTunnel = false
  /** What the windshield overlay needs from the last precipitation profile. */
  private wsIntensity = 0
  private wsSnow = false
  /** H3 auto weather: on by default for a sky with a life of its own — off under `?canon`, where a front arriving mid-capture would move the sky under the measurement. */
  private weatherAuto = FORCE_CANONICAL ? CANONICAL_SCENARIO.weatherAuto : localStorage.getItem(WEATHER_AUTO_KEY) !== '0'
  private frontTimer = 50 + Math.random() * 60
  /** Atmosphere-panel discovery: pulse + one hint until the player opens it once. */
  private atmoSeen = localStorage.getItem(ATMO_SEEN_KEY) === '1'
  private atmoTipTimer = 0
  private atmoTipShown = false
  private railTipShown = localStorage.getItem(RAIL_TIP_KEY) === '1'
  private muted = localStorage.getItem(MUTE_KEY) === '1'
  /** Which station the perf log has already been told about — one mark per change, not per frame. */
  private lastMarkedStation = -1
  /** DayNightCycle's own starting hour, so the line starts already populated for it. */
  private readonly dayNightStartHour = 7.5
  private paLang: PaSecondLang = detectSecondLang()
  private flow!: PassengerFlow
  private schedule!: Schedule
  /** Shown once, the first time the player cuts a boarding short. */
  private interruptTipShown = localStorage.getItem(INTERRUPT_TIP_KEY) === '1'
  /** Throttles the sprite refresh — the counts move slowly, the queue redraw is a DOM-free but non-trivial pass. */
  private waitingRefresh = 0
  /** Ground + embankment vertex-color pools, retinted per season alongside the vegetation. */
  private terrainPools: SeasonalPool[] = []
  private ballastMat!: THREE.MeshStandardMaterial
  private wearMat!: THREE.MeshStandardMaterial
  private headlight!: THREE.SpotLight
  private cabLight!: THREE.PointLight
  private controls: Controls
  private ui: UI
  private clock = new THREE.Clock()
  private started = false
  /** Whether the WebGL animation loop is actually spinning (false = single static frame, no rAF). */
  private running = false
  /** Leftover real time not yet consumed by a fixed physics step. */
  private physicsAccumulator = 0
  private timeScale = 1
  private lookYaw = 0
  private lookPitch = 0
  /** Outside-view orbit: yaw is free, pitch is fenced (see EXT_PITCH_*). */
  private extYaw = 0.55
  private extPitch = 0.42
  /** Which platform the standing camera is on — it lags the train's target on purpose. */
  private platformStation = 0
  /** Pan/tilt of the platform camera, relative to its mounted aim. */
  private platYaw = 0
  private platPitch = 0
  private leverPivot!: THREE.Object3D
  private destinationMat!: THREE.MeshBasicMaterial
  private lastDestinationIdx = -1
  private lastCrossingPhase = false
  private perf = new PerfLog()
  private score = 0
  /** The transfer in progress at a stop: people cross the doorway over time, not all at once. */
  private transfer: {
    station: number
    alightLeft: number
    boardLeft: number
    alighted: number
    boarded: number
    rate: number
    /** Fractional people carried between frames, so a slow rate still moves someone. */
    carry: number
    phase: 'waiting' | 'alighting' | 'boarding' | 'done'
  } | null = null
  private perfectStreak = 0
  private bestScore = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0)

  /**
   * Everything that decides WHICH world got built, for the fingerprint to
   * record alongside the hash. The seed is only half of it: the season
   * repaints twelve instance-colour buffers on the way in, so a hash without
   * its scenario is a number nobody can reproduce.
   */
  get scenario(): WorldScenario {
    return { seed: WORLD_SEED, season: this.season, weather: this.weather, weatherAuto: this.weatherAuto }
  }

  /**
   * Dresses the world in a season WITHOUT storing the preference — for the
   * reference capture, which walks all four and must leave the browser as it
   * found it. A capture that persisted its last season would hand the next
   * clean load a different world, which is how a winter capture once got
   * written down as the spring reference.
   */
  setSeasonForCapture(season: Season) {
    this.season = season
    this.applyAtmosphere()
  }

  constructor(mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      // Screenshot harness only (?capture): keeps the drawing buffer
      // readable for canvas.drawImage-based captures. Costs memory/perf, so
      // never on by default — nobody plays with this flag.
      preserveDrawingBuffer: new URLSearchParams(window.location.search).has('capture'),
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // Mobile GPUs dither blended gradients by default (GL_DITHER is on unless
    // someone turns it off), which speckled the soft cloud sprites into visible
    // static on phones. A no-op on desktop GPUs.
    this.renderer.getContext().disable(this.renderer.getContext().DITHER)
    this.renderer.shadowMap.enabled = true
    // PCFShadowMap explicitly: PCFSoftShadowMap is deprecated in three 0.185
    // and the renderer silently swaps it for exactly this, warning as it goes.
    // Same pixels as before — we simply stop believing we have soft shadows.
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Only the ground plane uses clipping (the hole over the Shibuya
    // trench); every other material is untouched by this flag.
    this.renderer.localClippingEnabled = true
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.classList.add('game-canvas')
    mount.prepend(this.renderer.domElement)

    // A single generic, soft-lit environment map so metallic materials (rails,
    // signage frames, towers) pick up plausible reflections instead of
    // flat black — generated once, never regenerated per Marco's perf budget.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.15
    pmrem.dispose()

    // Near plane at 0.3 (nearest cab prop sits ~0.5 away): 3x the depth
    // precision of the old 0.1, which is what made distant geometry shimmer.
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.3, 9000)
    this.scene.add(this.camera)

    this.track = new Track()
    this.train = new Train(this.track, {
      onDepartAnnounce: (_cur, next) => this.handleDepartAnnounce(next),
      onArrivingAnnounce: (idx) => {
        perfMark('arriving')
        this.handleArrivingAnnounce(idx)
      },
      onStopped: (idx, result) => {
        // Nobody moves yet — the stop only PLANS the transfer. People walk
        // through the doors while they are open (see updateTransfer), so
        // closing early really does leave them behind.
        const plan = this.flow.planStop(idx)
        const moving = plan.toAlight + plan.toBoard
        this.train.boardingSeconds = THREE.MathUtils.clamp(
          BOARDING_BASE_SECONDS + (moving / 40) * BOARDING_CROWD_SECONDS,
          BOARDING_BASE_SECONDS,
          BOARDING_BASE_SECONDS + BOARDING_CROWD_SECONDS * 2.2,
        )
        this.transfer = {
          station: idx,
          alightLeft: plan.toAlight,
          boardLeft: plan.toBoard,
          alighted: 0,
          boarded: 0,
          // Fast enough that a well-judged dwell clears the doorway, slow
          // enough that a rushed one visibly does not.
          rate: Math.max(6, moving / Math.max(2.5, this.train.boardingSeconds * 0.72)),
          carry: 0,
          phase: 'waiting',
        }
        const gained = this.applyScore(result.grade)
        this.ui.showStopToast(idx, result, gained)
        this.ui.setStationResult(idx, result.grade)
        // Punctuality is scored separately from stopping accuracy: they are
        // two different skills and conflating them hides which one you failed.
        const delay = this.schedule.arrive(idx)
        if (delay <= ON_TIME_TOLERANCE) {
          this.score += ON_TIME_POINTS
        } else if (delay > LATE_TOLERANCE) {
          this.score = Math.max(0, this.score - Math.min(LATE_PENALTY_CAP, Math.round((delay - LATE_TOLERANCE) * LATE_PENALTY_PER_SECOND)))
        }
        this.ui.setScore(this.score, this.bestScore, this.perfectStreak)
        this.ui.showPunctualityToast(delay)
      },
      onMissed: (idx) => {
        perfMark('missed')
        this.perfectStreak = 0
        // Skipping is not free any more: the platform's crowd stays (and
        // grows), and the riders who wanted this station are still aboard.
        const skipped = this.flow.skip(idx)
        const penalty = Math.min(SKIP_PENALTY_CAP, Math.round(skipped.stranded * 0.5 + skipped.carried * 1.5))
        if (penalty > 0) {
          this.score = Math.max(0, this.score - penalty)
          this.ui.setScore(this.score, this.bestScore, 0)
        }
        this.ui.showSkipToast(idx, skipped.stranded, skipped.carried, penalty)
        this.ui.setStationResult(idx, 'missed')
      },
      onDoorsOpen: (idx, info) => this.handleDoorsOpen(idx, info),
      onBoardingComplete: () => audio.playMelody(BOARDING_DONE_CUE, 'attention', 0.4),
      onCloseHurryUp: () => this.handleDoorsClosingWarning(),
      onDoorsClose: (idx, info) => {
        this.schedule.depart(this.train.targetStationIndex === idx ? (idx + 1) % STATIONS.length : this.train.targetStationIndex)
        this.handleDoorsClose(info)
      },
    })
    this.city = new City(this.scene, this.track)
    this.flow = new PassengerFlow(this.dayNightStartHour)
    this.schedule = new Schedule(
      this.track,
      MAX_SPEED_KMH * SPEED_SCALE,
      (localStorage.getItem(SCHEDULE_KEY) as ScheduleLevel) || 'normal',
    )
    this.passengers = new Passengers(this.scene, this.track, this.camera)
    this.scenery = new Scenery(this.scene, this.track)
    this.dayNight = new DayNightCycle(this.scene)
    this.consist = new TrainConsist(this.scene, this.track)
    this.buildTrackVisual()
    this.buildCabRig()
    this.buildHeadlight()

    // Registered once, here, so the upload watch is already tracking them long
    // before anyone presses record — that is what keeps its baseline honest.
    this.city.collectSignTextures(this.uploadWatch)
    this.uploadWatch.watch(this.destinationMat.map)

    this.controls = new Controls(mount, {
      onNotchChange: (n) => this.train.setNotch(n),
      onLook: (dx, dy) => this.handleLook(dx, dy),
    })
    this.ui = new UI(mount, {
      onStart: () => this.start(),
      onPauseToggle: (p) => this.setPaused(p),
      onTimeScaleChange: (s) => (this.timeScale = s),
      onTimeSet: (hour) => (this.dayNight.timeOfDay = hour),
      onDoorAction: () => this.handleDoorButton(),
      onSeasonSet: (s) => {
        this.season = s
        localStorage.setItem(SEASON_KEY, s)
        this.applyAtmosphere()
        if (!this.running) this.renderOnce()
      },
      onCameraSet: (m) => this.setCameraMode(m),
      onScheduleLevelSet: (level) => {
        this.schedule.setLevel(level, this.track, MAX_SPEED_KMH * SPEED_SCALE)
        localStorage.setItem(SCHEDULE_KEY, level)
        this.ui.setScheduleLevel(level)
      },
      onPaLangSet: (lang) => {
        this.paLang = lang
        localStorage.setItem(PA_LANG_KEY, lang)
      },
      onTeleport: (idx) => this.teleportToStation(idx),
      onPerfToggle: () => this.togglePerfRecording(),
      onProbeStart: () => this.startProbe(),
      onPerfExport: () => (this.perf.frames > 0 ? this.perf.export() : PerfLog.stored()),
      onPerfClear: () => {
        PerfLog.clearStored()
        this.pushPerfState()
      },
      onWeatherSet: (w) => {
        // Picking a specific weather takes the sky back from the director.
        this.setWeatherAuto(false)
        this.applyWeather(w)
        if (!this.running) this.renderOnce()
      },
      onWeatherAutoSet: () => {
        this.setWeatherAuto(true)
        // Something should visibly happen soon after handing over the sky.
        this.frontTimer = 6 + Math.random() * 14
      },
      onMuteToggle: (m) => {
        this.muted = m
        localStorage.setItem(MUTE_KEY, m ? '1' : '0')
        audio.setMuted(m)
      },
      onAtmoOpened: () => {
        this.atmoSeen = true
        localStorage.setItem(ATMO_SEEN_KEY, '1')
      },
    })

    this.precipitation = new Precipitation(this.scene)
    this.windshield = new WindshieldFX(mount)
    // Sound follows light: the flash is drawn the frame it happens, the clap
    // arrives however many seconds later its distance says.
    this.dayNight.onLightning = (delay, strength) => audio.thunder(strength, delay)
    audio.setMuted(this.muted)
    this.ui.setMuted(this.muted)
    this.ui.setWeatherAuto(this.weatherAuto)
    this.ui.setAtmoPulse(!this.atmoSeen)
    this.applyAtmosphere()

    window.addEventListener('resize', () => this.onResize())
    // iOS can move the VISUAL viewport (toolbar collapse, PWA chrome)
    // without firing a window resize — track it explicitly (RC gate item).
    window.visualViewport?.addEventListener('resize', () => this.onResize())
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.togglePerfRecording()
      if (e.code === 'KeyD') this.handleDoorButton()
    })
    // The render loop freezes on its own when the tab hides, but audio does
    // not — silence everything in the background and pick back up on return.
    document.addEventListener('visibilitychange', () => {
      audio.setBackgrounded(document.hidden)
    })
    this.pushPerfState()
    this.ui.setPaLang(this.paLang)
    this.ui.setScheduleLevel(this.schedule.level)
    this.setCameraMode(this.cameraMode)
    this.onResize()
    this.updateCameraFromTrain()
    // No animation loop yet: the start screen is a single static render, not
    // a spinning render loop burning battery behind the overlay. tick()
    // proper only starts once the player actually taps "start".
    this.renderOnce()
  }

  /** Japanese plus the player's language — see the PA note at the top of the file. */
  private paSegments(ja: string, en: string, es: string) {
    return [
      { lang: 'ja' as const, text: ja },
      this.paLang === 'es' ? { lang: 'es' as const, text: es } : { lang: 'en' as const, text: en },
    ]
  }

  /**
   * Starts/stops a frame-time recording. Everything the log can't ask for
   * later — device, screen, renderer, what the weather was — is captured at
   * the moment it starts, because a frame-time number without the context it
   * was measured in is unfalsifiable.
   */
  private togglePerfRecording(persistDuringRun = true) {
    if (this.perf.recording) {
      this.perf.stop()
      setActivePerfLog(null)
    } else {
      setActivePerfLog(this.perf)
      const gl = this.renderer.getContext()
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      this.perf.start({
        // Which BUILD produced this lap. Without it, two logs can only be
        // compared by trusting that nothing changed in between.
        version: __APP_VERSION__,
        commit: __APP_COMMIT__,
        ua: navigator.userAgent,
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/d',
        dpr: window.devicePixelRatio,
        cap: this.renderer.getPixelRatio(),
        vw: window.innerWidth,
        vh: window.innerHeight,
        // A PWA on the home screen and the same page in a Safari tab are not
        // the same runtime, and they don't perform the same.
        pwa: window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true,
        season: this.season,
        weather: this.weather,
        // A lap driven under auto fronts is not repeatable: the sky changes
        // itself mid-measurement, so "same conditions" is not a claim you can
        // make about it afterwards.
        weatherAuto: this.weatherAuto,
        // The view decides what gets drawn at all — the cab hides the consist
        // entirely, the outside views build it.
        camera: this.cameraMode,
        hour: Math.round(this.dayNight.timeOfDay * 10) / 10,
        timeScale: this.timeScale,
        // The renderer SETTING. Whether the pass actually ran is `shadowFrames`
        // in the summary: under a closed sky the sun stops casting, so a rainy
        // lap reports `shadows: true` and never pays for one.
        shadows: this.renderer.shadowMap.enabled,
        // The audio A/B needs this on the record: two cold runs, one muted,
        // are the only way left to test the audio path now that the stall is
        // known to be outside every synchronous phase we measure.
        muted: this.muted,
        // Seconds since this Game was built. Cold versus warm decided a whole
        // A/B once: a muted run taken minutes into a session had everything
        // already uploaded, so "the stalls went away" was equally consistent
        // with the audio being the cause and with there being nothing left to
        // load. Inferring it from ctx.hour and texUploads0 worked, but a run
        // should state its own starting conditions.
        uptime: Math.round((performance.now() - this.bornAt) / 1000),
        // Whether real GPU timing is even available on this device. `renderMs`
        // is CPU-blocked time, so it cannot tell deferred driver work from no
        // work at all; this says whether the honest measurement is on the
        // table here or whether we are stuck with inference.
        gpuTimer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      }, {
        // Read here, before the lap's first render. Inferring this from the
        // first sample instead would fold whatever that render compiled into
        // the baseline — and the first frame after pressing record is the
        // likeliest of the whole lap to compile something.
        programs: this.renderer.info.programs?.length ?? 0,
        textures: this.renderer.info.memory.textures,
        // Already true when we get here: the watch polls every frame, not
        // only while recording, so nothing resident gets counted as new.
        texUploads: this.uploadWatch.poll(),
      }, persistDuringRun)
    }
    this.pushPerfState()
  }

  private pushPerfState() {
    this.ui.setPerfState(this.perf.recording, this.perf.headline, this.perf.frames > 0 || PerfLog.hasStored())
  }

  private start() {
    this.schedule.reset(this.train.targetStationIndex)
    audio.unlock()
    // Bake the rainy-day sprite sheet while nothing is happening: the front
    // director can start rain mid-drive, and a canvas bake + texture upload
    // on that frame would be a hitch with PerfLog pointing at nothing.
    const idle = (window as any).requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 2500))
    idle(() => this.passengers.prebakeWet())
    this.started = true
    this.clock.start()
    this.setRunning(true)
    // Fire-and-forget — never blocks the game loop or player input, which
    // can already move the train while this plays out.
    window.setTimeout(() => this.handleWelcomeAnnounce(), 500)
  }

  /** Menu open/close: a real pause, not just a frozen simulation — the render loop itself stops. */
  private setPaused(p: boolean) {
    // Pausing mid-probe invalidates the run: stopping the loop renders a frame
    // nobody records, which warms resources outside the log — the exact thing
    // the probe exists to prevent. Better to abandon it loudly than to hand
    // back a lap that looks fine and is not.
    if (p && this.probe) this.abortProbe()
    if (this.started) this.setRunning(!p)
    // The menu is where the recording is read, so refresh its numbers as it opens.
    if (p) this.pushPerfState()
  }

  /**
   * Starts or stops the actual WebGL animation loop. Stopping it (rather
   * than just skipping `step()` inside a loop that keeps spinning) is what
   * saves battery/heat on the start screen and while paused — `tick()` was
   * previously called every frame regardless of game state.
   */
  private setRunning(running: boolean) {
    this.running = running
    if (running) {
      this.clock.getDelta() // discard the stale interval built up while stopped
      this.renderer.setAnimationLoop(() => this.tick())
    } else {
      this.renderer.setAnimationLoop(null)
      this.renderOnce()
    }
  }

  /** Renders exactly one frame without advancing simulation — the start screen backdrop and the frame shown right when pausing/resizing. */
  private renderOnce() {
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Applies the selected season + weather across every system that cares:
   * vegetation/terrain recolor, Fuji snowline, platform canopies, overcast
   * lighting, the precipitation curtain (rain, or snow in winter) and the
   * audio layers. One-off cost on change; nothing per-frame.
   */
  private applyAtmosphere() {
    this.scenery.setSeason(this.season)
    this.scenery.setWeather(this.weather)
    this.city.setSeason(this.season)
    for (const pool of this.terrainPools) applySeasonToPool(pool, this.season)
    // The rail corridor joins the winter: ballast whites over (overdriven
    // against its dark texture) and the beaten-earth band fades under snow.
    const winter = this.season === 'winter'
    this.ballastMat.color.setScalar(winter ? 1.65 : 1)
    this.wearMat.opacity = winter ? 0.25 : 1
    this.dayNight.overcastGoal = overcastTarget(this.weather)
    // Snow bounces the light back up: an overcast winter noon stays BRIGHT
    // (H1's "invierno apagado bajo nublado" fix lives in DayNightCycle).
    this.dayNight.snowAlbedo = winter ? 1 : 0
    // Thundersnow is a freak event, not a Tokyo January: a winter storm is a
    // ventisca — all wind and snow, no lightning.
    this.dayNight.stormy = this.weather === 'storm' && !winter
    // Precipitation itself is driven per frame from applyPrecipitation(),
    // because its strength also depends on the hour, which never stops moving.
    this.applyPrecipitation()
    this.applyRailCondition()
    audio.setSeason(this.season)
    this.ui.setAtmo(this.season, this.weather, this.dayNight.timeOfDay)
  }

  /**
   * Weather-only change (the panel's weather buttons and the H3 front
   * director): everything applyAtmosphere does EXCEPT the seasonal recolor
   * passes, which a weather change doesn't need — the director changes the
   * sky every couple of minutes and repainting 500 houses for that would be
   * a self-inflicted hitch.
   */
  private applyWeather(w: Weather) {
    this.weather = w
    localStorage.setItem(WEATHER_KEY, w)
    this.scenery.setWeather(w)
    this.dayNight.overcastGoal = overcastTarget(w)
    this.dayNight.stormy = w === 'storm' && this.season !== 'winter'
    this.applyPrecipitation()
    this.applyRailCondition()
    this.ui.setAtmo(this.season, w, this.dayNight.timeOfDay)
  }

  private setWeatherAuto(auto: boolean) {
    this.weatherAuto = auto
    localStorage.setItem(WEATHER_AUTO_KEY, auto ? '1' : '0')
    this.ui.setWeatherAuto(auto)
  }

  /** One step of the H3 front director: walk the chain, dwell, tell the player what's rolling in. */
  private advanceFront() {
    const options = FRONT_CHAIN[this.weather]
    let roll = Math.random()
    let next: Weather = this.weather
    for (const [w, p] of options) {
      roll -= p
      if (roll <= 0) {
        next = w
        break
      }
    }
    const [dMin, dMax] = FRONT_DWELL[next]
    this.frontTimer = dMin + Math.random() * (dMax - dMin)
    if (next === this.weather) return
    const wasFalling = this.weather === 'rain' || this.weather === 'storm'
    const winter = this.season === 'winter'
    this.applyWeather(next)
    // Narrate only the moments that change the driving: precipitation
    // starting or stopping. Cloud cover comes and goes without commentary.
    if (!wasFalling && (next === 'rain' || next === 'storm')) {
      this.ui.showWeatherToast(winter ? 'Empieza a nevar ❄️' : next === 'storm' ? 'Un frente de tormenta encima ⛈️' : 'Empieza a llover 🌧️')
    } else if (wasFalling && next !== 'rain' && next !== 'storm') {
      this.ui.showWeatherToast(winter ? 'Deja de nevar' : 'Escampa ☂️')
    }
  }

  /** Seconds of reduced adhesion left after the rain stops — a railhead doesn't dry the instant the sky closes. */
  private wetLingerSeconds = 0

  /** What the railhead is like right now — and everything that reacts when it changes. */
  private applyRailCondition() {
    const falling = this.weather === 'rain' || this.weather === 'storm'
    if (falling) this.wetLingerSeconds = 75
    const slick = falling || this.wetLingerSeconds > 0
    const cond: RailCondition = !slick ? 'dry' : this.season === 'winter' ? 'snow' : 'wet'
    if (cond === this.train.railCondition) return
    this.train.railCondition = cond
    this.ui.setRailCondition(cond, RAIL_ADVISORY_KMH[cond])
    if (cond !== 'dry' && !this.railTipShown && this.started) {
      this.railTipShown = true
      localStorage.setItem(RAIL_TIP_KEY, '1')
      this.ui.showHint(
        'Adherencia reducida',
        cond === 'wet'
          ? 'Con el carril mojado los frenos altos patinan: B4–B7 rinden igual (poco). Empieza a frenar antes — desde la baliza de 250 m, mejor por debajo de 65 km/h.'
          : 'Nieve en el carril: B3 en adelante rinden igual (poco). Frena mucho antes — desde la baliza de 250 m, mejor por debajo de 55 km/h.',
      )
    }
  }

  /**
   * Pushes the current weather+season+hour into the precipitation curtain and
   * the rain bed. Called every frame: the hour is a continuous input (rain
   * builds through the afternoon and eases overnight — see rainPhase01), so
   * this can't be a one-off on the weather change. Writing the profile costs
   * a few uniform-bound numbers into a shared scratch object; the audio side
   * only gets poked when the level has actually moved, since each call
   * schedules Web Audio ramps.
   */
  private applyPrecipitation() {
    const p = precipProfile(this.weather, this.season, this.dayNight.timeOfDay)
    // Inside the tunnel there is no sky: the curtain thins to nothing and
    // the rain bed goes with it (the profile is a scratch object — mutating
    // it here is exactly what it is for).
    if (this.tunnelF > 0.001) {
      p.density *= 1 - this.tunnelF
      // Floor, not zero, while it IS raining outside: the storm keeps
      // resonating faintly down the trench, and — the real reason — the
      // rain sources never sleep+restart across a 20-second tunnel transit
      // (BufferSource.start() at the exit portal is exactly the iOS
      // hot-path call the chime freeze taught us to avoid).
      p.audioLevel = Math.max(p.audioLevel * (1 - this.tunnelF), p.falling && !p.snow ? 0.02 : 0)
      p.windAudio *= 1 - 0.85 * this.tunnelF
    }
    this.precipitation.set(p)
    // Wet-day wardrobe: commuters carry (furled) umbrellas while anything falls.
    this.passengers.setWet(p.falling)
    // The windshield overlay reads the same profile the curtain does.
    this.wsIntensity = p.falling ? p.density : 0
    this.wsSnow = p.snow
    // Rain sounds louder from a train that's running: the same drops arrive
    // at the glass with the train's speed behind them. The visual half of
    // that idea is the streak rake in Precipitation.
    const level = p.audioLevel * (1 + 0.4 * this.train.speed01)
    if (Math.abs(level - this.lastRainAudioLevel) > 0.03 || (level === 0) !== (this.lastRainAudioLevel === 0)) {
      this.lastRainAudioLevel = level
      audio.setRain(level)
    }
    if (Math.abs(p.windAudio - this.lastWindAudioLevel) > 0.03 || (p.windAudio === 0) !== (this.lastWindAudioLevel === 0)) {
      this.lastWindAudioLevel = p.windAudio
      audio.setWind(p.windAudio)
    }
  }

  /**
   * Moves people through the open doorway, a few per frame. Alighters first
   * and the queue only after they are clear — the order is the whole point of
   * the ritual, and it is also why holding the doors an extra second is worth
   * something. Whatever has not crossed when the doors shut simply never
   * happened: those riders are still aboard and those people are still on the
   * platform, and the counters say so.
   */
  private updateTransfer(dt: number) {
    const tr = this.transfer
    if (!tr || tr.phase === 'waiting' || tr.phase === 'done') return
    if (this.train.doorsOpenAmount < 0.6) return // still swinging: nobody steps through a half-open door

    tr.carry += tr.rate * dt
    const step = Math.floor(tr.carry)
    if (step <= 0) return
    tr.carry -= step

    if (tr.phase === 'alighting') {
      const moved = this.flow.alight(tr.station, Math.min(step, tr.alightLeft))
      tr.alightLeft -= moved
      tr.alighted += moved
      if (tr.alightLeft <= 0 || moved === 0) {
        tr.phase = 'boarding'
        // The doorway is clear: now the files may step in.
        this.passengers.releaseQueue(tr.station, this.train.boardingSeconds)
      }
    } else if (tr.phase === 'boarding') {
      const moved = this.flow.board(tr.station, Math.min(step, tr.boardLeft))
      tr.boardLeft -= moved
      tr.boarded += moved
      if (tr.boardLeft <= 0 || moved === 0) tr.phase = 'done'
    }
    this.ui.setOccupancy(this.flow.onboard, TRAIN_CAPACITY, false)
  }

  /**
   * Tester teleport (the line-diagram sheet): land 300 units short of the
   * chosen platform, driving. Any half-open stop is abandoned WITHOUT the
   * left-behind penalty — a jump is a test action, not a service failure —
   * and the timetable resyncs to ON TIME at the landing point.
   */
  private teleportToStation(idx: number) {
    if (!this.started) return
    // Abandon any in-progress stop cleanly: melody off, sprites back to
    // their queues, no transfer left half-counted.
    this.transfer = null
    audio.stopMelodyLoop()
    this.passengers.endBoarding()

    const UNITS_BEFORE = 300
    this.train.jumpToApproach(idx, UNITS_BEFORE)
    // Segment progress at the landing point feeds the schedule resync.
    const prevT = this.track.markerFor(this.train.currentStationIndex).tFraction
    const targetT = this.track.markerFor(idx).tFraction
    const segLen = ((((targetT - prevT) % 1) + 1) % 1) * this.track.getLength() || 1
    this.schedule.resync(idx, THREE.MathUtils.clamp(1 - UNITS_BEFORE / segLen, 0, 1))
    // The platform camera should watch the platform being approached now.
    if (this.cameraMode === 'platform') {
      this.platformStation = idx
      this.platYaw = 0
      this.platPitch = 0
    }
    this.controls.syncNotch(0)
    perfMark('teleport')
    this.ui.showTeleportToast(idx)
    this.updateCameraFromTrain()
    if (!this.running) this.renderOnce()
  }

  /** One control for both door moves — the train decides which (if any) applies right now. */
  private handleDoorButton() {
    if (!this.started) return
    const wasBoarding = this.train.state === 'doors_open' && !this.train.boardingComplete
    if (!this.train.requestDoorAction()) return
    navigator.vibrate?.(12)
    // The first time you cut a boarding short, say what the trade actually is.
    // It is the central decision of the job and it is not obvious from a button.
    if (wasBoarding && !this.interruptTipShown) {
      this.interruptTipShown = true
      localStorage.setItem(INTERRUPT_TIP_KEY, '1')
      this.ui.showHint(
        'Has cortado el embarque',
        'Ganas tiempo para el horario, pero quien no haya llegado a la puerta se queda en el andén — y cuenta en tu contra.',
      )
    }
  }

  private handleLook(dx: number, dy: number) {
    if (this.cameraMode === 'exterior') {
      // Free all the way round the sides; the elevation is what gets fenced.
      this.extYaw -= dx * 0.005
      this.extPitch = THREE.MathUtils.clamp(this.extPitch + dy * 0.004, EXT_PITCH_MIN, EXT_PITCH_MAX)
      if (!this.running) this.renderOnce()
      return
    }
    if (this.cameraMode === 'platform') {
      this.platYaw = THREE.MathUtils.clamp(this.platYaw - dx * 0.0035, -CCTV_YAW_LIMIT, CCTV_YAW_LIMIT)
      this.platPitch = THREE.MathUtils.clamp(this.platPitch - dy * 0.003, CCTV_PITCH_MIN, CCTV_PITCH_MAX)
      if (!this.running) this.renderOnce()
      return
    }
    if (this.cameraMode !== 'cab') return
    const sens = 0.0032
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * sens, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT)
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * sens, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT)
  }

  /** The session's one-time welcome cue: next stop, with a retro chiptune fanfare. */
  private handleWelcomeAnnounce() {
    const next = STATIONS[this.train.targetStationIndex]
    const sides = doorSidePhrases(next.doorSide)
    audio.announce(
      this.paSegments(
        `次は、${next.nameJa}、${next.nameJa}です。お出口は${sides.ja}です。`,
        `The next station is ${next.nameEn}. Doors will open on the ${sides.en} side.`,
        `Próxima estación: ${next.nameEn}. Las puertas se abrirán por el lado ${sides.es}.`,
      ),
      { fanfare: true, kind: 'depart' },
    )
  }

  /** Always names the door side. Japanese first — it's the host country's line — then the player's language. */
  private handleDepartAnnounce(nextIdx: number) {
    const next = STATIONS[nextIdx]
    const sides = doorSidePhrases(next.doorSide)
    audio.announce(
      this.paSegments(
        `次は、${next.nameJa}、${next.nameJa}です。お出口は${sides.ja}です。`,
        `The next station is ${next.nameEn}. Doors will open on the ${sides.en} side.`,
        `Próxima estación: ${next.nameEn}. Las puertas se abrirán por el lado ${sides.es}.`,
      ),
      { kind: 'depart', valid: () => this.train.targetStationIndex === nextIdx },
    )
  }

  private handleArrivingAnnounce(idx: number) {
    const station = STATIONS[idx]
    const sides = doorSidePhrases(station.doorSide)
    const transferJa = station.transferLines?.length ? ` ${station.transferLines.join('、')}はお乗り換えです。` : ''
    const transferEn = station.transferLines?.length ? ` Please change here for ${station.transferLines.join(', ')}.` : ''
    audio.announce(
      this.paSegments(
        `まもなく、${station.nameJa}、${station.nameJa}です。${transferJa} お出口は${sides.ja}です。`,
        `We will soon arrive at ${station.nameEn}.${transferEn} The doors on the ${sides.en} side will open.`,
        `Llegamos a ${station.nameEn}. Las puertas se abrirán por el lado ${sides.es}.`,
      ),
      // Still relevant only while that station is the one we're heading for.
      { kind: 'arriving', valid: () => this.train.targetStationIndex === idx },
    )
  }

  private handleDoorsOpen(idx: number, info: DoorActionInfo) {
    this.controls.syncNotch(0)
    audio.playDoorCycle(true)
    const chimeDuration = audio.playMelody(DOOR_CHIME_OPEN, 'attention', 0.45) || 0.5
    window.setTimeout(() => {
      audio.startMelodyLoop(getStationMelody(STATIONS[idx].id), 'bell', 0.4)
    }, chimeDuration * 1000 + 120)
    // The platform reacts to the doors actually opening: waiting sprites
    // stream aboard, a few riders step off first.
    // Doors open: the alighting half of the ritual starts. The queue is
    // released only once these are clear (updateTransfer decides when).
    if (this.transfer && this.transfer.station === idx) {
      this.transfer.phase = this.transfer.alightLeft > 0 ? 'alighting' : 'boarding'
      this.passengers.beginAlighting(idx, Math.round(this.transfer.alightLeft / 6))
      if (this.transfer.phase === 'boarding') this.passengers.releaseQueue(idx, this.train.boardingSeconds)
    }
    if (!info.auto) {
      if (info.delaySeconds <= OPEN_INSTANT_SECONDS) this.applyDoorBonus(DOOR_OPEN_INSTANT_POINTS, '¡Puertas al instante!')
      else if (info.delaySeconds <= OPEN_QUICK_SECONDS) this.applyDoorBonus(DOOR_OPEN_QUICK_POINTS, 'Puertas rápidas')
    }
  }

  private handleDoorsClosingWarning() {
    // Stop future melody repeats so the closing-warning window reads
    // clearly instead of competing with the next loop iteration.
    audio.stopMelodyLoop()
    audio.announce(
      this.paSegments('ドアが閉まります。ご注意ください。', 'The doors are closing.', 'Las puertas se cierran.'),
      { kind: 'closing' },
    )
  }

  /** Doors shut: settle up. Whoever did not cross is simply still where they were. */
  private settleTransfer() {
    const tr = this.transfer
    if (!tr) return
    this.transfer = null
    const missed = tr.alightLeft + tr.boardLeft
    this.ui.setOccupancy(this.flow.onboard, TRAIN_CAPACITY, false)
    this.ui.showTransferToast(tr.station, tr.alighted, tr.boarded, missed)
    // Cutting a transfer short is a real failure of the job, not a shortcut.
    if (missed > 12) {
      const penalty = Math.min(60, Math.round(missed * 0.35))
      this.score = Math.max(0, this.score - penalty)
      this.ui.setScore(this.score, this.bestScore, this.perfectStreak)
    }
  }

  private handleDoorsClose(info: DoorActionInfo) {
    this.settleTransfer()
    audio.stopMelodyLoop()
    audio.playDoorCycle(false)
    audio.playMelody(DOOR_CHIME_CLOSE, 'attention', 0.4)
    this.passengers.endBoarding()
    if (!info.auto) {
      // Manual closes announce as they act (like a real conductor) — unless
      // the hurry-up warning already said it seconds ago.
      if (info.delaySeconds < CLOSE_HURRY_SECONDS) this.handleDoorsClosingWarning()
      if (info.delaySeconds <= CLOSE_WINDOW_SECONDS) this.applyDoorBonus(DOOR_CLOSE_SHARP_POINTS, '¡Salida puntual!')
    }
  }

  /** Door bonuses ride the same score pool but never touch the perfect-stop streak. */
  private applyDoorBonus(points: number, label: string) {
    this.score += points
    if (this.score > this.bestScore) {
      this.bestScore = this.score
      localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore))
    }
    this.ui.setScore(this.score, this.bestScore, this.perfectStreak)
    this.ui.showDoorToast(label, points)
  }

  private buildTrackVisual() {
    const segments = 900
    const halfWidth = 4.2
    const positions: number[] = []
    const uvs: number[] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const pl = p.clone().addScaledVector(normal, halfWidth)
      const pr = p.clone().addScaledVector(normal, -halfWidth)
      positions.push(pl.x, p.y - 0.06, pl.z, pr.x, p.y - 0.06, pr.z)
      uvs.push(0, t * 300, 1, t * 300)
    }
    const indices: number[] = []
    for (let i = 0; i < segments; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
      indices.push(a, b, c, b, d, c)
    }
    const bedGeo = new THREE.BufferGeometry()
    bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    bedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    bedGeo.setIndex(indices)
    bedGeo.computeVertexNormals()
    const ballast = makeBallastTexture()
    const bedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ballast.map, roughnessMap: ballast.roughnessMap, roughness: 1 })
    this.ballastMat = bedMat
    const bed = new THREE.Mesh(bedGeo, bedMat)
    bed.receiveShadow = true
    this.scene.add(tagGroup(bed, 'ballast-bed'))

    // Sleepers: individual boards with air between them (they used to be
    // longer than their spacing and fused into a dark ribbon), each with a
    // little placement/size jitter and its own wood tone — and a warm honey
    // tint inside every station's stop zone so the braking area reads at a
    // glance from the cab.
    const sleeperSpacing = 1.7
    const sleeperCount = Math.floor(this.track.getLength() / sleeperSpacing)
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.15, 0.95), sleeperMat, sleeperCount)
    sleepers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sleeperCount * 3), 3)
    sleepers.receiveShadow = true
    // Baked contact shadow: a soft-edged AO pad barely larger than each
    // board — a hard black rectangle read as a floating slab of its own.
    const shadowTex = (() => {
      const c = document.createElement('canvas')
      c.width = 128
      c.height = 64
      const ctx = c.getContext('2d')!
      const g = ctx.createRadialGradient(64, 32, 4, 64, 32, 62)
      g.addColorStop(0, 'rgba(0,0,0,0.55)')
      g.addColorStop(0.55, 'rgba(0,0,0,0.35)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.save()
      ctx.translate(64, 32)
      ctx.scale(1, 0.5)
      ctx.translate(-64, -32)
      ctx.fillStyle = g
      ctx.fillRect(0, -32, 128, 128)
      ctx.restore()
      const tex = new THREE.CanvasTexture(c)
      return tex
    })()
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.8, depthWrite: false })
    const sleeperShadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.6, 1.15), shadowMat, sleeperCount)
    const sleeperDummy = new THREE.Object3D()
    const sleeperTint = new THREE.Color()
    const zoneTint = new THREE.Color(0x7d5f2e)
    const trackLen = this.track.getLength()
    const markerTs = STATIONS.map((_, i) => this.track.markerFor(i).tFraction)
    for (let i = 0; i < sleeperCount; i++) {
      const t = i / sleeperCount
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      // Just a whisper of irregularity — boards laid by hand, not scattered.
      sleeperDummy.position.set(
        p.x + (tracksideRnd() - 0.5) * 0.05,
        p.y - 0.02,
        p.z + (tracksideRnd() - 0.5) * 0.05,
      )
      // Pitch each board along the grade: the lookAt target must carry the
      // tangent's vertical component, or on a slope the sleepers stay level and
      // read as a staircase instead of a ramp.
      sleeperDummy.lookAt(p.x + tangent.x, p.y - 0.02 + tangent.y, p.z + tangent.z)
      sleeperDummy.rotateY((tracksideRnd() - 0.5) * 0.018)
      sleeperDummy.scale.set(0.97 + tracksideRnd() * 0.06, 1, 0.95 + tracksideRnd() * 0.1)
      sleeperDummy.updateMatrix()
      sleepers.setMatrixAt(i, sleeperDummy.matrix)

      sleeperDummy.position.y = p.y - 0.088
      sleeperDummy.rotateX(-Math.PI / 2)
      sleeperDummy.updateMatrix()
      sleeperShadows.setMatrixAt(i, sleeperDummy.matrix)
      sleeperDummy.rotation.set(0, 0, 0)

      // Dark creosote wood with slight per-board variation…
      sleeperTint.setHSL(0.075 + tracksideRnd() * 0.015, 0.26 + tracksideRnd() * 0.1, 0.085 + tracksideRnd() * 0.035)
      // …shifted toward honey inside a stop zone: the braking guide.
      let minDist = Infinity
      for (const mt of markerTs) {
        const d = Math.abs((((t - mt) % 1) + 1.5) % 1 - 0.5) * trackLen
        if (d < minDist) minDist = d
      }
      if (minDist < 26) sleeperTint.lerp(zoneTint, 0.55)
      sleepers.setColorAt(i, sleeperTint)
    }
    sleepers.instanceMatrix.needsUpdate = true
    sleeperShadows.instanceMatrix.needsUpdate = true
    if (sleepers.instanceColor) sleepers.instanceColor.needsUpdate = true
    this.scene.add(tagGroup(sleepers, 'sleepers'), tagGroup(sleeperShadows, 'sleeper-shadows'))

    // Wide ground plane so the world doesn't feel like it ends at the ballast
    // edge — with a faint city-block texture so it reads as streets from the
    // cab. Sized well past the skyline belt (see LOOP_SCALE in Track.ts) so no edge is
    // ever visible, even with the longer night fog range.
    const groundTex = makeGroundTexture()
    groundTex.repeat.set(56, 56)
    // Segmented + vertex-colored: neutral in the corridor the embankment
    // ribbon rides on, opening into broad meadow-green patches farther out —
    // the uniform billiard felt made the whole plain read as one flat slab.
    const GROUND_SEGS = 96
    const groundGeo = new THREE.PlaneGeometry(14000, 14000, GROUND_SEGS, GROUND_SEGS)
    const trackPts: { x: number; z: number }[] = []
    for (let i = 0; i < 256; i++) {
      const p = this.track.pointAt(i / 256)
      trackPts.push({ x: p.x, z: p.z })
    }
    const gPos = groundGeo.attributes.position
    const gColors = new Float32Array(gPos.count * 3)
    // Bright multipliers on purpose: the ground texture's base is dark, so a
    // subtle tint drowned in it — these push the far fields clearly green.
    const meadow = new THREE.Color(0xb4dc92)
    const scorch = new THREE.Color(0xd2bc8e)
    const vCol = new THREE.Color()
    for (let i = 0; i < gPos.count; i++) {
      // Plane is later rotated -90° around X, so local (x, y) is world (x, -z).
      const wx = gPos.getX(i)
      const wz = -gPos.getY(i)
      let d2min = Infinity
      let nearIdx = 0
      for (let k = 0; k < trackPts.length; k++) {
        const dx = trackPts[k].x - wx
        const dz = trackPts[k].z - wz
        const d2 = dx * dx + dz * dz
        if (d2 < d2min) {
          d2min = d2
          nearIdx = k
        }
      }
      const dist = Math.sqrt(d2min)
      // Terrain 2.0: the far plain rolls. Amplitude is zero near the rail
      // corridor by construction (see terrainRelief) and masked to zero on
      // the seaward side of the bay arc, where the water needs a dead-flat
      // bed to sit on. Local +z becomes world +y after the -90° rotation.
      const nearT = nearIdx / trackPts.length
      const tp = trackPts[nearIdx]
      const seaward = wx * wx + wz * wz > tp.x * tp.x + tp.z * tp.z
      const inBaySea = seaward && nearT > 0.76 && nearT < 0.96
      gPos.setZ(i, inBaySea ? 0 : terrainRelief(wx, wz, dist))
      // Neutral until past the embankment's reach, then out into the fields.
      const far = THREE.MathUtils.clamp((dist - 160) / 320, 0, 1)
      // Low-frequency patchwork so the far ground varies instead of tiling:
      // meadows with the occasional dry scorched field.
      const n = Math.sin(wx * 0.0021 + wz * 0.0013) + Math.sin(wx * 0.0007 - wz * 0.0019 + 2.1)
      const green = THREE.MathUtils.clamp(0.55 + n * 0.42, 0, 1)
      vCol.setRGB(1, 1, 1)
        .lerp(meadow, far * green)
        .lerp(scorch, far * (1 - green) * 0.35)
      gColors[i * 3] = vCol.r
      gColors[i * 3 + 1] = vCol.g
      gColors[i * 3 + 2] = vCol.b
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(gColors, 3))
    groundGeo.computeVertexNormals() // the displaced hills need real normals to shade
    this.terrainPools.push(registerPool('terrain', groundGeo.getAttribute('color') as THREE.BufferAttribute))
    // ——— The hole over the Shibuya trench ———
    // The plane is one seamless sheet at -0.5, so without this it slices
    // straight across the cutting: diving toward the portal, the cab's eye
    // crossed y=-0.5 and visibly passed THROUGH the ground (Rubén's device
    // report). Four clipping planes with clipIntersection form the corridor
    // prism, and only fragments inside ALL four (the corridor) are dropped —
    // a clean rectangular opening that reads as the open cut it is. The
    // corridor is a chord approximation of the curved window: the track
    // deviates from the chord by up to 16.61 units over this arc (measured
    // numerically against the real CatmullRom — NOT the ~12 first guessed),
    // so ±26 of lateral margin covers the bore (±6.4 → reaches 23.0 from
    // the chord) everywhere along it. Anything placed at street level near
    // this window must clear the hole measured FROM THE CHORD: pines/scrub
    // resample under off<44, City blocks clamp to ≥59 (off − 16.61 − reach
    // must beat 26). If the ground ever gains castShadow, it also needs
    // clipShadows=true or its shadow won't have the hole.
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: groundTex, roughness: 1, vertexColors: true })
    {
      const holeHalfWidth = 26
      const capMargin = 6
      const tCenter = this.track.trenchCenterFraction
      const portalOff = trenchPortalOffset()
      const pA = this.track.pointAt(tCenter - portalOff)
      const pB = this.track.pointAt(tCenter + portalOff)
      const chord = new THREE.Vector3(pB.x - pA.x, 0, pB.z - pA.z).normalize()
      const lateral = new THREE.Vector3(-chord.z, 0, chord.x)
      const mid = new THREE.Vector3((pA.x + pB.x) / 2, 0, (pA.z + pB.z) / 2)
      // Outward normals: a fragment inside the corridor sits BEHIND all four
      // planes, which with clipIntersection=true is exactly what gets cut.
      const planes = [
        new THREE.Plane().setFromNormalAndCoplanarPoint(chord.clone().negate(), pA.clone().addScaledVector(chord, -capMargin)),
        new THREE.Plane().setFromNormalAndCoplanarPoint(chord.clone(), pB.clone().addScaledVector(chord, capMargin)),
        new THREE.Plane().setFromNormalAndCoplanarPoint(lateral.clone(), mid.clone().addScaledVector(lateral, holeHalfWidth)),
        new THREE.Plane().setFromNormalAndCoplanarPoint(lateral.clone().negate(), mid.clone().addScaledVector(lateral, -holeHalfWidth)),
      ]
      groundMat.clippingPlanes = planes
      groundMat.clipIntersection = true
    }
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.5
    ground.receiveShadow = true
    this.scene.add(tagGroup(ground, 'ground-plane'))

    // Trackside embankment: a ribbon that follows the rails and carries the
    // ground up and over the hill in the quiet green zone. On flat stretches its
    // crown sits a hair above the city ground (a realistic raised rail bed);
    // where the curve climbs, it becomes a grassy hillside whose skirts tuck
    // back under the ground plane, so the hill grows out of the plain with no
    // seam. Vertex colour greens the slopes only where the land actually rises.
    const EMB_CROWN = EMBANKMENT.crown
    const EMB_SKIRT = EMBANKMENT.skirt
    const embLateral = [-(EMB_CROWN + EMB_SKIRT), -EMB_CROWN, EMB_CROWN, EMB_CROWN + EMB_SKIRT]
    const embPositions: number[] = []
    const embColors: number[] = []
    const embUvs: number[] = []
    // The ribbon IS the visible ground beside the rails, so it carries the
    // "worked earth" corridor: warm dusty crown near the track, fading to the
    // plain's neutral at the skirt foot (which tucks under the ground plane,
    // so the two can never show a seam), and greening as the land rises.
    const crownEarth = new THREE.Color(0xc9b48f)
    const plainCol = new THREE.Color(0xffffff)
    const grassCol = new THREE.Color(0x93c46b)
    // Inside the trench the ground is ballast and slab, not meadow — and it
    // must NOT join the seasonal repaint (snow doesn't fall inside a covered
    // tunnel). The trench rings get this fixed tone and are excluded from
    // the pool registration below (Yui, round 1).
    const trenchFloor = new THREE.Color(0x8b8d90)
    let trenchRingFirst = -1
    let trenchRingLast = -1
    const embCol = new THREE.Color()
    // Same texel density as the ground plane (14000 wide at repeat 56 = one
    // tile per 250 units), so the ribbon's detail matches the terrain it sits
    // in instead of reading as a bare untextured shape.
    const EMB_TILE = 250
    const embTrackLen = this.track.getLength()
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const climb = THREE.MathUtils.clamp(p.y / HILL_PEAK, 0, 1)
      const inTrench = this.track.trenchDepthAt(t) > 0.4
      if (inTrench) {
        if (trenchRingFirst < 0) trenchRingFirst = i
        trenchRingLast = i
      }
      for (let k = 0; k < 4; k++) {
        const crown = k === 1 || k === 2
        const y = embankmentSurface(p.y, embLateral[k])
        const pos = p.clone().addScaledVector(normal, embLateral[k])
        embPositions.push(pos.x, y, pos.z)
        if (inTrench) embCol.copy(trenchFloor)
        else if (crown) embCol.copy(crownEarth).lerp(grassCol, climb)
        else embCol.copy(plainCol).lerp(grassCol, climb * 0.6)
        embColors.push(embCol.r, embCol.g, embCol.b)
        embUvs.push(embLateral[k] / EMB_TILE, (t * embTrackLen) / EMB_TILE)
      }
    }
    // Winding matters: with the lateral axis running along the track normal and
    // the strip advancing along the tangent, the naive order produces DOWNWARD
    // face normals — the whole hill renders inside-out and vanishes through
    // backface culling. This order keeps the surface facing the sky.
    const embIndices: number[] = []
    for (let i = 0; i < segments; i++) {
      const base = i * 4
      const next = (i + 1) * 4
      for (let k = 0; k < 3; k++) {
        const a = base + k, b = base + k + 1, c = next + k, d = next + k + 1
        embIndices.push(a, b, c, b, d, c)
      }
    }
    const embGeo = new THREE.BufferGeometry()
    embGeo.setAttribute('position', new THREE.Float32BufferAttribute(embPositions, 3))
    embGeo.setAttribute('color', new THREE.Float32BufferAttribute(embColors, 3))
    embGeo.setAttribute('uv', new THREE.Float32BufferAttribute(embUvs, 2))
    embGeo.setIndex(embIndices)
    embGeo.computeVertexNormals()
    // Two pools bracketing the trench window, so the seasons never repaint
    // the tunnel floor (winter frost INSIDE a covered box read as a bug).
    const embAttr = embGeo.getAttribute('color') as THREE.BufferAttribute
    if (trenchRingFirst >= 0) {
      this.terrainPools.push(registerPool('terrain', embAttr, 0, trenchRingFirst * 4))
      this.terrainPools.push(registerPool('terrain', embAttr, (trenchRingLast + 1) * 4))
    } else {
      this.terrainPools.push(registerPool('terrain', embAttr))
    }
    const embTex = makeGroundTexture()
    embTex.wrapS = embTex.wrapT = THREE.RepeatWrapping
    const embMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: embTex,
      vertexColors: true,
      roughness: 1,
    })
    const embankment = new THREE.Mesh(embGeo, embMat)
    embankment.receiveShadow = true
    // No castShadow: a ribbon this large self-shadows into acne across the
    // slope, and the ground plane it blends into doesn't cast either.
    this.scene.add(tagGroup(embankment, 'embankment'))

    // Worn corridor beside the rails: a wider, alpha-edged band of beaten
    // earth riding just above the ground plane, so the trackside looks used
    // and the pristine ground only starts a little way out.
    const wearPositions: number[] = []
    const wearUvs: number[] = []
    const wearHalf = 14
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const pl = p.clone().addScaledVector(normal, wearHalf)
      const pr = p.clone().addScaledVector(normal, -wearHalf)
      wearPositions.push(pl.x, p.y - 0.42, pl.z, pr.x, p.y - 0.42, pr.z)
      wearUvs.push(0, t * 260, 1, t * 260)
    }
    const wearGeo = new THREE.BufferGeometry()
    wearGeo.setAttribute('position', new THREE.Float32BufferAttribute(wearPositions, 3))
    wearGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wearUvs, 2))
    wearGeo.setIndex(indices)
    wearGeo.computeVertexNormals()
    const wearMat = new THREE.MeshStandardMaterial({
      map: makeTracksideWearTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 1,
    })
    this.wearMat = wearMat
    const wear = new THREE.Mesh(wearGeo, wearMat)
    wear.receiveShadow = true
    this.scene.add(tagGroup(wear, 'trackside-wear'))

    const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 })
    for (const offset of [0.75, -0.75]) {
      const curve = new TrackOffsetCurve(this.track, offset)
      const railGeo = new THREE.TubeGeometry(curve, segments, 0.09, 6, true)
      const rail = new THREE.Mesh(railGeo, railMat)
      rail.castShadow = true
      rail.receiveShadow = true
      this.scene.add(tagGroup(rail, 'rails'))
    }

    this.buildCatenary()
  }

  private buildCatenary() {
    const trackLen = this.track.getLength()
    const poleSpacing = 42
    const poleCount = Math.max(8, Math.floor(trackLen / poleSpacing))
    const poleOffset = 5.6
    const poleHeight = 7
    const armLength = 4.6
    const wireHeight = 6.6

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.5, roughness: 0.5 })
    // Shafts run longer so their feet sink just below the ground plane
    // (-0.58) instead of hovering at track height.
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.16, poleHeight + 0.58, 8), poleMat, poleCount)
    poles.castShadow = true
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(armLength, 0.1, 0.1), poleMat, poleCount)

    const dummy = new THREE.Object3D()
    for (let i = 0; i < poleCount; i++) {
      const t = i / poleCount
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const base = p.clone().addScaledVector(normal, poleOffset)
      // Inside the tunnel the wire hangs from the lining, not from poles —
      // bury the instances that would otherwise stab through the ceiling.
      const buried = this.track.trenchDepthAt(t) > 1 ? -500 : 0

      dummy.position.set(base.x, base.y + (poleHeight - 0.58) / 2 + buried, base.z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)

      const armCenter = base.clone().addScaledVector(normal, -armLength / 2)
      dummy.position.set(armCenter.x, base.y + poleHeight + buried, armCenter.z)
      const inward = normal.clone().multiplyScalar(-1)
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), inward)
      dummy.updateMatrix()
      arms.setMatrixAt(i, dummy.matrix)
    }
    poles.instanceMatrix.needsUpdate = true
    arms.instanceMatrix.needsUpdate = true
    this.scene.add(tagGroup(poles, 'catenary-poles'), tagGroup(arms, 'catenary-arms'))

    const wireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 })
    const wireCurve = new CatenaryCurve(this.track, wireHeight, 0.18, poleCount)
    const wireGeo = new THREE.TubeGeometry(wireCurve, Math.max(600, poleCount * 8), 0.035, 5, true)
    const wire = new THREE.Mesh(wireGeo, wireMat)
    this.scene.add(tagGroup(wire, 'catenary-wire'))
  }

  /**
   * The cab, built in eye-local coordinates but hung from the SCENE, not from
   * the camera. Parented to the camera it rotated with your head — you could
   * never turn to look at your own console, because the console turned with
   * you. Now updateCameraFromTrain() plants the rig at the eye's base
   * transform each frame and only the camera takes the look rotation, so the
   * cab stays bolted to the train and you look around inside it.
   */
  private buildCabRig() {
    const cab = new THREE.Group()
    this.cabRig = cab
    // Re-planted at the driver's eye every frame in cab view, so it is placed
    // by the simulation and not by the world seed. The flag is inherited, so
    // this one line covers the whole console, pillars, lever and lamps.
    cab.userData.dynamic = true
    this.scene.add(cab)

    // Cab dome light: a soft warm pool over the console so the controls and
    // pillars stay readable after dark (stronger at night, ember-low by day).
    this.cabLight = new THREE.PointLight(0xffdfb0, 0.25, 3.2, 1.6)
    this.cabLight.position.set(0.1, 0.35, -0.5)
    cab.add(this.cabLight)

    // Tinted windshield, set behind the dashboard hardware so it reads as
    // glass between the driver and the world rather than a filter on top.
    // The tint FADES OUT toward the plane's edges: a constant-alpha quad
    // drew a hard vertical exposure line across the view whenever the head
    // turned toward a side window (Yui caught it crossing the coast).
    const tintAlpha = (() => {
      const cnv = document.createElement('canvas')
      cnv.width = 64
      cnv.height = 8
      const cctx = cnv.getContext('2d')!
      const grad = cctx.createLinearGradient(0, 0, 64, 0)
      grad.addColorStop(0, '#000')
      grad.addColorStop(0.28, '#fff')
      grad.addColorStop(0.72, '#fff')
      grad.addColorStop(1, '#000')
      cctx.fillStyle = grad
      cctx.fillRect(0, 0, 64, 8)
      return new THREE.CanvasTexture(cnv)
    })()
    const windshieldMat = new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.045, alphaMap: tintAlpha, depthWrite: false })
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.6), windshieldMat)
    windshield.position.set(0, 0.05, -1.05)
    cab.add(windshield)

    const panelTex = makeScuffedPanelTexture('#3a3f4a')
    panelTex.repeat.set(1.5, 1.5)
    // Faint self-illumination so the desk never falls to pure black between lamps.
    const consoleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: panelTex, roughness: 0.55, metalness: 0.35, emissive: 0x2a2c33, emissiveIntensity: 0.22 })
    const consoleMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.5), consoleMat)
    consoleMesh.position.set(0, -0.62, -0.85)
    consoleMesh.rotation.x = -0.25
    cab.add(consoleMesh)

    const pillarTex = makeScuffedPanelTexture('#33363d')
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pillarTex, roughness: 0.65 })
    const pillarGeo = new THREE.BoxGeometry(0.12, 1.3, 0.12)
    const pillarL = new THREE.Mesh(pillarGeo, pillarMat)
    pillarL.position.set(-0.86, -0.05, -0.88)
    pillarL.rotation.z = 0.12
    cab.add(pillarL)
    const pillarR = pillarL.clone()
    pillarR.position.x = 0.86
    pillarR.rotation.z = -0.12
    cab.add(pillarR)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.35), pillarMat)
    visor.position.set(0, 0.56, -0.85)
    cab.add(visor)

    const lampGeo = new THREE.SphereGeometry(0.022, 8, 8)
    const lampColors = [0x33ff66, 0xffcc33, 0xff3333]
    lampColors.forEach((color, i) => {
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }))
      lamp.position.set(-0.55 + i * 0.12, -0.42, -0.82)
      cab.add(lamp)
    })

    // Destination roll sign, updated only when the target station changes.
    this.destinationMat = new THREE.MeshBasicMaterial({ map: makeDestinationTexture('---'), toneMapped: false })
    const destPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.14), this.destinationMat)
    destPlane.position.set(-0.48, -0.48, -0.83)
    destPlane.rotation.x = -0.25
    cab.add(destPlane)

    // The physical master controller — a modeled lever that tilts with the
    // train's notch, in front of the DOM lever the player actually drags.
    // The master controller sits in a slot it can actually travel along —
    // a raised plate with a dark slit cut down it and notch marks either
    // side, so the lever reads as part of the desk instead of stuck to it.
    const slotPlateMat = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.45 })
    const slotPlate = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.30), slotPlateMat)
    slotPlate.position.set(0.58, -0.375, -0.74)
    slotPlate.rotation.x = -0.25
    cab.add(slotPlate)
    const slitMat = new THREE.MeshBasicMaterial({ color: 0x05060a })
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.004, 0.25), slitMat)
    slit.position.set(0.58, -0.368, -0.74)
    slit.rotation.x = -0.25
    cab.add(slit)
    // Detent ticks along the slot: P5…N…B7, the marks the notch clicks into.
    const tickMat = new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.6, emissive: 0x33373f, emissiveIntensity: 0.5 })
    const tickGeo = new THREE.BoxGeometry(0.035, 0.005, 0.008)
    for (let i = 0; i < 7; i++) {
      const tick = new THREE.Mesh(tickGeo, tickMat)
      const along = -0.105 + i * 0.035
      tick.position.set(0.505, -0.368 + along * 0.25, -0.74 + along)
      tick.rotation.x = -0.25
      cab.add(tick)
    }

    const leverMount = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 10), consoleMat)
    leverMount.position.set(0.58, -0.38, -0.72)
    cab.add(leverMount)

    this.leverPivot = new THREE.Object3D()
    this.leverPivot.position.copy(leverMount.position)
    cab.add(this.leverPivot)

    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x888a8f, metalness: 0.6, roughness: 0.35 })
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.22, 8), shaftMat)
    shaft.position.set(0, 0.11, 0)
    this.leverPivot.add(shaft)

    const knobMat = new THREE.MeshStandardMaterial({ color: 0x2d3340, metalness: 0.25, roughness: 0.5 })
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), knobMat)
    knob.position.set(0, 0.22, 0)
    this.leverPivot.add(knob)
  }

  /** Train headlight — a soft forward spot that only matters after dusk, when it sweeps the ballast ahead of the cab. */
  private buildHeadlight() {
    this.headlight = new THREE.SpotLight(0xfff4d8, 0, 130, 0.42, 0.55, 1.2)
    this.headlight.castShadow = false
    this.scene.add(this.headlight)
    this.scene.add(this.headlight.target)
  }

  private readonly headlightPos = new THREE.Vector3()
  private readonly headlightDir = new THREE.Vector3()

  private updateHeadlight() {
    const night = this.dayNight.nightFactor
    // The tunnel counts as night for every lamp the train owns.
    const dark = Math.max(night, this.tunnelF)
    // Cab light breathes with the dark: ember by day, warm pool at night.
    this.cabLight.intensity = 0.25 + night * 1.3 + this.tunnelF * 0.9
    // Fully off (and skipped by the renderer) in daylight — an intensity-0
    // spot still costs per-fragment work in every standard material.
    this.headlight.visible = dark > 0.01
    if (!this.headlight.visible) return
    const t = this.train.progressFraction
    this.track.pointAt(t, this.headlightPos)
    this.track.tangentAt(t, this.headlightDir).normalize()
    const y = this.headlightPos.y
    this.headlight.position.set(this.headlightPos.x, y + 2.2, this.headlightPos.z)
    this.headlight.target.position.copy(this.headlightPos).addScaledVector(this.headlightDir, 60).setY(y + 0.3)
    this.headlight.target.updateMatrixWorld()
    this.headlight.intensity = Math.max(night, this.tunnelF) * 260
  }

  /** Adds points for a stop grade (with perfect-streak bonus), persists the best, and returns what was gained. */
  private applyScore(grade: string): number {
    let gained = GRADE_POINTS[grade] ?? 0
    if (grade === 'perfect') {
      this.perfectStreak++
      gained += Math.min((this.perfectStreak - 1) * STREAK_BONUS, STREAK_BONUS_CAP)
    } else {
      this.perfectStreak = 0
    }
    this.score += gained
    if (this.score > this.bestScore) {
      this.bestScore = this.score
      localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore))
    }
    this.ui.setScore(this.score, this.bestScore, this.perfectStreak)
    return gained
  }

  private updateLever() {
    this.leverPivot.rotation.x = THREE.MathUtils.mapLinear(this.train.notch, MIN_NOTCH, MAX_NOTCH, 0.5, -0.35)
    if (this.train.targetStationIndex !== this.lastDestinationIdx) {
      this.lastDestinationIdx = this.train.targetStationIndex
      // The outgoing roll may never have been drawn; stop waiting for it.
      this.uploadWatch.forget(this.destinationMat.map)
      this.destinationMat.map?.dispose()
      this.destinationMat.map = makeDestinationTexture(this.train.targetStation.nameEn.toUpperCase())
      // Watch the REPLACEMENT: its upload is a real per-station cost that the
      // resident texture count cannot see.
      this.uploadWatch.watch(this.destinationMat.map)
      this.destinationMat.needsUpdate = true
    }
  }

  /** Cycles cab → exterior → platform. The consist only exists in the outside views. */
  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode
    localStorage.setItem(CAMERA_KEY, mode)
    this.cabRig.visible = mode === 'cab'
    this.consist.setVisible(mode !== 'cab')
    this.ui.setCameraMode(mode)
    // The cab's head rotation is its own; entering an outside view resets it
    // so returning to the cab always faces down the track.
    if (mode !== 'cab') {
      this.lookYaw = 0
      this.lookPitch = 0
    }
    if (mode === 'platform') {
      this.platformStation = this.train.targetStationIndex
      this.platYaw = 0
      this.platPitch = 0
    }
    // A security lens is wide; everything else keeps the game's own framing.
    this.camera.fov = mode === 'platform' ? CCTV_FOV : NORMAL_FOV
    this.camera.updateProjectionMatrix()
    this.ui.setCctv(mode === 'platform')
    this.updateCameraFromTrain()
    if (!this.running) this.renderOnce()
  }

  // Scratch space for the per-frame camera solve — this runs every rendered
  // frame in all three views, so it must not feed the GC (Marco, round 2:
  // the old body allocated ~10 temporaries per frame).
  private readonly camPoint = new THREE.Vector3()
  private readonly camTangent = new THREE.Vector3()
  private readonly camNormal = new THREE.Vector3()
  private readonly camEye = new THREE.Vector3()
  private readonly camAim = new THREE.Vector3()
  private readonly camMat = new THREE.Matrix4()
  private readonly camQuatBase = new THREE.Quaternion()
  private readonly camQuatLook = new THREE.Quaternion()
  private readonly camEuler = new THREE.Euler()

  private updateCameraFromTrain() {
    // The consist is centred on progressFraction, so the driver's eye sits a
    // half-train ahead of it — which also means a perfect stop now leaves the
    // cab at the platform's leading end, the way a real one does.
    const len = this.track.getLength()
    const t = this.train.progressFraction

    if (this.cameraMode === 'cab') {
      const tCab = THREE.MathUtils.euclideanModulo(t + CAB_OFFSET / len, 1)
      const point = this.track.pointAt(tCab, this.camPoint)
      const tangent = this.track.tangentAt(tCab, this.camTangent)
      // Dead on the centreline: offset to one side, the track ran off-centre
      // in the windscreen and the whole view read as crooked.
      const eye = this.camEye.copy(point)
      eye.y += CAB_EYE_Y
      this.camMat.lookAt(eye, this.camAim.copy(eye).add(tangent), WORLD_UP)
      const baseQuat = this.camQuatBase.setFromRotationMatrix(this.camMat)
      const lookQuat = this.camQuatLook.setFromEuler(this.camEuler.set(this.lookPitch, this.lookYaw, 0, 'YXZ'))
      // The rig takes the BASE transform only — that is what keeps the cab
      // still while the head turns.
      this.cabRig.position.copy(eye)
      this.cabRig.quaternion.copy(baseQuat)
      this.camera.position.copy(eye)
      this.camera.quaternion.copy(baseQuat).multiply(lookQuat)
      return
    }

    const side = STATIONS[this.train.targetStationIndex].doorSide === 'left' ? 1 : -1
    if (this.cameraMode === 'exterior') {
      // An orbit around the consist, deliberately fenced in: you can swing all
      // the way around the sides, but the elevation is clamped so the camera
      // never drops to train height (which put you inside the bodywork and
      // lost the train entirely) and never rises to a map view. Distance is
      // fixed, so the train cannot leave the frame.
      const point = this.track.pointAt(t, this.camPoint)
      const tangent = this.track.tangentAt(t, this.camTangent)
      const normal = this.camNormal.set(tangent.z, 0, -tangent.x).normalize()
      const yaw = this.extYaw + (side > 0 ? 0 : Math.PI)
      const dist = EXT_DISTANCE * Math.cos(this.extPitch)
      const height = EXT_DISTANCE * Math.sin(this.extPitch)
      const focus = this.camAim.copy(point)
      focus.y += EXT_FOCUS_Y
      const eye = this.camEye
        .copy(focus)
        .addScaledVector(normal, Math.cos(yaw) * dist)
        .addScaledVector(tangent, Math.sin(yaw) * dist)
      eye.y += height
      this.camMat.lookAt(eye, focus, WORLD_UP)
      this.camera.position.copy(eye)
      this.camera.quaternion.setFromRotationMatrix(this.camMat)
      return
    }


    // Platform view: standing on the slab of the station being approached,
    // roughly where a passenger waits, watching the train come in.
    // The platform camera stays put until the train has really gone. Following
    // targetStationIndex teleported you to the next station the instant the
    // train's nose cleared this one, mid-departure.
    if (this.platformStation !== this.train.targetStationIndex) {
      const held = this.track.markerFor(this.platformStation).tFraction
      const behind = ((((t - held) % 1) + 1) % 1) * len
      if (behind > PLATFORM_HANDOVER_UNITS && behind < len * 0.5) this.platformStation = this.train.targetStationIndex
    }
    const marker = this.track.markerFor(this.platformStation)
    const pPoint = this.track.pointAt(marker.tFraction, this.camPoint)
    const pTangent = this.track.tangentAt(marker.tFraction, this.camTangent)
    const pNormal = this.camNormal.set(pTangent.z, 0, -pTangent.x).normalize()
    const pSide = STATIONS[this.platformStation].doorSide === 'left' ? 1 : -1

    // Mounted high at the back of the platform under the canopy, looking down
    // its length — where a station's own camera hangs, and the angle that
    // frames the doorways, the queues and the train's flank all at once.
    const eye = this.camEye
      .copy(pPoint)
      .addScaledVector(pNormal, pSide * CCTV_LATERAL)
      .addScaledVector(pTangent, -CCTV_BACK)
    eye.y += CCTV_HEIGHT
    // Pan and tilt from that fixed mount. A security camera swivels; it does
    // not walk, and it does not lose the platform: both axes are fenced so it
    // can never end up staring at the sky or away down the line.
    const aim = this.camAim
      .copy(pPoint)
      .addScaledVector(pNormal, pSide * (PLATFORM_INNER + 1.6))
      .addScaledVector(pTangent, CCTV_BACK * 0.55)
    aim.y += 1.6
    // `aim` is fully consumed as the base direction before being reused below.
    const baseDir = aim.sub(eye)
    const baseYaw = Math.atan2(baseDir.x, baseDir.z)
    const basePitch = Math.asin(THREE.MathUtils.clamp(baseDir.y / baseDir.length(), -1, 1))
    const yaw = baseYaw + this.platYaw * pSide
    const pitch = basePitch + this.platPitch
    const target = this.camAim
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .add(eye)
    this.camMat.lookAt(eye, target, WORLD_UP)
    this.camera.position.copy(eye)
    this.camera.quaternion.setFromRotationMatrix(this.camMat)
  }

  /**
   * Watches the canvas-built textures for their first arrival on the GPU: the
   * thirty station boards and the destination roll.
   *
   * Why not `renderer.info.memory.textures`: that counts what is RESIDENT.
   * The destination roll is disposed and rebuilt at every station
   * (`updateLever`), so one leaves as one arrives and the total never moves —
   * the single texture we KNOW churns once per stop is invisible to it.
   *
   * It polls on EVERY frame, recording or not. Gating it on `recording` was a
   * bug with the same shape as the one-frame offset it was added to replace:
   * the counter stayed at zero until the moment the lap began, so the first
   * recorded frame discovered every already-resident board at once and booked
   * the lot as fresh uploads — a fabricated spike, in the first frame, naming
   * the very suspect under investigation. Polling always means the count is
   * already true when `start()` reads it, and the loop stops costing anything
   * once everything has arrived.
   */
  private uploadWatch = new TextureUploadWatch<THREE.Texture>((tex) => {
    // three's own bookkeeping: an uploaded texture has a __webglTexture.
    const props = (this.renderer as unknown as { properties?: { get(o: object): { __webglTexture?: unknown } } }).properties
    return !!props?.get(tex)?.__webglTexture
  })

  // ————————————————————————————————————————————————————————————————
  // The automated hitch probe.
  //
  // The manual protocol for chasing the per-station freezes has four
  // conditions, and every one of them invalidates the run if it slips:
  // alternate TWO stations (jumping to the same one twice never changes
  // `targetStationIndex`, so the destination roll is never rebuilt and that
  // hypothesis goes untested), stay in the CAB (the roll hangs off `cabRig`,
  // which is hidden in the outside views, so it would be rebuilt and never
  // uploaded), let each leg reach the arrival announcement (it fires at 260
  // units and the jump lands at 300, so leaving early tests the visuals and
  // never the audio), and never open Pause in between (`setRunning(false)`
  // renders a frame that no one records, warming resources outside the log).
  //
  // Four conditions to hold in your head while driving a phone is how a lap
  // gets thrown away. So the game drives instead.
  // ————————————————————————————————————————————————————————————————

  /** Kiyomizu and Fushimi Inari, alternating: two stations far enough apart to share nothing. */
  private static readonly PROBE_STATIONS = [9, 18]
  /** Four visits each — the first two arrive cold, the rest with everything already warm. */
  private static readonly PROBE_LEGS = 8
  /** After the announcement fires, keep going: the speech itself starts a couple of seconds later. */
  private static readonly PROBE_LINGER_SECONDS = 5
  /** A leg that never announces (something went wrong) must not hang the run. */
  private static readonly PROBE_LEG_TIMEOUT = 40

  /** Frames to draw in the cab BEFORE recording starts — see `arming` in startProbe. */
  private static readonly PROBE_ARM_FRAMES = 3

  private probe: { leg: number; linger: number; legTime: number; arming: number; cameraBefore: CameraMode } | null = null

  /**
   * Runs the whole diagnostic by itself: forces the cab view, starts the
   * recording, alternates the two stations waiting for each arrival, then
   * stops and opens the menu with the log ready to copy.
   */
  private startProbe() {
    if (!this.started || this.probe) return
    if (this.perf.recording) this.togglePerfRecording()
    const cameraBefore = this.cameraMode
    this.setCameraMode('cab')
    // Armed for a few frames before recording begins: coming from an outside
    // view, the cab's own textures and shaders reach the GPU on its first
    // draw, and starting the log before that would open the lap with a spike
    // that belongs to the camera switch and not to any station.
    this.probe = { leg: -1, linger: 0, legTime: 0, arming: Game.PROBE_ARM_FRAMES, cameraBefore }
  }

  private nextProbeLeg() {
    const p = this.probe!
    p.leg++
    if (p.leg >= Game.PROBE_LEGS) {
      this.finishProbe()
      return
    }
    p.linger = Game.PROBE_LINGER_SECONDS
    p.legTime = 0
    this.teleportToStation(Game.PROBE_STATIONS[p.leg % Game.PROBE_STATIONS.length])
    // Full power: the leg is 300 units and we want it driven, not crawled.
    this.train.setNotch(MAX_NOTCH)
    this.controls.syncNotch(MAX_NOTCH)
    this.ui.showProbeToast(`Prueba de tirones${this.muted ? ' (SILENCIADA)' : ''} — tramo ${p.leg + 1} de ${Game.PROBE_LEGS}`)
  }

  private updateProbe(dt: number) {
    const p = this.probe!
    if (p.arming > 0) {
      p.arming--
      if (p.arming === 0) {
        // No mid-run persistence: a two-minute automated run must not also be
        // writing the log to disk every five seconds, because WebKit flushes
        // that store on its own schedule and the flush would land exactly
        // where the unexplained stall lands — outside every timer we own.
        // The run stops by itself, and stopping persists.
        this.togglePerfRecording(false)
        this.nextProbeLeg()
      }
      return
    }
    p.legTime += dt
    if (this.train.announcedArriving) {
      p.linger -= dt
      if (p.linger > 0) return
    } else if (p.legTime < Game.PROBE_LEG_TIMEOUT) {
      return
    }
    this.nextProbeLeg()
  }

  private finishProbe() {
    this.endProbe()
    // Straight to the menu, where the log is waiting behind «Copiar log».
    this.ui.openPauseMenu()
  }

  /** Pausing mid-run makes the log unusable, so say so instead of leaving a half-run behind. */
  private abortProbe() {
    this.endProbe()
    this.ui.showHint(
      'Prueba cancelada',
      'Se ha pausado a mitad, y eso deja recursos cargados fuera del registro: el log ya no diría la verdad. Vuelve a lanzarla y déjala terminar sola (unos 2 minutos).',
    )
  }

  private endProbe() {
    const p = this.probe!
    this.probe = null
    this.train.setNotch(0)
    this.controls.syncNotch(0)
    if (this.perf.recording) this.togglePerfRecording()
    this.setCameraMode(p.cameraBefore)
  }

  private onResize() {
    // The VISUAL viewport when the platform reports one: on iOS the layout
    // viewport can disagree with what is actually visible (collapsing
    // toolbars), and sizing to the wrong one leaves letterbox bands.
    const vv = window.visualViewport
    const w = Math.round(vv?.width ?? window.innerWidth)
    const h = Math.round(vv?.height ?? window.innerHeight)
    // Backgrounded rotations can report 0×0 for a beat — sizing the drawing
    // buffer to zero blanks the canvas until the next real resize.
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.windshield?.resize()
    // The animation loop won't pick up the new size on its own if it isn't
    // running (start screen / paused) — repaint once so a rotate mid-pause
    // doesn't leave a stale frame at the old dimensions.
    if (!this.running) this.renderOnce()
  }

  private tick() {
    // Taken FIRST, before anything else in the callback: the gap is the time
    // the page spent outside our code, and measuring it after any work of ours
    // would fold that work into it.
    const tickStart = performance.now()
    const gapMs = this.lastTickEnd > 0 ? tickStart - this.lastTickEnd : 0
    // The raw interval is what the player felt; the clamped one is what the
    // simulation is allowed to swallow. The recorder wants the former.
    const rawDt = this.clock.getDelta()
    const frameDt = Math.min(rawDt, MAX_FRAME_DT)
    // Train physics (position/speed integration, stop detection, scoring)
    // runs in FIXED steps via an accumulator — decoupled from the render
    // frame rate, so the exact same lever input produces the exact same
    // stop position and score on a stuttering phone as on a smooth one.
    // Below ~20fps, a variable dt clamped at the frame level would silently
    // run the simulation in slow motion instead; this catches up instead.
    this.physicsAccumulator = Math.min(this.physicsAccumulator + frameDt, FIXED_DT * MAX_CATCHUP_STEPS)
    // Timed as phases so the frame adds up: physics + step + render should
    // account for frameMs. Whatever is left over is NOT our code — and after
    // the probe found 320 ms stalls with a 5 ms render, knowing that is the
    // whole question.
    perfPhase('f:physics', () => {
      while (this.physicsAccumulator >= FIXED_DT) {
        this.train.update(FIXED_DT)
        this.physicsAccumulator -= FIXED_DT
      }
    })
    perfPhase('f:step', () => this.step(frameDt))
    // Timed around the call itself. `rawDt` above is the interval BEFORE this
    // frame, so pairing it with resources read after this render mis-attributes
    // a stall by exactly one frame — the render that compiled would look fast
    // and the frame that reported it would look resourceless.
    const renderT0 = performance.now()
    this.renderer.render(this.scene, this.camera)
    const renderMs = performance.now() - renderT0
    // Sampled AFTER the draw: renderer.info resets per render, so these are
    // the counts for the frame that was just put on screen.
    const info = this.renderer.info.render
    this.perf.record({
      frameMs: rawDt * 1000,
      renderMs,
      // Both describe the interval BEFORE this tick, which is the one frameMs
      // measures — so the three can be compared without mixing frames.
      prevTickMs: this.lastTickCpuMs,
      gapMs,
      draws: info.calls,
      tris: info.triangles,
      speedKmh: this.train.speedKmh,
      progress: this.train.progressFraction,
      stationIdx: this.train.targetStationIndex,
      // Cumulative, not per-frame: three links a program the first time a
      // material is drawn, so growth here IS first-draw work happening.
      programs: this.renderer.info.programs?.length ?? 0,
      textures: this.renderer.info.memory.textures,
      texUploads: this.uploadWatch.poll(),
      shadowPass: this.dayNight.sunLight.castShadow,
    })
    this.ui.updatePerfChip(this.perf.fpsNow, this.perf.recording)
    // Last line of the callback, so `lastTickCpuMs` covers EVERYTHING we do —
    // including record(), the upload poll and the fps chip, none of which any
    // phase wraps.
    this.lastTickEnd = performance.now()
    this.lastTickCpuMs = this.lastTickEnd - tickStart
  }

  /** When this Game was constructed — the log reports uptime so cold and warm runs are told apart by measurement, not by inference. */
  private readonly bornAt = performance.now()

  /** End of the previous animation callback, and how long that whole callback took. */
  private lastTickEnd = 0
  private lastTickCpuMs = 0

  /**
   * Presentation layer: runs once per rendered frame with the real frame
   * delta (not the fixed physics step) — camera, ambient visuals, audio and
   * UI only ever READ the train's state here, so nothing here needs to be
   * re-run per physics step.
   */
  private step(dt: number) {
    if (this.probe) this.updateProbe(dt)
    // H3: the front director only runs while the sky is on AUTO and the
    // world is actually moving (a paused menu shouldn't ambush anyone).
    if (this.started && this.weatherAuto) {
      this.frontTimer -= dt
      if (this.frontTimer <= 0) this.advanceFront()
    }

    // H4: how deep inside the tunnel the cab is right now. Everything that
    // follows (lighting, fog, precipitation, audio, headlight) reads this.
    const trackLen = this.track.getLength()
    this.tunnelF = this.track.tunnelAmountAt(this.train.progressFraction + CAB_OFFSET / trackLen)
    const inTunnel = this.tunnelF > 0.5
    if (inTunnel !== this.wasInTunnel) {
      this.wasInTunnel = inTunnel
      if (inTunnel) perfMark('tunnel')
      // The portal is an EVENT: pressure whoosh + thump, in both directions.
      audio.tunnelWhoosh(inTunnel, this.train.speed01)
    }
    // Deep inside, fog ends at ~260 — everything beyond is invisible, so
    // stop paying for it: pull the far plane in and the frustum culls the
    // city, skyline and clouds wholesale (free thermal headroom exactly
    // where a phone wants it). The restore is the delicate half: snapping
    // 900→9000 at the cab's own crossing happened with the fog already half
    // open, and the whole ring popped into view in one frame at the exit.
    // Now the far plane only stays pulled in while the track WELL AHEAD is
    // also deep inside — leaving, it restores with the cab still enclosed
    // (fog closed at 260) and the world is simply there, behind fog, when
    // the portal arrives. Entering, the ahead point is always deeper, so
    // culling still starts at the cab's own crossing, buried in the lining.
    const aheadF = this.track.tunnelAmountAt(this.train.progressFraction + (CAB_OFFSET + FAR_RESTORE_LOOKAHEAD) / trackLen)
    const wantFar = this.tunnelF > 0.6 && aheadF > 0.6 ? 900 : 9000
    if (this.camera.far !== wantFar) {
      this.camera.far = wantFar
      this.camera.updateProjectionMatrix()
    }

    perfPhase('f:daynight', () => this.dayNight.update(dt * this.timeScale, this.camera.position))

    // The tunnel overrides the sky's word on light and fog: the lining is
    // close, dark and warm-lit, whatever the weather is doing overhead.
    if (this.tunnelF > 0.001) {
      const f = this.tunnelF
      this.dayNight.sunLight.intensity *= 1 - 0.97 * f
      this.dayNight.moonLight.intensity *= 1 - 0.97 * f
      this.dayNight.ambient.intensity = this.dayNight.ambient.intensity * (1 - 0.78 * f) + 0.15 * f
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.color.lerp(TUNNEL_FOG, f)
        this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, 22, f)
        this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, 260, f)
      }
    }
    if (Math.abs(this.tunnelF - this.lastTunnelAudioF) > 0.04 || (this.tunnelF === 0) !== (this.lastTunnelAudioF === 0)) {
      this.lastTunnelAudioF = this.tunnelF
      audio.setTunnel(this.tunnelF)
    }
    // Every window-lit material shares this: windows pop on one by one
    // through dusk as it rises from 0 to 1.
    WINDOW_DUSK_UNIFORM.value = this.dayNight.nightFactor
    if (this.train.targetStationIndex !== this.lastMarkedStation) {
      this.lastMarkedStation = this.train.targetStationIndex
      perfMark('station')
    }
    perfPhase('f:city', () => this.city.update(dt, this.dayNight.nightFactor, this.train.targetStationIndex))
    // Real seconds, not clock-scaled: the train runs in real time, so if
    // arrivals followed the accelerated day the platform would win by default.
    perfPhase('f:flow', () => this.flow.update(dt, this.dayNight.timeOfDay))
    const dwelling = this.train.state === 'stopped' || this.train.state === 'doors_open' || this.train.state === 'doors_closing'
    perfPhase('f:schedule', () => this.schedule.update(dt, dwelling))
    this.waitingRefresh += dt
    if (this.waitingRefresh > 1.4) {
      this.waitingRefresh = 0
      this.passengers.setWaitingCounts(this.flow.waiting)
    }
    const prevMarkerT = this.track.markerFor(this.train.currentStationIndex).tFraction
    perfPhase('f:passengers', () => this.passengers.update(dt, this.dayNight.nightFactor, {
      targetStation: this.train.targetStationIndex,
      distanceToTarget: this.train.distanceToTarget,
      distanceBehind: ((((this.train.progressFraction - prevMarkerT) % 1) + 1) % 1) * this.track.getLength(),
      stopped: this.train.state === 'stopped' || this.train.state === 'doors_open',
      doorsOpen: this.train.doorsOpenAmount,
      speed01: this.train.speed01,
    }))
    perfPhase('f:scenery', () => this.scenery.update(dt, this.dayNight, this.train.progressFraction))
    // Kan-kan: one bell strike per blink flip while the crossing is active.
    if (this.scenery.crossingBlinkPhase !== this.lastCrossingPhase) {
      this.lastCrossingPhase = this.scenery.crossingBlinkPhase
      if (this.scenery.crossingBellActive) audio.crossingTick(0.7)
    }
    perfPhase('f:transfer', () => this.updateTransfer(dt))
    // The doors only ever open at the station being served, and while stopped
    // that is the TARGET: currentStationIndex still names the previous one
    // until the doors finish closing, which opened the wrong side wherever
    // two consecutive platforms disagreed.
    perfPhase('f:consist', () =>
      this.consist.update(
        this.train.progressFraction,
        this.train.doorsOpenAmount,
        STATIONS[this.train.targetStationIndex].doorSide,
        this.dayNight.nightFactor,
      ),
    )
    this.applyPrecipitation()
    // The railhead dries on its own clock, not the weather's.
    if (this.wetLingerSeconds > 0 && this.weather !== 'rain' && this.weather !== 'storm') {
      this.wetLingerSeconds -= dt
      if (this.wetLingerSeconds <= 0) {
        this.wetLingerSeconds = 0
        this.applyRailCondition()
      }
    }
    perfPhase('f:precip', () => this.precipitation.update(dt, this.camera.position, this.dayNight.nightFactor))
    perfPhase('f:windshield', () => this.windshield.update(dt, this.wsIntensity, this.wsSnow, this.train.speed01, this.cameraMode === 'cab'))
    this.updateHeadlight()

    // H5: the sea is audible along the bay arc — loudest standing at a
    // coastal platform, a whisper at line speed under the motor.
    let bay = 0
    const tt = THREE.MathUtils.euclideanModulo(this.train.progressFraction, 1)
    if (tt > BAY_T0 - 0.012 && tt < BAY_T1 + 0.012) {
      const edge = Math.min(tt - (BAY_T0 - 0.012), BAY_T1 + 0.012 - tt)
      bay = THREE.MathUtils.clamp(edge / 0.02, 0, 1)
    }
    const shore = bay * (0.25 + 0.75 * (1 - this.train.speed01)) * (1 - this.tunnelF)
    if (Math.abs(shore - this.lastShoreAudioLevel) > 0.05 || (shore === 0) !== (this.lastShoreAudioLevel === 0)) {
      this.lastShoreAudioLevel = shore
      audio.setShore(shore)
    }

    // Atmosphere discovery: one gentle nudge, ~20 s into the first session
    // that hasn't found the panel yet. The pulsing clock does the rest.
    if (!this.atmoSeen && !this.atmoTipShown && this.started) {
      this.atmoTipTimer += dt
      if (this.atmoTipTimer > 22) {
        this.atmoTipShown = true
        this.ui.showHint('El cielo es tuyo', 'Toca el reloj de arriba para abrir «Atmósfera»: hora del día, estación del año y clima — el mundo cambia al instante.')
      }
    }
    // Positional platform murmur: nearest station (ahead or just passed)
    // wins; louder for landmark hubs, panned toward the platform side.
    const distAhead = this.train.distanceToTarget
    const prevMarker = this.track.markerFor(this.train.currentStationIndex)
    const distBehind = (((this.train.progressFraction - prevMarker.tFraction) % 1) + 1) % 1 * this.track.getLength()
    // Unrolled (no per-frame array allocation, per Marco's rule).
    let murmurLevel = 0
    let murmurPan = 0
    const ahead = this.train.targetStation
    const behind = this.train.currentStation
    const levelAhead = Math.max(0, 1 - Math.min(distAhead / 180, 1)) * (ahead.landmark ? 1 : 0.55)
    const levelBehind = Math.max(0, 1 - Math.min(distBehind / 180, 1)) * (behind.landmark ? 1 : 0.55)
    if (levelAhead >= levelBehind && levelAhead > 0) {
      murmurLevel = levelAhead
      murmurPan = ahead.doorSide === 'left' ? -0.55 : 0.55
    } else if (levelBehind > 0) {
      murmurLevel = levelBehind
      murmurPan = behind.doorSide === 'left' ? -0.55 : 0.55
    }
    perfPhase('f:audio', () => audio.updateAmbient(this.train.speed01, this.train.brakeAmount01, this.dayNight.timeOfDay, this.train.doorsOpenAmount, murmurLevel, murmurPan))
    this.controls.syncNotch(this.train.notch)
    perfPhase('f:camera', () => this.updateCameraFromTrain())
    perfPhase('f:lever', () => this.updateLever())
    this.ui.updateClock(this.dayNight.timeOfDay, this.dayNight.phaseLabel)
    if (this.cameraMode === 'platform') this.ui.setCctvLabel(STATIONS[this.platformStation].nameEn)
    this.ui.updateAtmoPhase(this.season, this.weather, this.dayNight.timeOfDay)
    // Progress along the current segment for the HUD's reference bar.
    const currentT = this.track.markerFor(this.train.currentStationIndex).tFraction
    const targetT = this.track.markerFor(this.train.targetStationIndex).tFraction
    const segLen = ((((targetT - currentT) % 1) + 1) % 1) * this.track.getLength() || 1
    const segmentProgress = THREE.MathUtils.clamp(1 - this.train.distanceToTarget / segLen, 0, 1)
    // Door-button phase for the HUD: what a tap would do right now.
    const doorPhase =
      this.train.state === 'stopped' ? 'can-open'
      : this.train.state === 'doors_open' ? (this.train.boardingComplete ? 'can-close' : 'boarding')
      : this.train.state === 'doors_closing' ? 'closing'
      : 'idle'
    this.ui.setDelay(this.schedule.delay(segmentProgress))
    perfPhase('f:hud', () => this.ui.updateTrain({
      speedKmh: this.train.speedKmh,
      notchLabel: notchLabel(this.train.notch),
      currentStationIdx: this.train.currentStationIndex,
      targetStationIdx: this.train.targetStationIndex,
      doorsOpenAmount: this.train.doorsOpenAmount,
      doorPhase,
      boardingProgress: this.train.boardingSeconds > 0 ? 1 - this.train.boardingRemaining / this.train.boardingSeconds : 1,
      segmentProgress,
    }))
  }
}
