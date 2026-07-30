/**
 * Per-district atmosphere — the thing that makes Shirakawa-gō FEEL different
 * from Dōtonbori even before you look at the buildings.
 *
 * The structural contrast (building heights, houses, neon — see
 * docs/DIRECCION-ARTE.md) was already in; what was flat is the AIR. Every
 * district now owns a modest fog tint, a fog density, and a light bias, and
 * the blend follows the train around the ring so zones hand over to each
 * other gradually instead of at an invisible property line.
 *
 * Pure data + math on purpose: no three.js import, colours are plain {r,g,b}
 * in 0..1, and the sampler is allocation-free — Game applies the result to
 * scene.fog / lights AFTER DayNightCycle writes its frame values and BEFORE
 * the tunnel override, so day cycle, overcast and tunnel all keep their
 * authority. Everything here is DYNAMIC state: the static world and its
 * fingerprints are untouched.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

export interface ZoneProfile {
  /** Fog is tinted toward this by day… */
  fogTintDay: RGB
  /** …and toward this at night (urban nights glow, quiet nights go truly dark). */
  fogTintNight: RGB
  /** How hard the tint pulls BY DAY. Kept low: weather stays the boss. */
  fogTintW: number
  /**
   * …and after dark. Split (round 2, Aiko/Yui): the daytime tower districts
   * needed a harder push, but their nights were already right.
   */
  fogTintWNight: number
  /** Fog distance multipliers — smog closes in, sea air opens up. */
  fogNearMul: number
  fogFarMul: number
  /** Hemisphere light tint (the bounce light of the district). */
  hemiTint: RGB
  hemiW: number
  /** Direct sun tint — barely-there warmth or steel. */
  sunTint: RGB
  sunW: number
}

/** A station on the ring: where it sits and whose air it breathes. */
export interface AmbienceStop {
  tFraction: number
  district: string
}

/**
 * CONTRACT (Diego, round 3): this sampler — profiles AND `urbanity` — is THE
 * source of truth for "which zone is the train in" given a progressFraction.
 * The next chat's per-zone audio must consume it rather than growing a third
 * hand-rolled segmentation (the sea already keeps a parallel BAY_T0/T1 pair
 * in Game.ts; that one predates this and should eventually fold in too).
 */
const DISTRICT_URBANITY: Record<string, number> = {
  shitamachi: 0,
  green: 0,
  business: 0.5,
  bay: 0.5,
  downtown: 1,
  youth: 1,
}

export function rgb(hex: number): RGB {
  return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 }
}

/**
 * One profile per district in src/data/stations.ts. Ranges are deliberately
 * timid (tints ≤0.3, density ±15%): the zone should colour the mood, not
 * fight the hour, the season or the storm.
 */
export const DISTRICT_AMBIENCE: Record<string, ZoneProfile> = {
  // Warm wood and paper lanterns — the air leans gold, evenings glow ember.
  shitamachi: {
    fogTintDay: rgb(0xd8bd92),
    fogTintNight: rgb(0x2c2118),
    fogTintW: 0.26,
    fogTintWNight: 0.26,
    fogNearMul: 0.96,
    fogFarMul: 0.98,
    hemiTint: rgb(0xffe2b8),
    hemiW: 0.2,
    sunTint: rgb(0xffd9a8),
    sunW: 0.16,
  },
  // Parks and hills — a fresh green mist that sits a little closer.
  green: {
    fogTintDay: rgb(0xc2dcc9),
    fogTintNight: rgb(0x111a15),
    fogTintW: 0.24,
    fogTintWNight: 0.24,
    fogNearMul: 1.04,
    fogFarMul: 1.0,
    hemiTint: rgb(0xd6ecd2),
    hemiW: 0.18,
    sunTint: rgb(0xfff3d9),
    sunW: 0.1,
  },
  // Office steel — clean, cool, slightly farther horizon.
  business: {
    fogTintDay: rgb(0xaebccb),
    fogTintNight: rgb(0x131a26),
    fogTintW: 0.18,
    fogTintWNight: 0.18,
    fogNearMul: 1.08,
    fogFarMul: 1.05,
    hemiTint: rgb(0xc8d6ea),
    hemiW: 0.14,
    sunTint: rgb(0xf2f5ff),
    sunW: 0.1,
  },
  // Open water — marine light, the clearest air on the ring.
  bay: {
    fogTintDay: rgb(0xc4e4ea),
    fogTintNight: rgb(0x0f1822),
    fogTintW: 0.3,
    fogTintWNight: 0.3,
    fogNearMul: 1.14,
    fogFarMul: 1.12,
    hemiTint: rgb(0xc9e9f2),
    hemiW: 0.2,
    sunTint: rgb(0xfff6e6),
    sunW: 0.1,
  },
  // Dense downtown — warm smog by day, magenta-amber neon air after dark.
  // (Round 1: Yui and Aiko found downtown and youth nights near-twins; the
  // night tints now sit ~40 units apart per channel instead of ~6.)
  downtown: {
    fogTintDay: rgb(0xc9aca6),
    fogTintNight: rgb(0x33161f),
    fogTintW: 0.36,
    fogTintWNight: 0.3,
    fogNearMul: 0.87,
    fogFarMul: 0.9,
    hemiTint: rgb(0xe8c8c2),
    hemiW: 0.16,
    sunTint: rgb(0xffe3c8),
    sunW: 0.12,
  },
  // Youth quarter — violet haze by day (a point more lilac since round 3,
  // Yui: the daytime tower pair needed one more step apart), blue-violet
  // after dark.
  youth: {
    fogTintDay: rgb(0xbfa8dc),
    fogTintNight: rgb(0x1e1038),
    fogTintW: 0.33,
    fogTintWNight: 0.28,
    fogNearMul: 0.92,
    fogFarMul: 0.94,
    hemiTint: rgb(0xdcc8ec),
    hemiW: 0.16,
    sunTint: rgb(0xffe8d8),
    sunW: 0.1,
  },
}

const FALLBACK: ZoneProfile = DISTRICT_AMBIENCE.business

/** The sampler's output — one resolved profile, reused every frame. */
export interface BlendedAmbience {
  fogTintDay: RGB
  fogTintNight: RGB
  fogTintW: number
  fogTintWNight: number
  fogNearMul: number
  fogFarMul: number
  hemiTint: RGB
  hemiW: number
  sunTint: RGB
  sunW: number
  /** 0 = countryside, 0.5 = mid-rise, 1 = tower canyon — crossfaded like the rest. */
  urbanity: number
}

function makeBlended(): BlendedAmbience {
  return {
    fogTintDay: { r: 0, g: 0, b: 0 },
    fogTintNight: { r: 0, g: 0, b: 0 },
    fogTintW: 0,
    fogTintWNight: 0,
    fogNearMul: 1,
    fogFarMul: 1,
    hemiTint: { r: 0, g: 0, b: 0 },
    hemiW: 0,
    sunTint: { r: 0, g: 0, b: 0 },
    sunW: 0,
    urbanity: 0,
  }
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u
}

function lerpRgb(out: RGB, a: RGB, b: RGB, u: number) {
  out.r = lerp(a.r, b.r, u)
  out.g = lerp(a.g, b.g, u)
  out.b = lerp(a.b, b.b, u)
}

/**
 * Hold each station's identity around its platform and cross-fade through the
 * middle of the gap: flat for the first fifth, flat for the last fifth,
 * smoothstep between. A ride reads as "leaving Nara's air… entering Kōyasan's".
 */
function crossfade(u: number) {
  const x = Math.min(1, Math.max(0, (u - 0.2) / 0.6))
  return x * x * (3 - 2 * x)
}

/**
 * Samples the ring's air at track fraction t. Stops must be sorted by
 * tFraction ascending (they are: station markers). Allocation-free after
 * construction.
 */
export class AmbienceTrack {
  private readonly stops: AmbienceStop[]
  private readonly profiles: ZoneProfile[]
  private readonly out = makeBlended()

  private readonly urbanities: number[]

  constructor(stops: AmbienceStop[]) {
    this.stops = stops
    this.profiles = stops.map((s) => DISTRICT_AMBIENCE[s.district] ?? FALLBACK)
    this.urbanities = stops.map((s) => DISTRICT_URBANITY[s.district] ?? 0.5)
  }

  sample(t: number): BlendedAmbience {
    const n = this.stops.length
    const out = this.out
    if (n === 0) return out
    const tt = ((t % 1) + 1) % 1
    // Find the segment [i, i+1) that contains tt, wrapping at the seam.
    let i = n - 1
    for (let k = 0; k < n; k++) {
      if (this.stops[k].tFraction > tt) {
        i = k - 1
        break
      }
    }
    if (i < 0) i = n - 1
    const j = (i + 1) % n
    const ti = this.stops[i].tFraction
    let tj = this.stops[j].tFraction
    let x = tt
    if (tj <= ti) {
      // Seam segment: unwrap.
      tj += 1
      if (x < ti) x += 1
    }
    const span = tj - ti
    const u = span > 1e-9 ? crossfade((x - ti) / span) : 0
    const a = this.profiles[i]
    const b = this.profiles[j]
    lerpRgb(out.fogTintDay, a.fogTintDay, b.fogTintDay, u)
    lerpRgb(out.fogTintNight, a.fogTintNight, b.fogTintNight, u)
    out.fogTintW = lerp(a.fogTintW, b.fogTintW, u)
    out.fogTintWNight = lerp(a.fogTintWNight, b.fogTintWNight, u)
    out.fogNearMul = lerp(a.fogNearMul, b.fogNearMul, u)
    out.fogFarMul = lerp(a.fogFarMul, b.fogFarMul, u)
    lerpRgb(out.hemiTint, a.hemiTint, b.hemiTint, u)
    out.hemiW = lerp(a.hemiW, b.hemiW, u)
    lerpRgb(out.sunTint, a.sunTint, b.sunTint, u)
    out.sunW = lerp(a.sunW, b.sunW, u)
    out.urbanity = lerp(this.urbanities[i], this.urbanities[j], u)
    return out
  }
}
