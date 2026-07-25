import { STATIONS } from '../data/stations'
import type { StopResult } from '../game/Train'
import { TEAM } from '../data/team'
import { SEASONS, WEATHERS, weatherFace, rainPhaseLabel, type Season, type Weather } from '../game/Seasons'
import { CAMERA_MODES, type CameraMode } from '../game/cameraModes'

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
  /** Which eye the player looks through: cab, outside, or standing on the platform. */
  onCameraSet: (mode: CameraMode) => void
  /** Second PA language (Japanese is always there). */
  onPaLangSet: (lang: 'en' | 'es') => void
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
  private toastEl: HTMLDivElement
  private menuOpen = false
  private atmoOpen = false
  private paused = false
  private atmoChip!: HTMLButtonElement
  private atmoGlyphEl!: HTMLSpanElement
  private perfChip!: HTMLDivElement
  private camChip!: HTMLButtonElement
  private occFill!: HTMLDivElement
  private occLabel!: HTMLElement
  private lastOccText = ''
  private cameraMode: CameraMode = 'cab'
  private perfMenuBtn!: HTMLButtonElement
  private perfHeadlineEl!: HTMLParagraphElement
  private perfActionsEl!: HTMLDivElement
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
              <span class="hud-station-row"><span class="tl-badge hud-station-now-code">TL01</span><span class="hud-station-now-name">Tokyo</span></span>
            </div>
            <div class="hud-station-next">
              <small>PRÓXIMA</small>
              <span class="hud-station-row"><span class="tl-badge hud-station-next-code">TL02</span><span class="hud-station-next-name">Kanda</span></span>
            </div>
          </div>
          <div class="segment-progress">
            <div class="segment-progress-fill"></div>
            <div class="segment-progress-train">🚃</div>
          </div>
        </div>
      </div>
      <div class="line-diagram"></div>
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
      <button class="cam-chip" aria-label="Cambiar vista">
        <span class="cam-icon">🚉</span><span class="cam-label">Cabina</span>
      </button>
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
              ${WEATHERS.map((w) => `<button data-weather="${w.id}"><span class="atmo-icon">${w.icon}</span><span class="atmo-weather-label">${w.label}</span></button>`).join('')}
            </div>
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
    return el
  }

  private toggleAtmo(force?: boolean) {
    this.atmoOpen = force ?? !this.atmoOpen
    this.atmoOverlay.classList.toggle('hidden', !this.atmoOpen)
    this.atmoChip.setAttribute('aria-expanded', String(this.atmoOpen))
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
        <h1>東京ループ <span>Tokyo Loop</span></h1>
        <p class="tagline">Sé el maquinista. Un giro completo a la línea circular de Tokio, de madrugada a madrugada.</p>
        <ul class="howto">
          <li><strong>Palanca:</strong> arrástrala arriba para acelerar (P1–P5), abajo para frenar (B1–B7/EB).</li>
          <li><strong>Teclado:</strong> ↑/W acelera, ↓/S frena, espacio = freno de emergencia, D = puertas.</li>
          <li><strong>Objetivo:</strong> detén el tren justo en el andén de cada estación.</li>
          <li><strong>Puertas:</strong> ábrelas al parar y ciérralas cuando acabe el embarque — hay bonus por reflejos.</li>
        </ul>
        <button class="btn-start">Subir a la cabina 🚃</button>
        <button class="btn-credits">Sobre el equipo</button>
        <p class="disclaimer">Juego de fans no oficial. Sin afiliación con JR East ni con ninguna compañía ferroviaria; los nombres de estación se usan como topónimos. Melodías 100% originales.</p>
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
        <p class="credits-intro">Tokyo Loop lo hacemos siete personas a las que nos obsesionan los trenes japoneses y Tokio. Nos pusimos de acuerdo en una sola cosa antes de escribir una línea de código: si no es entretenido, inmersivo y bonito de ver y de oír, no sale de la sala de pruebas.</p>
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

  /** Rolled past a platform: says who paid for it, which is the point of the penalty. */
  showSkipToast(stationIdx: number, stranded: number, carried: number, penalty: number) {
    const station = STATIONS[stationIdx]
    const bits: string[] = []
    if (stranded > 0) bits.push(`${stranded} en el andén`)
    if (carried > 0) bits.push(`${carried} querían bajar`)
    const detail = bits.length ? ` — ${bits.join(', ')}` : ''
    this.flashToast(`${station.nameEn} sin parada${detail}${penalty > 0 ? `  −${penalty}` : ''}`, 'overshot')
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
    this.clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    this.phaseEl.textContent = phaseLabel
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
    // "TL" (Tokyo Loop) numbering — deliberately NOT the real operator's
    // line code, which is part of JR East's registered signage system.
    this.stationNowCodeEl.textContent = `TL${String(opts.currentStationIdx + 1).padStart(2, '0')}`
    this.stationNextCodeEl.textContent = `TL${String(opts.targetStationIdx + 1).padStart(2, '0')}`
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
