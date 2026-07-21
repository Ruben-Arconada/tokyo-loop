import { STATIONS } from '../data/stations'
import type { StopResult } from '../game/Train'
import { TEAM } from '../data/team'

export interface UICallbacks {
  onStart: () => void
  onPauseToggle: (paused: boolean) => void
  onTimeScaleChange: (scale: number) => void
  /** The player tapped a preset in the clock's time picker. */
  onTimeSet: (hour: number) => void
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
  private lineDiagram!: HTMLDivElement
  private stationDots: HTMLDivElement[] = []
  private doorIndicator!: HTMLDivElement
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
          <div class="hud-station-now">
            <small>PARADA ACTUAL</small>
            <span class="hud-station-row"><span class="jy-badge hud-station-now-code">JY01</span><span class="hud-station-now-name">Tokyo</span></span>
          </div>
          <div class="hud-station-next">
            <small>PRÓXIMA</small>
            <span class="hud-station-row"><span class="jy-badge hud-station-next-code">JY02</span><span class="hud-station-next-name">Kanda</span></span>
          </div>
        </div>
      </div>
      <div class="line-diagram"></div>
      <div class="hud-bottom">
        <div class="door-indicator">DOORS</div>
        <div class="speed-gauge">
          <span class="speed-value">0</span>
          <span class="speed-unit">km/h</span>
        </div>
        <div class="notch-readout">N</div>
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
    this.doorIndicator = this.hud.querySelector('.door-indicator')!
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
        <h1>山手線 <span>Yamanote Fun</span></h1>
        <p class="tagline">Sé el maquinista. Un giro completo de Tokio, de madrugada a madrugada.</p>
        <ul class="howto">
          <li><strong>Palanca:</strong> arrástrala arriba para acelerar (P1–P5), abajo para frenar (B1–B7/EB).</li>
          <li><strong>Teclado:</strong> ↑/W acelera, ↓/S frena, espacio = freno de emergencia.</li>
          <li><strong>Objetivo:</strong> detén el tren justo en el andén de cada estación.</li>
        </ul>
        <button class="btn-start">Subir a la cabina 🚃</button>
        <button class="btn-credits">Sobre el equipo</button>
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
        <p class="credits-intro">Yamanote Fun lo hacemos siete personas a las que nos obsesionan los trenes japoneses y Tokio. Nos pusimos de acuerdo en una sola cosa antes de escribir una línea de código: si no es entretenido, inmersivo y bonito de ver y de oír, no sale de la sala de pruebas.</p>
        <ul class="team-list">
          ${TEAM.map((m) => `<li><strong>${m.name}</strong> — ${m.role}<br><span>${m.note}</span></li>`).join('')}
        </ul>
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
    this.stationNowCodeEl.textContent = `JY${String(opts.currentStationIdx + 1).padStart(2, '0')}`
    this.stationNextCodeEl.textContent = `JY${String(opts.targetStationIdx + 1).padStart(2, '0')}`
    this.doorIndicator.classList.toggle('open', opts.doorsOpenAmount > 0.05)
    this.doorIndicator.textContent = opts.doorsOpenAmount > 0.05 ? 'DOORS OPEN' : 'DOORS'

    this.stationDots.forEach((dot, i) => {
      dot.classList.toggle('current', i === opts.currentStationIdx)
      dot.classList.toggle('next', i === opts.targetStationIdx)
    })
  }

  showStopToast(stationIdx: number, result: StopResult) {
    const station = STATIONS[stationIdx]
    const messages: Record<StopResult['grade'], string> = {
      perfect: '¡Parada perfecta! 🎯',
      good: 'Buena parada',
      ok: 'Parada correcta',
      overshot: 'Te has pasado el andén…',
      undershot: 'Te has quedado corto…',
    }
    this.flashToast(`${station.nameEn} — ${messages[result.grade]}`, result.grade)
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
