import { STATIONS } from '../data/stations'
import type { Track } from './Track'

// ————————————————————————————————————————————————————————————————
// The timetable. Without one, holding the doors open costs nothing and the
// choice Rubén wanted — cut the boarding short to buy time, and wear the
// passengers you strand — has no other side. The clock is that other side.
//
// It runs on REAL seconds, not the accelerated game clock: a day passes in
// eight minutes here, so a schedule in game-hours would be meaningless. What
// the player is judged against is how long they actually took.
// ————————————————————————————————————————————————————————————————

const N = STATIONS.length

/** Standard dwell allowed at every stop, in seconds. Hold longer and you fall behind. */
export const DWELL_ALLOWANCE = 12

export type ScheduleLevel = 'relaxed' | 'normal' | 'strict'

export const SCHEDULE_LEVELS: { id: ScheduleLevel; label: string; hint: string; margin: number }[] = [
  // `margin` multiplies the PHYSICALLY minimum run time for each segment. 1.0
  // would mean flooring the power the instant the doors shut and braking at
  // the last possible metre, every single time.
  { id: 'relaxed', label: 'Tranquilo', hint: 'Margen de sobra', margin: 1.2 },
  { id: 'normal', label: 'Normal', hint: 'Un pequeño colchón', margin: 1.04 },
  { id: 'strict', label: 'Estricto', hint: 'Hay que conducir fino', margin: 0.94 },
]

// Calibrated against a scripted driver that powers up immediately and brakes
// on B5 at the last sensible moment: it runs at ~0.94× the reference below,
// so Normal hands a careful human about a four-second cushion per segment and
// Strict demands a near-perfect run. The first guess (1.18) let that driver
// bank ten seconds a stop, which is not a timetable, it is a formality.

// The run profile the timetable assumes: accelerate on full power, hold, then
// brake on a service application (not emergency). In world units per second².
const ACCEL = 3.3 * 0.32
const BRAKE = 3.0 * 0.32

/** How late you may be before it stops being "on time", in seconds. */
export const ON_TIME_TOLERANCE = 6
/** Past this, the arrival counts as a real delay and the score notices. */
export const LATE_TOLERANCE = 15
/**
 * The most credit a run can bank. A train does not depart before its time, so
 * without a cap a good driver simply accumulates a two-minute lead over a lap
 * and the timetable stops meaning anything for the second half.
 */
export const CREDIT_CAP = 25

/**
 * The fastest a train can physically cover `distance` from a stand to a stand.
 *
 * The first version of this divided distance by a fraction of line speed,
 * which produced a timetable nobody could keep: an average 422-unit hop was
 * allowed 23 seconds when accelerating and braking through it cannot be done
 * in under 40. A schedule has to be built from the train's own capabilities,
 * not from a guess about average speed.
 */
export function minimumRunTime(distance: number, maxSpeed: number): number {
  // Distance used getting up to line speed and back down again.
  const dAccel = (maxSpeed * maxSpeed) / (2 * ACCEL)
  const dBrake = (maxSpeed * maxSpeed) / (2 * BRAKE)
  if (dAccel + dBrake <= distance) {
    // Long enough to cruise: accelerate, hold, brake.
    return maxSpeed / ACCEL + maxSpeed / BRAKE + (distance - dAccel - dBrake) / maxSpeed
  }
  // Too short to reach line speed: a triangular run, peaking partway.
  const peak = Math.sqrt(distance / (1 / (2 * ACCEL) + 1 / (2 * BRAKE)))
  return peak / ACCEL + peak / BRAKE
}

export class Schedule {
  level: ScheduleLevel = 'normal'
  /** Real seconds since the run began. */
  elapsed = 0
  /** Target run time for the segment leaving station i, in seconds. */
  private runTarget = new Float64Array(N)
  /** Scheduled arrival at station i, seconds from the start of the run. */
  private schedArrival = new Float64Array(N)
  /** Index of the station we are running toward. */
  private target = 1
  /** Seconds spent stopped at the current station. */
  private dwellElapsed = 0
  private stopped = false
  /** Delay recorded at the last arrival — what the toast reports. */
  lastArrivalDelay = 0
  /** Absorbs lead beyond CREDIT_CAP, so being early stays worth something without compounding. */
  private schedShift = 0

  constructor(track: Track, maxWorldSpeed: number, level: ScheduleLevel = 'normal') {
    this.level = level
    this.rebuild(track, maxWorldSpeed)
  }

  /**
   * Turns the ring's real geometry into run times: the physical minimum for
   * each segment, times the level's margin. The margin IS the difficulty.
   */
  rebuild(track: Track, maxWorldSpeed: number) {
    const len = track.getLength()
    const margin = SCHEDULE_LEVELS.find((l) => l.id === this.level)!.margin
    for (let i = 0; i < N; i++) {
      const a = track.markerFor(i).tFraction
      const b = track.markerFor((i + 1) % N).tFraction
      const segment = ((((b - a) % 1) + 1) % 1) * len
      this.runTarget[i] = minimumRunTime(segment, maxWorldSpeed) * margin
    }
    this.recomputeArrivals()
  }

  private recomputeArrivals() {
    let t = 0
    for (let i = 1; i <= N; i++) {
      t += this.runTarget[i - 1] + (i > 1 ? DWELL_ALLOWANCE : 0)
      this.schedArrival[i % N] = t
    }
  }

  setLevel(level: ScheduleLevel, track: Track, maxWorldSpeed: number) {
    this.level = level
    this.rebuild(track, maxWorldSpeed)
  }

  /** Restarts the clock — a fresh run, from station 0. */
  reset(target: number) {
    this.elapsed = 0
    this.target = target
    this.dwellElapsed = 0
    this.stopped = false
    this.lastArrivalDelay = 0
    this.schedShift = 0
  }

  update(dt: number, stopped: boolean) {
    this.elapsed += dt
    if (stopped) this.dwellElapsed += dt
    this.stopped = stopped
  }

  /**
   * Where the timetable says you should be right now, in seconds since the
   * start. While stopped it advances only for as long as the standard dwell
   * lasts: past that, every extra second of open doors is a second late.
   */
  private scheduledNow(segmentProgress: number): number {
    const prev = (this.target - 1 + N) % N
    if (this.stopped) return this.schedArrival[this.target] + Math.min(this.dwellElapsed, DWELL_ALLOWANCE)
    const departed = this.schedArrival[prev] + (this.target === 1 && this.elapsed < this.runTarget[0] ? 0 : DWELL_ALLOWANCE)
    return departed + this.runTarget[prev] * segmentProgress
  }

  /** Positive = late, negative = ahead of the timetable. */
  delay(segmentProgress: number): number {
    return this.elapsed - this.scheduledNow(segmentProgress) - this.schedShift
  }

  /** Called when the train comes to a stand at `station`. */
  arrive(station: number): number {
    this.target = station
    this.dwellElapsed = 0
    let delay = this.elapsed - this.schedArrival[station] - this.schedShift
    // Bank only up to the cap; the rest is given back to the timetable, the
    // way waiting at the platform for your booked departure gives it back.
    if (delay < -CREDIT_CAP) {
      this.schedShift += delay + CREDIT_CAP
      delay = -CREDIT_CAP
    }
    this.lastArrivalDelay = delay
    return delay
  }

  /** Called when the doors finish closing and the train is released. */
  depart(nextStation: number) {
    this.target = nextStation
    this.dwellElapsed = 0
  }

  /**
   * After a teleport: re-aim at the new target and absorb the whole
   * discontinuity into schedShift so the clock reads ON TIME at the landing
   * point — a jump is not a delay, and it is not two minutes of credit
   * either. (delay() = elapsed − scheduledNow − shift, so setting the shift
   * to the current raw delay zeroes it by construction.)
   */
  resync(target: number, segmentProgress: number) {
    this.target = target
    this.dwellElapsed = 0
    this.stopped = false
    this.schedShift = 0
    this.schedShift = this.delay(segmentProgress)
  }

  /** mm:ss with a sign, for the HUD. */
  static format(seconds: number): string {
    const sign = seconds < -1 ? '−' : seconds > 1 ? '+' : ''
    const abs = Math.abs(Math.round(seconds))
    const m = Math.floor(abs / 60)
    const s = abs % 60
    return `${sign}${m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`}`
  }
}
