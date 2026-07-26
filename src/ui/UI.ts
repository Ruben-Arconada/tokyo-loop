import { STATIONS } from '../data/stations'
import type { StopResult } from '../game/Train'
import { TEAM } from '../data/team'
import { SEASONS, WEATHERS, weatherFace, rainPhaseLabel, type Season, type Weather } from '../game/Seasons'
import { CAMERA_MODES, type CameraMode } from '../game/cameraModes'
import { Schedule, SCHEDULE_LEVELS, ON_TIME_TOLERANCE, LATE_TOLERANCE, type ScheduleLevel } from '../game/Schedule'

export interface UICallbacks {
  onStart: () => void
  onPauseToggle: (paused: boolean) => void
  onTimeScaleChange: (scale: number) => void
  /** The player tapped a preset in the clock's time picker. */
  onTimeSet: (hour: number) => void
  /** The player tapped the door button (open or close — the game decides). */
  onDoorAction: () => void
  /** Season / weather chosen from the HUD pickers. */
  onSeasonSet: (season: Season) => void
  onWeatherSet: (weather: Weather) => void
  /** The AUTO chip in the weather section: fronts roll through on their own. */
  onWeatherAutoSet: (auto: boolean) => void
  /** HUD mute switch. */
  onMuteToggle: (muted: boolean) => void
  /** First time the player opens the Atmosphere panel — stops the discovery pulse for good. */
  onAtmoOpened: () => void
  /** How tight the timetable is. */
  onScheduleLevelSet: (level: ScheduleLevel) => void
  /** Which eye the player looks through: cab, outside, or standing on the platform. */
  onCameraSet: (mode: CameraMode) => void
  /** Second PA language (Japanese is always there). */
  onPaLangSet: (lang: 'en' | 'es') => void
  /** Tester teleport: picked a station from the line-diagram sheet. */
  onTeleport: (stationIndex: number) => void
  /** Frame-time recording: start/stop, hand over the log, throw it away. */
  onPerfToggle: () => void
  onPerfExport: () => string
  onPerfClear: () => void
}

/** What the door button offers right now — mirrors the train's door state. */
export type DoorPhase = 'idle' | 'can-open' | 'boarding' | 'can-close' | 'closing'

const DOOR_LABELS: Record<DoorPhase, string> = {
  idle: 'PUERTAS',
  'can-open': '▶ ABRIR',
  boarding: 'EMBARQUE',
  'can-close': '◀ CERRAR',
  closing: 'CERRANDO…',
}

/** Presets offered when tapping the HUD clock. */
const TIME_PRESETS: { label: string; hour: number }[] = [
  { label: '🌅 Amanecer', hour: 6.2 },
  { label: '☀️ Mediodía', hour: 12.5 },
  { label: '🌇 Atardecer', hour: 17.6 },
  { label: '🌆 Anochecer', hour: 19 },
  { label: '🌙 Noche', hour: 22 },
]

export class UI {
  private hud: HTMLDivElement
  private startOverlay: HTMLDivElement
  private menuOverlay: HTMLDivElement
  private atmoOverlay: HTMLDivElement
  private teleportOverlay: HTMLDivElement
  private toastEl: HTMLDivElement
  private menuOpen = false
  private atmoOpen = false
  private paused = false
  private atmoChip!: HTMLButtonElement
  private atmoGlyphEl!: HTMLSpanElement
  private perfChip!: HTMLDivElement
  private camChip!: HTMLButtonElement
  private muteChip!: HTMLButtonElement
  private railChip!: HTMLDivElement
  private lastRailText = ''
  private cctvEl!: HTMLDivElement
  private lastCctvStation = ''
  private occFill!: HTMLDivElement
  private occLabel!: HTMLElement
  private lastOccText = ''
  private cameraMode: CameraMode = 'cab'
  private perfMenuBtn!: HTMLButtonElement
  private perfHeadlineEl!: HTMLParagraphElement
  private perfActionsEl!: HTMLDivElement
  private delayChip!: HTMLDivElement
  private delayValueEl!: HTMLSpanElement
  private lastDelayText = ''
  private lastFpsText = ''
  /** Cached so the per-frame phase refresh stays a string compare, not a DOM write. */
  private lastPhaseText = ''
  private lastAtmoWinter: boolean | null = null

  private clockEl!: HTMLSpanElement
  private phaseEl!: HTMLSpanElement
  private speedEl!: HTMLSpanElement
  private notchEl!: HTMLSpanElement
  private stationNowEl!: HTMLSpanElement
  private stationNextEl!: HTMLSpanElement
  private stationNowCodeEl!: HTMLSpanElement
  private stationNextCodeEl!: HTMLSpanElement
  private segmentFillEl!: HTMLDivElement
  private segmentTrainEl!: HTMLDivElement
  private lineDiagram!: HTMLDivElement
  private stationDots: HTMLDivElement[] = []
  private doorBtn!: HTMLButtonElement
  private doorBtnLabel!: HTMLSpanElement
  private doorBtnProgress!: HTMLSpanElement
  /** Null until the first update applies a phase, so the initial paint isn't skipped. */
  private lastDoorPhase: DoorPhase | null = null
  private scoreValueEl!: HTMLSpanElement
  private scoreBestEl!: HTMLElement
  private lastNotchLabel = 'N'
  private mount: HTMLElement
  private cb: UICallbacks

  constructor(mount: HTMLElement, cb: UICallbacks) {
    this.mount = mount
    this.cb = cb
    this.hud = document.createElement('div')
    this.hud.className = 'hud'
    this.buildHud()
    mount.appendChild(this.hud)

    this.toastEl = document.createElement('div')
    this.toastEl.className = 'toast'
    mount.appendChild(this.toastEl)

    this.startOverlay = this.buildStartOverlay()
    mount.appendChild(this.startOverlay)

    this.menuOverlay = this.buildMenuOverlay()
    mount.appendChild(this.menuOverlay)

    this.atmoOverlay = this.buildAtmoOverlay()
    mount.appendChild(this.atmoOverlay)

    this.teleportOverlay = this.buildTeleportOverlay()
    mount.appendChild(this.teleportOverlay)
  }

  private buildHud() {
    this.hud.innerHTML = `
      <div class="hud-top">
        <button class="hud-menu-btn" aria-label="Menú">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <button class="hud-clock" aria-label="Atmósfera: hora, estación y clima" aria-haspopup="dialog" aria-expanded="false">
          <span class="hud-clock-row">
            <span class="hud-clock-time">07:30</span>
            <span class="hud-clock-atmo" aria-hidden="true">🌸☀️</span>
          </span>
          <span class="hud-clock-phase">Mañana</span>
        </button>
        <div class="hud-stations">
          <div class="hud-stations-row">
            <div class="hud-station-now">
              <small>PARADA ACTUAL</small>
              <span class="hud-station-row"><span class="tl-badge hud-station-now-code">JL01</span><span class="hud-station-now-name">Tokyo</span></span>
            </div>
            <div class="hud-station-next">
              <small>PRÓXIMA</small>
              <span class="hud-station-row"><span class="tl-badge hud-station-next-code">JL02</span><span class="hud-station-next-name">Yokohama</span></span>
            </div>
          </div>
          <div class="segment-progress">
            <div class="segment-progress-fill"></div>
            <div class="segment-progress-train">🚃</div>
          </div>
        </div>
      </div>
      <div class="line-diagram"></div>
      <div class="delay-chip on-time"><small>HORARIO</small><span class="delay-value">0s</span></div>
      <div class="hud-bottom">
        <button class="door-btn" aria-label="Puertas">
          <span class="door-btn-progress"></span>
          <span class="door-btn-label">PUERTAS</span>
        </button>
        <div class="speed-gauge">
          <span class="speed-value">0</span>
          <span class="speed-unit">km/h</span>
        </div>
        <div class="notch-readout">N</div>
      </div>
      <div class="cctv hidden" aria-hidden="true">
        <span class="cctv-corner tl"></span><span class="cctv-corner tr"></span>
        <div class="cctv-banner">
          <span class="cctv-rec"><i></i>REC</span>
          <span>CAM 01 · <b class="cctv-station">—</b></span>
          <span class="cctv-time">--:--</span>
        </div>
      </div>
      <button class="cam-chip" aria-label="Cambiar vista">
        <span class="cam-icon">🚉</span><span class="cam-label">Cabina</span>
      </button>
      <button class="mute-chip" aria-label="Silenciar sonido" aria-pressed="false">🔊</button>
      <div class="rail-chip hidden" role="status" aria-live="polite"><span class="rail-icon">☔</span><span class="rail-text">Carril mojado</span></div>
      <div class="perf-chip hidden"><span class="perf-dot"></span><span class="perf-fps">--</span><small>fps</small></div>
      <div class="occupancy-chip">
        <div class="occupancy-bar"><div class="occupancy-fill"></div></div>
        <small class="occupancy-label">A BORDO 0</small>
      </div>
      <div class="score-chip">
        <span class="score-value">0</span>
        <small class="score-best">MEJOR 0</small>
      </div>
    `
    this.clockEl = this.hud.querySelector('.hud-clock-time')!
    this.phaseEl = this.hud.querySelector('.hud-clock-phase')!
    this.speedEl = this.hud.querySelector('.speed-value')!
    this.notchEl = this.hud.querySelector('.notch-readout')!
    this.stationNowEl = this.hud.querySelector('.hud-station-now-name')!
    this.stationNextEl = this.hud.querySelector('.hud-station-next-name')!
    this.stationNowCodeEl = this.hud.querySelector('.hud-station-now-code')!
    this.stationNextCodeEl = this.hud.querySelector('.hud-station-next-code')!
    this.segmentFillEl = this.hud.querySelector('.segment-progress-fill')!
    this.delayChip = this.hud.querySelector('.delay-chip')!
    this.delayValueEl = this.hud.querySelector('.delay-value')!
    this.segmentTrainEl = this.hud.querySelector('.segment-progress-train')!
    this.doorBtn = this.hud.querySelector('.door-btn')!
    this.doorBtnLabel = this.hud.querySelector('.door-btn-label')!
    this.doorBtnProgress = this.hud.querySelector('.door-btn-progress')!
    this.doorBtn.addEventListener('click', () => this.cb.onDoorAction())
    this.scoreValueEl = this.hud.querySelector('.score-value')!
    this.scoreBestEl = this.hud.querySelector('.score-best')!
    this.lineDiagram = this.hud.querySelector('.line-diagram')!
    this.perfChip = this.hud.querySelector('.perf-chip')!
    this.camChip = this.hud.querySelector('.cam-chip')!
    this.muteChip = this.hud.querySelector('.mute-chip')!
    this.railChip = this.hud.querySelector('.rail-chip')!
    this.muteChip.addEventListener('click', () => {
      const muted = this.muteChip.getAttribute('aria-pressed') !== 'true'
      this.setMuted(muted)
      this.cb.onMuteToggle(muted)
    })
    this.cctvEl = this.hud.querySelector('.cctv')!
    this.occFill = this.hud.querySelector('.occupancy-fill')!
    this.occLabel = this.hud.querySelector('.occupancy-label')!
    // One tap cycles: the three views are few enough that a picker would be
    // more taps than just stepping through them.
    this.camChip.addEventListener('click', () => {
      const i = CAMERA_MODES.findIndex((m) => m.id === this.cameraMode)
      this.cb.onCameraSet(CAMERA_MODES[(i + 1) % CAMERA_MODES.length].id)
    })

    for (let i = 0; i < STATIONS.length; i++) {
      const dot = document.createElement('div')
      dot.className = 'line-dot'
      dot.title = STATIONS[i].nameEn
      this.lineDiagram.appendChild(dot)
      this.stationDots.push(dot)
    }

    this.hud.querySelector('.hud-menu-btn')!.addEventListener('click', () => this.toggleMenu())
    // The line diagram doubles as the teleport door: tap it, pick a station.
    this.lineDiagram.addEventListener('click', () => this.toggleTeleport(true))
    this.atmoChip = this.hud.querySelector('.hud-clock')!
    this.atmoGlyphEl = this.hud.querySelector('.hud-clock-atmo')!
    this.atmoChip.addEventListener('click', () => this.toggleAtmo())
  }

  /**
   * The atmosphere panel: hour, season and weather in ONE centered sheet
   * instead of three look-alike dropdowns fighting over the top bar. That bar
   * is 40px of screen on a phone — every chip it doesn't carry is a chip that
   * isn't pushing the station pills onto a second row.
   *
   * Deliberately does NOT pause: the whole point of this panel is watching
   * the sky answer, so the world keeps running behind a lighter-than-usual
   * backdrop while it's open.
   */
  private buildAtmoOverlay(): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'overlay atmo-overlay hidden'
    el.innerHTML = `
      <div class="overlay-card atmo-card" role="dialog" aria-label="Atmósfera">
        <h2>Atmósfera</h2>
        <p class="atmo-hint">Se aplica al instante — el mundo sigue rodando detrás.</p>
        <div class="atmo-sections">
          <section class="atmo-section">
            <h3>Hora del día</h3>
            <div class="atmo-grid atmo-grid-time">
              ${TIME_PRESETS.map((p) => `<button data-hour="${p.hour}">${p.label}</button>`).join('')}
            </div>
          </section>
          <section class="atmo-section">
            <h3>Estación del año</h3>
            <div class="atmo-grid">
              ${SEASONS.map((s) => `<button data-season="${s.id}"><span class="atmo-icon">${s.icon}</span>${s.label}</button>`).join('')}
            </div>
          </section>
          <section class="atmo-section">
            <h3>Clima</h3>
            <div class="atmo-grid atmo-grid-weather">
              <button class="atmo-auto" data-weather-auto><span class="atmo-icon">🔄</span><span class="atmo-weather-label">Auto</span></button>
              ${WEATHERS.map((w) => `<button data-weather="${w.id}"><span class="atmo-icon">${w.icon}</span><span class="atmo-weather-label">${w.label}</span></button>`).join('')}
            </div>
            <p class="atmo-auto-hint hidden">El cielo va por libre: los frentes llegan y pasan solos.</p>
            <p class="atmo-phase"></p>
          </section>
        </div>
        <button class="btn-close">Listo</button>
      </div>
    `
    el.querySelector('.btn-close')!.addEventListener('click', () => this.toggleAtmo(false))
    // Tapping the dimmed area outside the card dismisses it.
    el.addEventListener('click', (e) => {
      if (e.target === el) this.toggleAtmo(false)
    })
    el.querySelectorAll<HTMLButtonElement>('[data-hour]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onTimeSet(parseFloat(btn.dataset.hour!)))
    })
    el.querySelectorAll<HTMLButtonElement>('[data-season]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onSeasonSet(btn.dataset.season as Season))
    })
    el.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onWeatherSet(btn.dataset.weather as Weather))
    })
    el.querySelector('[data-weather-auto]')!.addEventListener('click', () => this.cb.onWeatherAutoSet(true))
    return el
  }

  /**
   * The tester teleport sheet: every station as a tappable row, tap → land
   * 300 units short of its platform, driving. Two deliberate taps (diagram,
   * then station) so a stray finger can never yank the train across Tokyo.
   */
  private buildTeleportOverlay(): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'overlay teleport-overlay hidden'
    el.innerHTML = `
      <div class="overlay-card teleport-card" role="dialog" aria-label="Teletransporte">
        <h2>Ir a una estación</h2>
        <p class="atmo-hint">Apareces a 300 m del andén, en marcha. El horario se resincroniza — es un salto, no un retraso.</p>
        <div class="teleport-grid">
          ${STATIONS.map((st, i) => `<button data-tp="${i}"><span class="tl-badge">JL${String(i + 1).padStart(2, '0')}</span><span class="tp-name">${st.nameEn}</span></button>`).join('')}
        </div>
        <button class="btn-close">Cancelar</button>
      </div>
    `
    el.querySelector('.btn-close')!.addEventListener('click', () => this.toggleTeleport(false))
    el.addEventListener('click', (e) => {
      if (e.target === el) this.toggleTeleport(false)
    })
    el.querySelectorAll<HTMLButtonElement>('[data-tp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.toggleTeleport(false)
        this.cb.onTeleport(parseInt(btn.dataset.tp!, 10))
      })
    })
    return el
  }

  private toggleTeleport(open: boolean) {
    this.teleportOverlay.classList.toggle('hidden', !open)
  }

  /** Feedback after the jump lands. */
  showTeleportToast(stationIndex: number) {
    this.flashToast(`Teletransportado — ${STATIONS[stationIndex].nameEn} a 300 m`, 'good')
  }

  private toggleAtmo(force?: boolean) {
    this.atmoOpen = force ?? !this.atmoOpen
    this.atmoOverlay.classList.toggle('hidden', !this.atmoOpen)
    this.atmoChip.setAttribute('aria-expanded', String(this.atmoOpen))
    if (this.atmoOpen && this.atmoChip.classList.contains('pulse')) {
      this.atmoChip.classList.remove('pulse')
      this.cb.onAtmoOpened()
    }
  }

  /** Gentle glow on the clock chip until the player discovers the Atmosphere panel. */
  setAtmoPulse(on: boolean) {
    this.atmoChip.classList.toggle('pulse', on)
  }

  /** Reflects (and persists via the callback) the mute switch. */
  setMuted(muted: boolean) {
    this.muteChip.textContent = muted ? '🔇' : '🔊'
    this.muteChip.setAttribute('aria-pressed', String(muted))
    this.muteChip.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar sonido')
    this.muteChip.classList.toggle('muted', muted)
  }

  /** Marks the AUTO weather chip; individual weathers stay tappable (tapping one leaves auto). */
  setWeatherAuto(auto: boolean) {
    this.atmoOverlay.querySelector('[data-weather-auto]')!.classList.toggle('active', auto)
    this.atmoOverlay.querySelector('.atmo-auto-hint')!.classList.toggle('hidden', !auto)
  }

  /**
   * The adhesion warning (H1). Not a toast — it stays up as long as the rail
   * is wet, because "the rail is still wet" is exactly the thing a driver
   * forgets three stations after the rain started.
   */
  setRailCondition(cond: 'dry' | 'wet' | 'snow', advisoryKmh: number) {
    // The advisory speed leads the sentence: it is the one actionable datum,
    // and a narrow portrait truncates from the END (Lena, round 1).
    const text = cond === 'dry' ? '' : cond === 'wet'
      ? `≤${advisoryKmh} km/h · carril mojado, frena antes`
      : `≤${advisoryKmh} km/h · carril helado, frena mucho antes`
    if (text === this.lastRailText) return
    this.lastRailText = text
    this.railChip.classList.toggle('hidden', !text)
    this.railChip.classList.toggle('snow', cond === 'snow')
    if (text) {
      ;(this.railChip.querySelector('.rail-icon') as HTMLElement).textContent = cond === 'snow' ? '❄️' : '☔'
      ;(this.railChip.querySelector('.rail-text') as HTMLElement).textContent = text
    }
  }

  /** Reflects the applied season/weather on the HUD chip and marks the active options. */
  setAtmo(season: Season, weather: Weather, hour: number) {
    const s = SEASONS.find((x) => x.id === season)!
    const face = weatherFace(weather, season)
    this.atmoGlyphEl.textContent = `${s.icon}${face.icon}`
    this.atmoChip.setAttribute('aria-label', `Atmósfera: ${s.label}, ${face.label}`)
    this.atmoOverlay.querySelectorAll<HTMLButtonElement>('[data-season]').forEach((b) => b.classList.toggle('active', b.dataset.season === season))
    this.atmoOverlay.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => b.classList.toggle('active', b.dataset.weather === weather))
    this.updateAtmoPhase(season, weather, hour)
  }

  /**
   * Keeps the weather names honest against the calendar (winter's "Lluvia"
   * is Nieve, its "Tormenta" is Ventisca) and shows which PHASE the hour has
   * the rain in right now — that's how the hour of the day earns its say in the
   * weather without adding a single extra option to the menu.
   * Called every frame, so it only touches the DOM when the text changes.
   */
  updateAtmoPhase(season: Season, weather: Weather, hour: number) {
    const winter = season === 'winter'
    if (winter !== this.lastAtmoWinter) {
      this.lastAtmoWinter = winter
      this.atmoOverlay.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => {
        const opt = WEATHERS.find((w) => w.id === b.dataset.weather)!
        const face = weatherFace(opt.id, season)
        b.querySelector('.atmo-icon')!.textContent = face.icon
        b.querySelector('.atmo-weather-label')!.textContent = face.label
      })
    }
    const phase = rainPhaseLabel(weather, season, hour)
    if (phase !== this.lastPhaseText) {
      this.lastPhaseText = phase
      const el = this.atmoOverlay.querySelector('.atmo-phase') as HTMLElement
      el.textContent = phase ? `Ahora mismo: ${phase.toLowerCase()}` : ''
      el.classList.toggle('hidden', !phase)
    }
  }

  /** Paints a station's dot with its stop result; the color persists for the rest of the loop. */
  setStationResult(idx: number, grade: StopResult['grade'] | 'missed') {
    const dot = this.stationDots[idx]
    if (!dot) return
    dot.classList.remove('grade-perfect', 'grade-good', 'grade-ok', 'grade-miss')
    const cls = grade === 'perfect' ? 'grade-perfect' : grade === 'good' ? 'grade-good' : grade === 'ok' ? 'grade-ok' : 'grade-miss'
    dot.classList.add(cls)
  }

  private buildStartOverlay(): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'overlay start-overlay'
    el.innerHTML = `
      <div class="overlay-card">
        <h1>ジャパンループ <span>Japan Loop</span></h1>
        <p class="tagline">Sé el maquinista. Una vuelta completa a un Japón en miniatura — templos, aldeas, neón y mar — de madrugada a madrugada.</p>
        <ul class="howto">
          <li><strong>Palanca:</strong> arrástrala arriba para acelerar (P1–P5), abajo para frenar (B1–B7/EB).</li>
          <li><strong>Teclado:</strong> ↑/W acelera, ↓/S frena, espacio = freno de emergencia, D = puertas.</li>
          <li><strong>Objetivo:</strong> detén el tren justo en el andén de cada estación.</li>
          <li><strong>Puertas:</strong> ábrelas al parar y ciérralas cuando acabe el embarque — hay bonus por reflejos.</li>
        </ul>
        <button class="btn-start">Subir a la cabina 🚃</button>
        <button class="btn-credits">Sobre el equipo</button>
        <p class="disclaimer">Juego de fans no oficial. Sin afiliación con ninguna compañía ferroviaria; las estaciones son alegorías de lugares reales de Japón usados como topónimos. Melodías 100% originales.</p>
      </div>
    `
    el.querySelector('.btn-start')!.addEventListener('click', () => {
      el.classList.add('hidden')
      this.cb.onStart()
    })
    el.querySelector('.btn-credits')!.addEventListener('click', () => this.showCredits())
    return el
  }

  private buildMenuOverlay(): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'overlay menu-overlay hidden'
    el.innerHTML = `
      <div class="overlay-card">
        <h2>Pausa</h2>
        <button class="btn-resume">Reanudar</button>
        <div class="time-scale-row">
          <span>Velocidad del ciclo día/noche</span>
          <div class="time-scale-buttons">
            <button data-scale="0.3">Lento</button>
            <button data-scale="1" class="active">Normal</button>
            <button data-scale="4">Rápido</button>
          </div>
        </div>
        <button class="btn-atmo">Atmósfera — hora, estación y clima</button>
        <div class="perf-block">
          <span class="perf-title">Horario</span>
          <div class="pa-lang-row sched-row">
            ${SCHEDULE_LEVELS.map((l) => `<button data-sched="${l.id}" title="${l.hint}">${l.label}</button>`).join('')}
          </div>
        </div>
        <div class="perf-block">
          <span class="perf-title">Megafonía</span>
          <div class="pa-lang-row">
            <button data-pa="es">日本語 + Español</button>
            <button data-pa="en">日本語 + English</button>
          </div>
        </div>
        <div class="perf-block">
          <span class="perf-title">Rendimiento</span>
          <button class="btn-perf">Medir rendimiento</button>
          <p class="perf-headline">Sin datos todavía.</p>
          <div class="perf-actions hidden">
            <button class="btn-perf-copy">Copiar log</button>
            <button class="btn-perf-clear">Borrar</button>
          </div>
        </div>
        <button class="btn-credits">Sobre el equipo</button>
        <button class="btn-close">Cerrar</button>
      </div>
    `
    el.querySelector('.btn-resume')!.addEventListener('click', () => this.toggleMenu())
    // From the pause menu, the panel replaces the menu rather than stacking
    // on it — and unpauses, since its whole job is showing the sky respond.
    el.querySelector('.btn-atmo')!.addEventListener('click', () => {
      this.toggleMenu()
      this.toggleAtmo(true)
    })
    el.querySelector('.btn-close')!.addEventListener('click', () => this.toggleMenu())
    el.querySelector('.btn-credits')!.addEventListener('click', () => this.showCredits())
    el.querySelectorAll<HTMLButtonElement>('[data-sched]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onScheduleLevelSet(btn.dataset.sched as ScheduleLevel))
    })
    el.querySelectorAll<HTMLButtonElement>('[data-pa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.pa as 'en' | 'es'
        this.cb.onPaLangSet(lang)
        this.setPaLang(lang)
      })
    })
    this.perfMenuBtn = el.querySelector('.btn-perf')!
    this.perfHeadlineEl = el.querySelector('.perf-headline')!
    this.perfActionsEl = el.querySelector('.perf-actions')!
    this.perfMenuBtn.addEventListener('click', () => this.cb.onPerfToggle())
    // Clipboard writes must happen inside the gesture, so the export runs here
    // rather than being pushed in from the game loop.
    el.querySelector('.btn-perf-copy')!.addEventListener('click', () => this.copyPerfLog())
    el.querySelector('.btn-perf-clear')!.addEventListener('click', () => this.cb.onPerfClear())
    el.querySelectorAll('.time-scale-buttons button').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.time-scale-buttons button').forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        this.cb.onTimeScaleChange(parseFloat((btn as HTMLElement).dataset.scale!))
      })
    })
    return el
  }

  private showCredits() {
    const el = document.createElement('div')
    el.className = 'overlay credits-overlay'
    el.innerHTML = `
      <div class="overlay-card credits-card">
        <h2>El equipo</h2>
        <p class="credits-intro">Japan Loop lo hacemos siete personas a las que nos obsesionan los trenes japoneses y Japón entero. Nos pusimos de acuerdo en una sola cosa antes de escribir una línea de código: si no es entretenido, inmersivo y bonito de ver y de oír, no sale de la sala de pruebas.</p>
        <ul class="team-list">
          ${TEAM.map((m) => `<li><strong>${m.name}</strong> — ${m.role}<br><span>${m.note}</span></li>`).join('')}
        </ul>
        <p class="disclaimer">Personajes ficticios creados para ambientar los créditos — no un estudio real.</p>
        <button class="btn-close">Volver</button>
      </div>
    `
    el.querySelector('.btn-close')!.addEventListener('click', () => el.remove())
    this.mount.appendChild(el)
  }

  /** How full the train is. Turns amber as it fills and red once nobody else fits. */
  setOccupancy(onboard: number, capacity: number, full: boolean) {
    const pct = Math.min(100, Math.round((onboard / capacity) * 100))
    const text = `A BORDO ${Math.round(onboard)}`
    if (text !== this.lastOccText) {
      this.lastOccText = text
      this.occLabel.textContent = text
    }
    this.occFill.style.width = `${pct}%`
    this.occFill.className = `occupancy-fill${pct > 92 ? ' packed' : pct > 70 ? ' busy' : ''}`
    if (full) this.flashToast('¡Tren completo! Se han quedado en el andén', 'overshot')
  }

  /**
   * What the stop actually moved. `missed` are the people who were still
   * queueing (or still aboard) when the doors shut — the number that makes
   * closing early cost something.
   */
  showTransferToast(stationIdx: number, alighted: number, boarded: number, missed: number) {
    const station = STATIONS[stationIdx]
    const bits: string[] = []
    if (alighted > 0) bits.push(`↓${alighted}`)
    if (boarded > 0) bits.push(`↑${boarded}`)
    if (!bits.length) bits.push('sin movimiento')
    const tail = missed > 0 ? ` · ${missed} se quedaron con las puertas cerradas` : ''
    this.flashToast(`${station.nameEn}  ${bits.join(' ')}${tail}`, missed > 12 ? 'overshot' : 'good')
  }

  /** Rolled past a platform: says who paid for it, which is the point of the penalty. */
  showSkipToast(stationIdx: number, stranded: number, carried: number, penalty: number) {
    const station = STATIONS[stationIdx]
    const bits: string[] = []
    if (stranded > 0) bits.push(`${stranded} en el andén`)
    if (carried > 0) bits.push(`${carried} querían bajar`)
    const detail = bits.length ? ` — ${bits.join(', ')}` : ''
    this.flashToast(`${station.nameEn} sin parada${detail}${penalty > 0 ? `  −${penalty}` : ''}`, 'overshot')
  }

  /**
   * Running punctuality. Green while you are on the timetable, amber as it
   * slips, red once the arrival would count as late — the same thresholds the
   * score uses, so the colour is a promise and not decoration.
   */
  setDelay(seconds: number) {
    const text = Schedule.format(seconds)
    if (text !== this.lastDelayText) {
      this.lastDelayText = text
      this.delayValueEl.textContent = text
    }
    const cls = seconds > LATE_TOLERANCE ? 'late' : seconds > ON_TIME_TOLERANCE ? 'slipping' : 'on-time'
    if (!this.delayChip.classList.contains(cls)) this.delayChip.className = `delay-chip ${cls}`
  }

  /** Verdict on an arrival, in the language a train crew would use. */
  showPunctualityToast(delay: number) {
    if (delay <= ON_TIME_TOLERANCE) {
      this.flashToast(delay < -ON_TIME_TOLERANCE ? `Adelantado ${Schedule.format(delay)}` : 'En horario ⏱', 'perfect')
    } else if (delay <= LATE_TOLERANCE) {
      this.flashToast(`Ajustado — ${Schedule.format(delay)}`, 'ok')
    } else {
      this.flashToast(`Con retraso ${Schedule.format(delay)}`, 'overshot')
    }
  }

  setScheduleLevel(level: ScheduleLevel) {
    this.menuOverlay.querySelectorAll<HTMLButtonElement>('[data-sched]').forEach((b) => b.classList.toggle('active', b.dataset.sched === level))
  }

  /**
   * A one-off explanation, shown when the game does something the player
   * needs to understand rather than merely notice. Dismissed by tapping it —
   * it never blocks the train.
   */
  showHint(title: string, body: string) {
    const el = document.createElement('div')
    el.className = 'hint-card'
    el.innerHTML = `<strong>${title}</strong><p>${body}</p><button>Entendido</button>`
    const close = () => el.remove()
    el.querySelector('button')!.addEventListener('click', close)
    window.setTimeout(close, 11000)
    this.mount.appendChild(el)
  }

  /** The station-camera dressing: shown only while looking through it. */
  setCctv(on: boolean) {
    this.cctvEl.classList.toggle('hidden', !on)
  }

  setCctvLabel(station: string) {
    if (station === this.lastCctvStation) return
    this.lastCctvStation = station
    ;(this.cctvEl.querySelector('.cctv-station') as HTMLElement).textContent = station.toUpperCase()
  }

  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode
    const m = CAMERA_MODES.find((x) => x.id === mode)!
    ;(this.camChip.querySelector('.cam-icon') as HTMLElement).textContent = m.icon
    ;(this.camChip.querySelector('.cam-label') as HTMLElement).textContent = m.label
    this.camChip.setAttribute('aria-label', `Vista: ${m.label}. Tocar para cambiar.`)
  }

  setPaLang(lang: 'en' | 'es') {
    this.menuOverlay.querySelectorAll<HTMLButtonElement>('[data-pa]').forEach((b) => b.classList.toggle('active', b.dataset.pa === lang))
  }

  /** Live frame counter. Only touches the DOM when the rounded number changes. */
  updatePerfChip(fps: number, recording: boolean) {
    this.perfChip.classList.toggle('hidden', !recording)
    if (!recording) return
    const text = String(Math.round(fps))
    if (text === this.lastFpsText) return
    this.lastFpsText = text
    ;(this.perfChip.querySelector('.perf-fps') as HTMLElement).textContent = text
  }

  setPerfState(recording: boolean, headline: string, hasData: boolean) {
    this.perfMenuBtn.textContent = recording ? '⏹ Detener medición' : '⏺ Medir rendimiento'
    this.perfMenuBtn.classList.toggle('recording', recording)
    this.perfHeadlineEl.textContent = headline
    this.perfActionsEl.classList.toggle('hidden', !hasData || recording)
  }

  /**
   * Hands the log over. Clipboard first (one tap, then paste it in the chat);
   * if the platform refuses — and iOS will, outside a trusted gesture or over
   * plain http — fall back to a selected textarea, which always works.
   */
  private async copyPerfLog() {
    const payload = this.cb.onPerfExport()
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payload)
      this.flashToast(`Log copiado (${Math.round(payload.length / 1024)} KB) — pégamelo en el chat`, 'good')
    } catch {
      // One dump at a time — tapping copy twice must not stack textareas.
      this.menuOverlay.querySelector('.perf-dump')?.remove()
      const ta = document.createElement('textarea')
      ta.className = 'perf-dump'
      ta.value = payload
      ta.readOnly = true
      this.menuOverlay.querySelector('.perf-block')!.appendChild(ta)
      ta.focus()
      ta.select()
      this.flashToast('Copia el texto seleccionado a mano', 'ok')
    }
  }

  private toggleMenu() {
    this.menuOpen = !this.menuOpen
    this.menuOverlay.classList.toggle('hidden', !this.menuOpen)
    this.paused = this.menuOpen
    this.cb.onPauseToggle(this.paused)
  }

  updateClock(timeOfDay: number, phaseLabel: string) {
    const h = Math.floor(timeOfDay)
    const m = Math.floor((timeOfDay - h) * 60)
    const stamp = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    this.clockEl.textContent = stamp
    this.phaseEl.textContent = phaseLabel
    // The timecode only matters while the station camera is up.
    if (!this.cctvEl.classList.contains('hidden')) {
      ;(this.cctvEl.querySelector('.cctv-time') as HTMLElement).textContent = stamp
    }
  }

  updateTrain(opts: {
    speedKmh: number
    notchLabel: string
    currentStationIdx: number
    targetStationIdx: number
    doorsOpenAmount: number
    doorPhase: DoorPhase
    /** 0..1 — how much of the boarding time has elapsed (only meaningful while boarding). */
    boardingProgress: number
    /** 0..1 — how far along the current inter-station segment the train is. */
    segmentProgress: number
  }) {
    this.speedEl.textContent = String(Math.round(opts.speedKmh))
    if (opts.notchLabel !== this.lastNotchLabel) {
      this.lastNotchLabel = opts.notchLabel
      this.speedEl.classList.add('bump')
      window.setTimeout(() => this.speedEl.classList.remove('bump'), 120)
    }
    this.notchEl.textContent = opts.notchLabel
    this.notchEl.className = 'notch-readout' + (opts.notchLabel.startsWith('B') || opts.notchLabel === 'EB' ? ' braking' : opts.notchLabel.startsWith('P') ? ' powering' : '')
    this.stationNowEl.textContent = STATIONS[opts.currentStationIdx].nameEn
    this.stationNextEl.textContent = STATIONS[opts.targetStationIdx].nameEn
    // "JL" (Japan Loop) numbering — the ring's own code, not any operator's.
    this.stationNowCodeEl.textContent = `JL${String(opts.currentStationIdx + 1).padStart(2, '0')}`
    this.stationNextCodeEl.textContent = `JL${String(opts.targetStationIdx + 1).padStart(2, '0')}`
    const pct = Math.round(opts.segmentProgress * 100)
    this.segmentFillEl.style.width = `${pct}%`
    this.segmentTrainEl.style.left = `${pct}%`
    // Door button: class/label churn only on phase change; the boarding
    // fill is the one thing that animates every frame.
    if (opts.doorPhase !== this.lastDoorPhase) {
      this.lastDoorPhase = opts.doorPhase
      this.doorBtn.className = `door-btn door-${opts.doorPhase}`
      this.doorBtnLabel.textContent = DOOR_LABELS[opts.doorPhase]
      this.doorBtn.disabled = opts.doorPhase !== 'can-open' && opts.doorPhase !== 'can-close'
    }
    this.doorBtnProgress.style.width = opts.doorPhase === 'boarding' ? `${Math.round(opts.boardingProgress * 100)}%` : '0%'

    this.stationDots.forEach((dot, i) => {
      dot.classList.toggle('current', i === opts.currentStationIdx)
      dot.classList.toggle('next', i === opts.targetStationIdx)
    })
  }

  /** Score chip refresh; a short streak flourish appears from 2 consecutive perfects. */
  setScore(score: number, best: number, streak: number) {
    this.scoreValueEl.textContent = String(score)
    this.scoreBestEl.textContent = `MEJOR ${best}` + (streak >= 2 ? ` · 🔥x${streak}` : '')
    this.scoreValueEl.classList.add('bump')
    window.setTimeout(() => this.scoreValueEl.classList.remove('bump'), 160)
  }

  showStopToast(stationIdx: number, result: StopResult, gained = 0) {
    const station = STATIONS[stationIdx]
    const messages: Record<StopResult['grade'], string> = {
      perfect: '¡Parada perfecta! 🎯',
      good: 'Buena parada',
      ok: 'Parada correcta',
      overshot: 'Te has pasado el andén…',
      undershot: 'Te has quedado corto…',
    }
    const points = gained > 0 ? `  +${gained}` : ''
    this.flashToast(`${station.nameEn} — ${messages[result.grade]}${points}`, result.grade)
  }

  /** The H3 front director narrating the sky: rain starting/stopping only. */
  showWeatherToast(text: string) {
    this.flashToast(text, 'ok')
  }

  /** Door-work bonus feedback — same toast rail as stop grades, always positive. */
  showDoorToast(label: string, points: number) {
    this.flashToast(`${label}  +${points}`, 'good')
  }

  showMissedToast(stationIdx: number) {
    const station = STATIONS[stationIdx]
    this.flashToast(`${station.nameEn} — sin parada, seguimos hasta la próxima`, 'overshot')
  }

  private flashToast(text: string, grade: string) {
    this.toastEl.textContent = text
    this.toastEl.className = `toast show grade-${grade}`
    window.clearTimeout((this.toastEl as any)._t)
    ;(this.toastEl as any)._t = window.setTimeout(() => this.toastEl.classList.remove('show'), 3200)
  }
}
