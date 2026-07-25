import { STATIONS } from '../data/stations'

// ————————————————————————————————————————————————————————————————
// How many people are where. This is the simulation half of the passenger
// system, deliberately separate from the sprites: the platform can only show
// a couple of dozen bodies, but the line needs to know that Shinjuku at
// 08:30 has three hundred people waiting and your train has room for forty.
//
// The rules it encodes are the ones that make a train sim a JOB rather than
// a ride: a station you skip does not forgive you (its crowd keeps growing
// and the riders who wanted off are still aboard), and a full train cannot
// take everyone no matter how long you hold the doors.
// ————————————————————————————————————————————————————————————————

const N = STATIONS.length

/** Seats + standing room across the three cars. */
export const TRAIN_CAPACITY = 320

/**
 * How busy a station is relative to the line average. Built from what the
 * data already knows: the landmark hubs are the interchanges everyone piles
 * into, and the zone tier separates a downtown platform from a sleepy one.
 */
function stationWeight(i: number): number {
  const s = STATIONS[i]
  const tier = s.theme.tier === 'urban' ? 1.5 : s.theme.tier === 'mid' ? 1.0 : 0.55
  const hub = s.landmark ? 1.75 : 1
  const transfers = 1 + (s.transferLines?.length ?? 0) * 0.12
  return tier * hub * transfers
}

const WEIGHTS = Array.from({ length: N }, (_, i) => stationWeight(i))

/**
 * People per second arriving at an average platform at the peak of the rush.
 * Tuned against the real cadence of play: roughly 45 s between stops, so a
 * hub gathers about 50 in that time and a quiet stop about 19. That fills the
 * train over the first third of a rush-hour lap and leaves people behind at
 * the busiest hubs only — which is the drama. At 1.15 (the first guess) every
 * single platform stranded 300 people and the job stopped being winnable.
 */
const PEAK_ARRIVALS = 0.42

/** Rush-hour curve — the same shape the crowd sprites and boarding time use. */
export function rushFactor(hour: number): number {
  const proximity = (center: number, width: number) => Math.max(0, 1 - Math.abs(((hour - center + 36) % 24) - 12) / width)
  // Mornings are sharper than evenings; the small hours are nearly dead.
  const day = hour > 5 && hour < 24.5 ? 0.22 : 0.04
  return Math.min(1, day + Math.max(proximity(8.3, 3), proximity(18.2, 3.4) * 0.92))
}

export interface StopOutcome {
  alighted: number
  boarded: number
  /** Could not fit — they stay on the platform and they saw you leave. */
  leftBehind: number
  waitingAfter: number
  onboard: number
  full: boolean
}

export interface SkipOutcome {
  /** People on the platform who watched their train go by. */
  stranded: number
  /** Riders aboard who wanted this station and are now going round again. */
  carried: number
}

export class PassengerFlow {
  /** People waiting on each platform. */
  readonly waiting = new Float64Array(N)
  onboard = 0
  readonly capacity = TRAIN_CAPACITY
  /** Riders aboard, by the station they want. Lets a skip have a real victim. */
  private destinations = new Float64Array(N)

  constructor(hour = 7.5) {
    // Start the line already running rather than eerily empty.
    for (let i = 0; i < N; i++) this.waiting[i] = WEIGHTS[i] * rushFactor(hour) * 14 * (0.6 + Math.random() * 0.8)
  }

  get occupancy(): number {
    return this.onboard / this.capacity
  }

  /** Platform arrivals. Called every frame with the in-game clock. */
  update(dt: number, hour: number) {
    const rush = rushFactor(hour)
    for (let i = 0; i < N; i++) {
      this.waiting[i] += WEIGHTS[i] * rush * PEAK_ARRIVALS * dt
      // A platform saturates: past a point people take another line.
      if (this.waiting[i] > 420) this.waiting[i] = 420
    }
  }

  /** How many of the people aboard want off at `station`. */
  wantOff(station: number): number {
    return Math.min(this.onboard, Math.round(this.destinations[station]))
  }

  /**
   * What this stop WOULD move, without moving anybody. The transfer itself
   * happens person by person while the doors are open (see alight/board), so
   * that closing early genuinely leaves people behind instead of quietly
   * counting them as served.
   */
  planStop(station: number): { toAlight: number; toBoard: number } {
    const toAlight = this.wantOff(station)
    // Room is judged AFTER the alighters are out — that is the order the
    // doorway actually works in, and it is why holding the doors matters.
    const room = Math.max(0, this.capacity - (this.onboard - toAlight))
    return { toAlight, toBoard: Math.min(room, Math.round(this.waiting[station])) }
  }

  /** Moves `n` riders off the train here. Returns how many actually could. */
  alight(station: number, n: number): number {
    const moved = Math.max(0, Math.min(n, this.wantOff(station)))
    this.onboard -= moved
    this.destinations[station] = Math.max(0, this.destinations[station] - moved)
    return moved
  }

  /** Moves `n` people from this platform onto the train. Returns how many fitted. */
  board(station: number, n: number): number {
    const room = Math.max(0, this.capacity - this.onboard)
    const moved = Math.max(0, Math.min(n, Math.floor(this.waiting[station]), room))
    if (moved <= 0) return 0
    this.onboard += moved
    this.waiting[station] = Math.max(0, this.waiting[station] - moved)
    // Spread the new riders' destinations over the stations ahead, weighted
    // by how attractive each is — so hubs really do empty the train. Trip
    // length decays with a mean of ~5 stops: on a loop line most people ride
    // a handful of stations. A near-flat falloff (the first attempt) spread
    // every boarder over all 29 stations ahead, so only 3% of the train ever
    // got off anywhere and once it filled it never emptied again.
    let total = 0
    for (let k = 1; k < N; k++) total += WEIGHTS[(station + k) % N] * Math.exp(-k / 5)
    for (let k = 1; k < N; k++) {
      const idx = (station + k) % N
      this.destinations[idx] += (moved * WEIGHTS[idx] * Math.exp(-k / 5)) / total
    }
    return moved
  }

  /** Rolled through without stopping. Nobody gets what they wanted. */
  skip(station: number): SkipOutcome {
    const carried = this.wantOff(station)
    // Their trip just got longer: push them onto the next attractive stop so
    // they eventually leave rather than riding for ever.
    if (carried > 0) {
      this.destinations[station] = 0
      for (let k = 1; k <= 3; k++) this.destinations[(station + k) % N] += carried / 3
    }
    const stranded = Math.round(this.waiting[station])
    // The people left behind do not vanish — that IS the penalty. They pile
    // up for whoever comes next, which is you, one lap later.
    this.waiting[station] = Math.min(420, this.waiting[station] * 1.06 + 4)
    return { stranded, carried }
  }
}
