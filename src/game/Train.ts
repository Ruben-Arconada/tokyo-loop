import * as THREE from 'three'
import type { Track } from './Track'
import { STATIONS, nextStationIndex } from '../data/stations'

// World units traveled per second per km/h of speed. Chosen so the loop
// (built from the stylized track shape) takes a few minutes of pure running
// time — an arcade pace, not a literal 1:1 physical simulation.
export const SPEED_SCALE = 0.32

export const MAX_NOTCH = 5
export const MIN_NOTCH = -8 // -8 = emergency brake, -1..-7 = B1..B7

export function notchLabel(n: number): string {
  if (n === MIN_NOTCH) return 'EB'
  if (n < 0) return `B${-n}`
  if (n === 0) return 'N'
  return `P${n}`
}

const POWER_ACCEL_KMH_S = [0.9, 1.5, 2.1, 2.7, 3.3] // P1..P5
const BRAKE_DECEL_KMH_S = [1.0, 1.6, 2.2, 2.8, 3.4, 4.0, 4.6] // B1..B7
const EMERGENCY_DECEL_KMH_S = 6.0
const COAST_DRAG_KMH_S = 0.15
const MAX_SPEED_KMH = 95

const STATION_ZONE_HALF_WIDTH = 26 // world units either side of the platform marker
const STOP_SPEED_THRESHOLD_KMH = 3
const ARRIVING_ANNOUNCE_DISTANCE = 260 // early enough for the trilingual arrival announcement to finish before the platform
const DOOR_ANIM_SECONDS = 1.4

// ——— Manual door timing (the player is the conductor) ———
// Doors never open or close on their own while the player is on the ball;
// the auto fallbacks only exist so a distracted player is never soft-locked
// in a station. Bonus windows are generous enough to hit on a phone.
export const OPEN_INSTANT_SECONDS = 2.0 // open within this after stopping → top bonus
export const OPEN_QUICK_SECONDS = 4.5 // → smaller bonus
const OPEN_AUTO_SECONDS = 9 // conductor takes over, no bonus
export const CLOSE_WINDOW_SECONDS = 3.5 // close within this after boarding ends → departure bonus
export const CLOSE_HURRY_SECONDS = 5.5 // hurry-up warning if doors still open past this
const CLOSE_AUTO_SECONDS = 9.5 // doors close on their own, no bonus

export type TrainRunState = 'running' | 'stopped' | 'doors_open' | 'doors_closing'

/** How a door transition happened and how sharp the player was. */
export interface DoorActionInfo {
  /** Seconds since the moment the action first became available. */
  delaySeconds: number
  /** True when the fallback timer acted, not the player. */
  auto: boolean
}

export interface StopResult {
  grade: 'perfect' | 'good' | 'ok' | 'overshot' | 'undershot'
  errorUnits: number
}

export interface TrainEvents {
  onDepartAnnounce?: (stationIndex: number, nextIndex: number) => void
  onArrivingAnnounce?: (stationIndex: number) => void
  onStopped?: (stationIndex: number, result: StopResult) => void
  onMissed?: (stationIndex: number, result: StopResult) => void
  onDoorsOpen?: (stationIndex: number, info: DoorActionInfo) => void
  /** Passengers are all aboard — the close window (and its bonus timer) starts now. */
  onBoardingComplete?: (stationIndex: number) => void
  /** Player is dawdling with the doors open; fire the "doors are closing" warning. */
  onCloseHurryUp?: (stationIndex: number) => void
  onDoorsClose?: (stationIndex: number, info: DoorActionInfo) => void
}

function wrappedSignedDelta(a: number, b: number): number {
  return (((a - b) % 1) + 1.5) % 1 - 0.5
}

export class Train {
  progressFraction = 0
  speedKmh = 0
  notch = 0
  currentStationIndex = 0
  targetStationIndex = 1
  state: TrainRunState = 'running'
  doorsOpenAmount = 0
  lastStopResult: StopResult | null = null
  /** Seconds passengers need to board once the doors open — set per stop (rush hour takes longer). */
  boardingSeconds = 8
  boardingRemaining = 0
  boardingComplete = false
  private track: Track
  private events: TrainEvents
  private announcedArriving = false
  private stoppedElapsed = 0
  private closeElapsed = 0
  private hurryUpFired = false

  constructor(track: Track, events: TrainEvents = {}) {
    this.track = track
    this.events = events
    this.progressFraction = track.markerFor(0).tFraction
  }

  setNotch(n: number) {
    this.notch = THREE.MathUtils.clamp(n, MIN_NOTCH, MAX_NOTCH)
  }

  get speed01(): number {
    return this.speedKmh / MAX_SPEED_KMH
  }

  get brakeAmount01(): number {
    return this.notch < 0 ? Math.abs(this.notch) / 8 : 0
  }

  get distanceToTarget(): number {
    const marker = this.track.markerFor(this.targetStationIndex)
    return this.forwardDistanceUnits(marker.tFraction)
  }

  private forwardDistanceUnits(targetT: number): number {
    const frac = ((targetT - this.progressFraction) % 1 + 1) % 1
    return frac * this.track.getLength()
  }

  /**
   * Player door control. In 'stopped' it opens the doors; with the doors open
   * and boarding finished it closes them. Any other moment is a no-op (early
   * closes are swallowed — passengers are still boarding). Returns true if the
   * press did something, so the UI can give tactile feedback only on real acts.
   */
  requestDoorAction(): boolean {
    if (this.state === 'stopped') {
      this.openDoors(false)
      return true
    }
    if (this.state === 'doors_open' && this.boardingComplete) {
      this.closeDoors(false)
      return true
    }
    return false
  }

  private openDoors(auto: boolean) {
    this.state = 'doors_open'
    this.doorsOpenAmount = 0
    this.boardingRemaining = this.boardingSeconds
    this.boardingComplete = false
    this.closeElapsed = 0
    this.hurryUpFired = false
    this.events.onDoorsOpen?.(this.targetStationIndex, { delaySeconds: this.stoppedElapsed, auto })
  }

  private closeDoors(auto: boolean) {
    this.state = 'doors_closing'
    this.events.onDoorsClose?.(this.targetStationIndex, { delaySeconds: this.closeElapsed, auto })
  }

  update(dt: number) {
    if (this.state === 'stopped') {
      // Doors shut, waiting on the player's OPEN. The conductor covers for a
      // distracted driver after a while — without any bonus.
      this.stoppedElapsed += dt
      if (this.stoppedElapsed >= OPEN_AUTO_SECONDS) this.openDoors(true)
      return
    }
    if (this.state === 'doors_open') {
      this.doorsOpenAmount = Math.min(1, this.doorsOpenAmount + dt / DOOR_ANIM_SECONDS)
      if (!this.boardingComplete) {
        this.boardingRemaining -= dt
        if (this.boardingRemaining <= 0) {
          this.boardingComplete = true
          this.events.onBoardingComplete?.(this.targetStationIndex)
        }
      } else {
        this.closeElapsed += dt
        if (!this.hurryUpFired && this.closeElapsed >= CLOSE_HURRY_SECONDS) {
          this.hurryUpFired = true
          this.events.onCloseHurryUp?.(this.targetStationIndex)
        }
        if (this.closeElapsed >= CLOSE_AUTO_SECONDS) this.closeDoors(true)
      }
      return
    }
    if (this.state === 'doors_closing') {
      this.doorsOpenAmount = Math.max(0, this.doorsOpenAmount - dt / DOOR_ANIM_SECONDS)
      if (this.doorsOpenAmount <= 0) {
        this.currentStationIndex = this.targetStationIndex
        this.targetStationIndex = nextStationIndex(this.currentStationIndex)
        this.announcedArriving = false
        this.state = 'running'
        this.events.onDepartAnnounce?.(this.currentStationIndex, this.targetStationIndex)
      }
      return
    }

    // Running: integrate speed from the current controller notch.
    let accelKmhS = -COAST_DRAG_KMH_S
    if (this.notch === MIN_NOTCH) accelKmhS = -EMERGENCY_DECEL_KMH_S
    else if (this.notch < 0) accelKmhS = -BRAKE_DECEL_KMH_S[Math.abs(this.notch) - 1]
    else if (this.notch > 0) accelKmhS = POWER_ACCEL_KMH_S[this.notch - 1]

    this.speedKmh = THREE.MathUtils.clamp(this.speedKmh + accelKmhS * dt, 0, MAX_SPEED_KMH)

    const worldSpeed = this.speedKmh * SPEED_SCALE
    this.progressFraction = THREE.MathUtils.euclideanModulo(
      this.progressFraction + (worldSpeed * dt) / this.track.getLength(),
      1,
    )

    const marker = this.track.markerFor(this.targetStationIndex)
    const distForward = this.forwardDistanceUnits(marker.tFraction)
    const signedError = wrappedSignedDelta(this.progressFraction, marker.tFraction) * this.track.getLength()

    if (!this.announcedArriving && distForward < ARRIVING_ANNOUNCE_DISTANCE) {
      this.announcedArriving = true
      this.events.onArrivingAnnounce?.(this.targetStationIndex)
    }

    const inZone = Math.abs(signedError) <= STATION_ZONE_HALF_WIDTH
    if (inZone && this.speedKmh <= STOP_SPEED_THRESHOLD_KMH) {
      this.finalizeStop(signedError)
    } else if (!inZone && signedError > STATION_ZONE_HALF_WIDTH && signedError < STATION_ZONE_HALF_WIDTH + 40) {
      // Rolled through the platform zone without stopping.
      const result: StopResult = { grade: 'overshot', errorUnits: signedError }
      this.lastStopResult = result
      this.events.onMissed?.(this.targetStationIndex, result)
      this.currentStationIndex = this.targetStationIndex
      this.targetStationIndex = nextStationIndex(this.currentStationIndex)
      this.announcedArriving = false
    }
  }

  private finalizeStop(signedError: number) {
    const abs = Math.abs(signedError)
    let grade: StopResult['grade']
    if (abs <= 3) grade = 'perfect'
    else if (abs <= 8) grade = 'good'
    else grade = 'ok'
    const result: StopResult = { grade, errorUnits: signedError }
    this.lastStopResult = result
    this.speedKmh = 0
    this.notch = 0
    // Doors stay SHUT: opening them is the player's job now (with a bonus
    // for a sharp reaction). See requestDoorAction().
    this.state = 'stopped'
    this.doorsOpenAmount = 0
    this.stoppedElapsed = 0
    this.events.onStopped?.(this.targetStationIndex, result)
  }

  get currentStation() {
    return STATIONS[this.currentStationIndex]
  }
  get targetStation() {
    return STATIONS[this.targetStationIndex]
  }
}
