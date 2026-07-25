import * as THREE from 'three'

// ————————————————————————————————————————————————————————————————
// The four seasons, selectable from the HUD like the time of day. A season
// is a one-off recolor pass over everything organic (instanceColor buffers
// and terrain vertex colors), not a per-frame cost: pools register their
// as-built base colors once, and applySeason() maps base → seasonal.
// Yui photographed all thirty platforms in all four seasons for exactly
// this reference — spring stays the baseline the game shipped with.
// ————————————————————————————————————————————————————————————————

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASONS: { id: Season; label: string; icon: string }[] = [
  { id: 'spring', label: 'Primavera', icon: '🌸' },
  { id: 'summer', label: 'Verano', icon: '🌿' },
  { id: 'autumn', label: 'Otoño', icon: '🍁' },
  { id: 'winter', label: 'Invierno', icon: '⛄' },
]

/**
 * What a registered color pool contains, ecologically — the season decides
 * what each kind does (broadleaf turns momiji in autumn, pines just deepen,
 * roofs take snow in winter…).
 */
export type FoliageKind =
  | 'broadleaf' // deciduous canopies: green → deep green → momiji → bare
  | 'pine' // evergreen: subtle shifts only
  | 'scrub' // ground bushes/tufts: green → straw → frosted
  | 'sakura' // cherry canopies: bloom → leaf → amber → bare
  | 'sakuraEver' // the Komagome grove: in bloom all year (Rubén's garden)
  | 'roof' // house roofs: untouched until winter snow-caps them
  | 'terrain' // ground/embankment vertex colors: the big green wash
  | 'mountain' // distant ranges: the horizon must vote with the season too

// Scratch objects so recolor passes allocate nothing.
const src = new THREE.Color()
const out = new THREE.Color()
const hsl = { h: 0, s: 0, l: 0 }

/** Deterministic 0..1 hash per instance so a season paints each tree its own note (no Math.random at apply time — reapplying must be stable). */
function noise01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Maps one base color to its seasonal version. `i` is the instance index
 * (feeds the per-instance variation), base is the as-built spring color.
 */
export function seasonalColor(kind: FoliageKind, season: Season, i: number, r: number, g: number, b: number): THREE.Color {
  src.setRGB(r, g, b)
  out.copy(src)
  const n = noise01(i)
  switch (kind) {
    case 'pine':
      if (season === 'summer') out.lerp(DEEP_PINE, 0.3)
      else if (season === 'autumn') out.lerp(DRY_PINE, 0.18)
      else if (season === 'winter') out.lerp(WINTER_PINE, 0.42)
      break
    case 'broadleaf':
      if (season === 'summer') out.lerp(DEEP_GREEN, 0.4)
      else if (season === 'autumn') {
        // Momiji spread: every canopy lands somewhere on the red→orange→gold
        // arc, seeded per instance so the hillside reads as a real koyo mix.
        src.getHSL(hsl)
        out.setHSL(0.02 + n * 0.09, 0.72, 0.3 + hsl.l * 0.35)
      } else if (season === 'winter') {
        src.getHSL(hsl)
        out.setHSL(0.07, 0.16, 0.16 + hsl.l * 0.28)
      }
      break
    case 'scrub':
      if (season === 'summer') out.lerp(DEEP_GREEN, 0.3)
      else if (season === 'autumn') out.lerp(STRAW, 0.55 + n * 0.2)
      else if (season === 'winter') out.lerp(FROST_SCRUB, 0.78).multiplyScalar(1.15)
      break
    case 'sakura':
      if (season === 'summer') {
        src.getHSL(hsl)
        out.setHSL(0.3 + n * 0.05, 0.38, 0.3 + hsl.l * 0.2)
      } else if (season === 'autumn') {
        src.getHSL(hsl)
        out.setHSL(0.055 + n * 0.04, 0.6, 0.42 + hsl.l * 0.15)
      } else if (season === 'winter') {
        out.setHSL(0.06, 0.1, 0.24 + n * 0.08)
      }
      break
    case 'sakuraEver':
      // Full bloom in all four seasons — in autumn especially, per Rubén:
      // the hill station's little miracle garden.
      break
    case 'roof':
      // Overdriven like the terrain: roof tints multiply a ~0.5-luma tile
      // texture, and without the push the "snow" read as slate (three
      // judges flagged it from the winter captures).
      if (season === 'winter') out.lerp(SNOW_WHITE, 0.82).multiplyScalar(1.7)
      break
    case 'terrain':
      // Vertex colors may exceed 1: overdrive lifts each season through the
      // dark ground texture it multiplies against — without it, autumn gold
      // and winter frost both drowned in olive (the panel's #1 complaint).
      // The ground texture sits at ~0.3 luma, so the gains must be large to
      // read: winter has to reach snow-white THROUGH it (0.9·2.7·0.3 ≈ 0.7).
      if (season === 'spring') out.lerp(FRESH_GREEN, 0.15).multiplyScalar(1.08)
      else if (season === 'summer') out.lerp(DEEP_GREEN, 0.22).multiplyScalar(1.05)
      else if (season === 'autumn') out.lerp(STRAW, 0.55).multiplyScalar(1.85)
      else out.lerp(FROST_GROUND, 0.75).multiplyScalar(2.7)
      break
    case 'mountain':
      if (season === 'summer') out.lerp(DEEP_PINE, 0.3)
      else if (season === 'autumn') out.lerp(OCHRE_RANGE, 0.55)
      else if (season === 'winter') out.lerp(SNOW_RANGE, 0.6).multiplyScalar(1.2)
      break
  }
  return out
}

const DEEP_GREEN = new THREE.Color(0x1f6b2e)
const FRESH_GREEN = new THREE.Color(0x9fd487)
const OCHRE_RANGE = new THREE.Color(0x8a5a35)
const SNOW_RANGE = new THREE.Color(0xe8eef2)
const DEEP_PINE = new THREE.Color(0x17472a)
const DRY_PINE = new THREE.Color(0x3d4a26)
const WINTER_PINE = new THREE.Color(0x2a3d38)
const STRAW = new THREE.Color(0xc9a85c)
const FROST_SCRUB = new THREE.Color(0x9aa5a3)
const FROST_GROUND = new THREE.Color(0xdfe6ea)
const SNOW_WHITE = new THREE.Color(0xf2f5f8)

/** One registered recolor target: an instanced pool, a plain vertex-color attribute, or an instance RANGE within one (two kinds can share a mesh). */
export interface SeasonalPool {
  kind: FoliageKind
  attribute: THREE.InstancedBufferAttribute | THREE.BufferAttribute
  /** As-built (spring) colors for the covered range, captured at registration. */
  base: Float32Array
  /** First color index covered (instance/vertex, not float offset). */
  start: number
  count: number
}

/** Captures the current colors of an attribute (or a sub-range of it) as the spring baseline and returns the pool handle. */
export function registerPool(
  kind: FoliageKind,
  attribute: THREE.InstancedBufferAttribute | THREE.BufferAttribute,
  start = 0,
  count = (attribute.array as Float32Array).length / 3 - start,
): SeasonalPool {
  const base = new Float32Array((attribute.array as Float32Array).subarray(start * 3, (start + count) * 3))
  return { kind, attribute, base, start, count }
}

/** Rewrites one pool's colors for `season`. Cheap (a few thousand HSL ops) and only runs on season change. */
export function applySeasonToPool(pool: SeasonalPool, season: Season) {
  const arr = pool.attribute.array as Float32Array
  for (let i = 0; i < pool.count; i++) {
    const c = seasonalColor(pool.kind, season, pool.start + i, pool.base[i * 3], pool.base[i * 3 + 1], pool.base[i * 3 + 2])
    const o = (pool.start + i) * 3
    arr[o] = c.r
    arr[o + 1] = c.g
    arr[o + 2] = c.b
  }
  pool.attribute.needsUpdate = true
}

// ————————————————————————————————————————————————————————————————
// Weather — a second, independent axis. Precipitation becomes snow when the
// season is winter (one particle system, two costumes), so the same four
// options read as rain/storm in three seasons and nevada/ventisca in winter.
// ————————————————————————————————————————————————————————————————

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm'

export interface WeatherOption {
  id: Weather
  label: string
  icon: string
  /** Winter wears the same state under another name — "Lluvia" in January would be a lie. */
  winterLabel?: string
  winterIcon?: string
}

export const WEATHERS: WeatherOption[] = [
  { id: 'clear', label: 'Despejado', icon: '☀️' },
  { id: 'cloudy', label: 'Nublado', icon: '☁️' },
  { id: 'rain', label: 'Lluvia', icon: '🌧️', winterLabel: 'Nieve', winterIcon: '🌨️' },
  { id: 'storm', label: 'Tormenta', icon: '⛈️', winterLabel: 'Ventisca', winterIcon: '❄️' },
]

/** The label/icon a weather wears in a given season (winter renames rain → nieve, tormenta → ventisca). */
export function weatherFace(weather: Weather, season: Season): { label: string; icon: string } {
  const w = WEATHERS.find((x) => x.id === weather)!
  const winter = season === 'winter'
  return { label: (winter && w.winterLabel) || w.label, icon: (winter && w.winterIcon) || w.icon }
}

/** How overcast the sky should aim to be for a weather state (DayNightCycle lerps toward it). */
export function overcastTarget(weather: Weather): number {
  return weather === 'clear' ? 0 : weather === 'cloudy' ? 0.7 : weather === 'rain' ? 1 : 1.15
}

// ————————————————————————————————————————————————————————————————
// Rain phases by the clock. Rather than multiplying the menu with
// drizzle/shower/downpour entries, the SAME rain breathes over the day the
// way Tokyo's actually does: soft and steady at dawn, building through the
// afternoon into the convective peak, easing off overnight.
// ————————————————————————————————————————————————————————————————

/** 0.62 (pre-dawn drizzle) … 1 (late-afternoon peak) — the hour's weight on any falling weather. */
export function rainPhase01(hour: number): number {
  return 0.62 + 0.38 * (0.5 - 0.5 * Math.cos((((hour - 4 + 24) % 24) / 24) * Math.PI * 2))
}

/** What that phase is called right now — shown under the weather picker so the hour's effect is legible, not a secret. */
export function rainPhaseLabel(weather: Weather, season: Season, hour: number): string {
  if (weather !== 'rain' && weather !== 'storm') return ''
  const p = rainPhase01(hour)
  if (season === 'winter') {
    if (weather === 'storm') return 'Ventisca cerrada'
    return p < 0.75 ? 'Nevada fina' : p < 0.9 ? 'Nevada' : 'Nevada copiosa'
  }
  if (weather === 'storm') return p < 0.8 ? 'Tormenta lejana' : 'Tormenta encima'
  return p < 0.75 ? 'Chirimiri' : p < 0.9 ? 'Lluvia constante' : 'Aguacero'
}

/**
 * Everything the precipitation curtain needs for one frame. Written into a
 * scratch object — this is read every frame (the hour moves continuously),
 * so it must not allocate.
 */
export interface PrecipProfile {
  /** Is anything falling at all. */
  falling: boolean
  /** Dressed as snow (winter) rather than rain. */
  snow: boolean
  /** 0..1 fraction of the curtain's instances kept alive — the "how hard it's coming down" dial. */
  density: number
  /** Lateral gust in world units/s: 0 = it falls straight down even at a standstill. */
  wind: number
  /** Multiplier over the base fall speed. */
  fallScale: number
  /** Rain bed level for the audio engine. */
  audioLevel: number
  /** Wind bed level — the voice a storm has beyond its rain, and the ONLY voice a blizzard has. */
  windAudio: number
}

const PROFILE: PrecipProfile = { falling: false, snow: false, density: 0, wind: 0, fallScale: 1, audioLevel: 0, windAudio: 0 }

export function precipProfile(weather: Weather, season: Season, hour: number): PrecipProfile {
  const snow = season === 'winter'
  const falling = weather === 'rain' || weather === 'storm'
  const phase = rainPhase01(hour)
  PROFILE.falling = falling
  PROFILE.snow = snow
  if (!falling) {
    PROFILE.density = 0
    PROFILE.wind = 0
    PROFILE.fallScale = 1
    PROFILE.audioLevel = 0
    PROFILE.windAudio = 0
    return PROFILE
  }
  const storm = weather === 'storm'
  // Storm always comes down hard; plain rain lets the hour decide.
  PROFILE.density = storm ? 0.85 + 0.15 * phase : 0.4 + 0.42 * phase
  // A storm blows sideways on its own; ordinary rain only slants because the
  // train is moving through it.
  PROFILE.wind = storm ? (snow ? 11 : 8.5) * (0.75 + 0.25 * phase) : 0
  PROFILE.fallScale = storm ? 1.35 : 0.85 + 0.25 * phase
  // Snowfall is nearly SILENT — a low breath of wind, no patter bed.
  PROFILE.audioLevel = snow ? (storm ? 0.4 : 0.12) : storm ? 1 : 0.55 + 0.35 * phase
  // A ventisca is almost pure wind (its snow makes no sound of its own); a
  // rain storm gets wind UNDER the rain, not instead of it.
  PROFILE.windAudio = storm ? (snow ? 0.95 : 0.5) * (0.8 + 0.2 * phase) : 0
  return PROFILE
}
