/**
 * The A/B probe's driving schedule: which station and which world (ring whole
 * or sectorised) each leg gets.
 *
 * This is a pure function in its own module because the first real run on the
 * phone (2026-07-30) was worthless as an A/B: legs picked BOTH the station and
 * the condition from `leg % 2`, so every sectors:off leg climbed to Kiyomizu
 * (~34 s, 485k triangles in view) and every sectors:on leg ran to Fushimi
 * Inari (~17 s, 178k). The two rows of the log compared two different rides,
 * not two worlds — the confound was invisible in the code and obvious in the
 * data.
 *
 * The cure is counterbalancing. Stations still alternate every leg (the old
 * protocol's rule: the destination roll must rebuild each jump). The condition
 * runs ABBA — off, on, on, off — so that over any four legs each station is
 * driven under each condition exactly once, and a linear drift (this phone
 * throttles as it heats) folds equally into both conditions.
 */
export interface ProbeLeg {
  /** Index into the probe's station list. */
  stationSlot: number
  sectorsOn: boolean
}

export function probeLegPlan(leg: number, stationCount: number): ProbeLeg {
  return {
    stationSlot: leg % stationCount,
    // 0,1,1,0 repeating: the (leg+1)>>1 pairs legs as (0), (1,2), (3,4), …
    // and alternating the PAIRS gives ABBA.
    sectorsOn: ((leg + 1) >> 1) % 2 === 1,
  }
}

export type CabProbeSegment = 'cab:first-half' | 'cab:second-half'

/**
 * Splits the long cabin run into two equal thermal windows. The names describe
 * time order only: whether the second half is actually hotter is what the
 * physical phone test must establish.
 */
export function cabProbeSegment(leg: number, totalLegs: number): CabProbeSegment {
  return leg < totalLegs / 2 ? 'cab:first-half' : 'cab:second-half'
}
