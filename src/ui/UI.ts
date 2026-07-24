import { STATIONS } from '../data/stations'
import type { StopResult } from '../game/Train'
import { TEAM } from '../data/team'

export interface UICallbacks {
  onStart: () => void
  onPauseToggle: (paused: boolean) => void
  onTimeScaleChange: (scale: number) => void
  /** The player tapped a preset in the clock's time picker. */
  onTimeSet: (hour: number) => void
  /** The player tapped the door button (open or close — the game decides). */
  onDoorAction: () => void
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
  private toastEl: HTMLDivElement
  private menuOpen = false
  private paused = false

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
        <button class="hud-clock" aria-label="Cambiar hora del día">
          <span class="hud-clock-time">07:30</span>
          <span class="hud-clock-phase">Mañana</span>
        </button>
        <div class="time-picker hidden">
          ${TIME_PRESETS.map((p) => `<button data-hour="${p.hour}">${p.label}</button>`).join('')}
        </div>
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

    for (let i = 0; i < STATIONS.length; i++) {
      const dot = document.createElement('div')
      dot.className = 'line-dot'
      dot.title = STATIONS[i].nameEn
      this.lineDiagram.appendChild(dot)
      this.stationDots.push(dot)
    }

    this.hud.querySelector('.hud-menu-btn')!.addEventListener('click', () => this.toggleMenu())

    // Clock tap → time-of-day picker. Tapping a preset jumps the cycle there.
    const picker = this.hud.querySelector('.time-picker') as HTMLDivElement
    this.hud.querySelector('.hud-clock')!.addEventListener('click', () => picker.classList.toggle('hidden'))
    picker.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.cb.onTimeSet(parseFloat((btn as HTMLElement).dataset.hour!))
        picker.classList.add('hidden')
      })
    })
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
        <button class="btn-credits">Sobre el equipo</button>
        <button class="btn-close">Cerrar</button>
      </div>
    `
    el.querySelector('.btn-resume')!.addEventListener('click', () => this.toggleMenu())
    el.querySelector('.btn-close')!.addEventListener('click', () => this.toggleMenu())
    el.querySelector('.btn-credits')!.addEventListener('click', () => this.showCredits())
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
