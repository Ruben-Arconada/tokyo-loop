import { MAX_NOTCH, MIN_NOTCH, notchLabel } from '../game/Train'

export interface ControlsCallbacks {
  onNotchChange: (notch: number) => void
  onLook?: (dx: number, dy: number) => void
}

const NOTCH_COUNT = MAX_NOTCH - MIN_NOTCH + 1 // 14 discrete positions

/**
 * Builds the on-screen "wan-handle" master controller (the single lever real
 * Japanese EMUs use for both power and brake) plus keyboard bindings, and a
 * drag-to-look zone over the main viewport.
 */
export class Controls {
  private notch = 0
  private root: HTMLDivElement
  private handle: HTMLDivElement
  private track: HTMLDivElement
  private labelEl: HTMLDivElement
  private dragging = false
  private cb: ControlsCallbacks

  constructor(mount: HTMLElement, cb: ControlsCallbacks) {
    this.cb = cb
    // A neutral full-viewport layer (same pattern as UI's .hud) so the lever
    // group and the E-brake button can each be positioned independently
    // against opposite screen edges instead of sharing one flex group.
    this.root = document.createElement('div')
    this.root.className = 'controls-layer'
    this.root.innerHTML = `
      <div class="controller">
        <div class="controller-notches"></div>
        <div class="controller-track">
          <div class="controller-handle"><span class="controller-handle-label">N</span></div>
        </div>
      </div>
      <button class="controller-eb" aria-label="Freno de emergencia">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2 L22 20 L2 20 Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="16" x2="12" y2="16.01" />
        </svg>
      </button>
    `
    mount.appendChild(this.root)

    this.track = this.root.querySelector('.controller-track')!
    this.handle = this.root.querySelector('.controller-handle')!
    this.labelEl = this.handle.querySelector('.controller-handle-label')!

    const notchesEl = this.root.querySelector('.controller-notches')!
    for (let n = MAX_NOTCH; n >= MIN_NOTCH; n--) {
      const tick = document.createElement('div')
      tick.className = 'controller-tick' + (n === 0 ? ' controller-tick-zero' : '')
      tick.textContent = notchLabel(n)
      notchesEl.appendChild(tick)
    }

    this.bindPointer()
    this.bindKeyboard()
    this.bindEmergency()
    this.bindLook(mount)
    this.setNotch(0)
  }

  private notchFromClientY(clientY: number): number {
    const rect = this.track.getBoundingClientRect()
    const f = 1 - (clientY - rect.top) / rect.height // 1 = top (max power), 0 = bottom (max brake)
    const raw = MIN_NOTCH + f * NOTCH_COUNT
    return Math.round(Math.min(MAX_NOTCH, Math.max(MIN_NOTCH, raw)))
  }

  private bindPointer() {
    const start = (e: PointerEvent) => {
      this.dragging = true
      this.handle.classList.add('dragging')
      this.handle.setPointerCapture(e.pointerId)
      this.setNotch(this.notchFromClientY(e.clientY))
    }
    const move = (e: PointerEvent) => {
      if (!this.dragging) return
      this.setNotch(this.notchFromClientY(e.clientY))
    }
    const end = () => {
      this.dragging = false
      this.handle.classList.remove('dragging')
    }
    this.handle.addEventListener('pointerdown', start)
    this.handle.addEventListener('pointermove', move)
    this.handle.addEventListener('pointerup', end)
    this.handle.addEventListener('pointercancel', end)
    this.track.addEventListener('pointerdown', (e) => {
      if (e.target === this.handle) return
      this.setNotch(this.notchFromClientY(e.clientY))
    })
  }

  private bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
          e.preventDefault()
          this.setNotch(this.notch + 1)
          break
        case 'ArrowDown':
        case 'KeyS':
          e.preventDefault()
          this.setNotch(this.notch - 1)
          break
        case 'Space':
          e.preventDefault()
          this.setNotch(MIN_NOTCH)
          break
        case 'KeyN':
          this.setNotch(0)
          break
      }
    })
  }

  private bindEmergency() {
    const btn = this.root.querySelector('.controller-eb')!
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.setNotch(MIN_NOTCH)
    })
  }

  private bindLook(mount: HTMLElement) {
    let last: { x: number; y: number } | null = null
    const viewport = mount
    viewport.addEventListener('pointerdown', (e) => {
      // .controls-layer covers both the lever group and the E-brake button
      // (now independent siblings, not nested) — excluding the wrapper
      // keeps a tap on either from also starting a look-drag.
      if ((e.target as HTMLElement).closest('.controls-layer, .hud, .overlay')) return
      last = { x: e.clientX, y: e.clientY }
    })
    viewport.addEventListener('pointermove', (e) => {
      if (!last) return
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      last = { x: e.clientX, y: e.clientY }
      this.cb.onLook?.(dx, dy)
    })
    const clear = () => (last = null)
    viewport.addEventListener('pointerup', clear)
    viewport.addEventListener('pointercancel', clear)
    viewport.addEventListener('pointerleave', clear)
  }

  private setNotch(n: number) {
    const clamped = Math.min(MAX_NOTCH, Math.max(MIN_NOTCH, n))
    const changed = clamped !== this.notch
    this.notch = clamped
    const f = (this.notch - MIN_NOTCH) / NOTCH_COUNT // 0 (brake) .. 1 (power)
    this.handle.style.bottom = `${f * 100}%`
    this.labelEl.textContent = notchLabel(this.notch)
    this.handle.classList.toggle('controller-handle-brake', this.notch < 0)
    this.handle.classList.toggle('controller-handle-power', this.notch > 0)
    this.handle.classList.toggle('controller-handle-eb', this.notch === MIN_NOTCH)
    if (changed) {
      if (this.notch === MIN_NOTCH) navigator.vibrate?.([0, 25, 15, 25])
      else navigator.vibrate?.(8)
    }
    this.cb.onNotchChange(this.notch)
  }

  /** External sync, e.g. after the physics layer clamps notch to 0 for doors. */
  syncNotch(n: number) {
    if (n !== this.notch) this.setNotch(n)
  }
}
