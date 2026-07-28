// ————————————————————————————————————————————————————————————————
// Deterministic world generation.
//
// The world used to be built from Math.random(), so every reload dealt a
// different Japan. That made two things impossible: comparing a performance
// lap against another (different world, different draw counts) and comparing
// two screenshots of the same place after a change. Now the static world
// comes from a named seed, and each SYSTEM draws from its own stream.
//
// Independent streams are the important half. With one global sequence, adding
// a single random call anywhere would shift every later draw and reshuffle the
// entire world — which already bit us: moving the canopy finalize() to the end
// of Scenery's constructor would have re-dealt the city, the houses and the
// signs. With per-system streams, touching the vegetation cannot move a
// building.
//
// NOT covered here on purpose: anything that varies DURING play (weather
// fronts, passenger flow, audio grain, windshield drops). Those are dynamic
// systems and only need seeding if we ever want to replay whole runs.
// ————————————————————————————————————————————————————————————————

/** The world everyone gets unless they ask for another one. */
export const DEFAULT_WORLD_SEED = 'japan-loop-0.5-world-1'

/**
 * `?seed=whatever` deals a different Japan — for comparing worlds, or for
 * hunting a bug that only shows up in one layout. Absent, everyone is on the
 * same world, which is what makes two perf laps comparable.
 */
export const WORLD_SEED: string = (() => {
  const fromUrl = new URLSearchParams(window.location.search).get('seed')
  return fromUrl && fromUrl.trim() ? fromUrl.trim() : DEFAULT_WORLD_SEED
})()

/** FNV-1a: fast, dependency-free, and spreads similar strings ('city' vs 'city2') far apart. */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * mulberry32 — small, fast, and good enough for scattering trees. Was
 * copy-pasted in two places (the blossom atlas and the station melodies);
 * both now import this one.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A named draw sequence for one system, derived from the world seed. Two
 * systems never share a stream, so their draw counts stay independent.
 *
 * ```ts
 * private rnd = worldStream('vegetation')
 * const scale = 0.8 + this.rnd() * 0.7
 * ```
 */
export function worldStream(name: WorldStream): () => number {
  // Two callers asking for the same name get the SAME sequence, which is the
  // subtlest way to break this design: the systems look independent and their
  // numbers march in lockstep. It happened twice before this guard existed
  // ('city' between Scenery and City; 'sky' and 'canopy' between Scenery and
  // its neighbours), so the mistake is now loud instead of invisible.
  if (import.meta.env.DEV) {
    if (claimedStreams.has(name)) {
      console.error(
        `[Rng] El flujo '${name}' ya estaba pedido por otro módulo. Dos consumidores del mismo nombre sortean LOS MISMOS números: dale un nombre propio en WorldStream.`,
      )
    }
    claimedStreams.add(name)
  }
  return mulberry32(hashString(`${WORLD_SEED}::${name}`))
}

/** Names handed out so far — dev-only bookkeeping for the guard above. */
const claimedStreams = new Set<string>()

// Hot reload re-executes a consumer module, which re-claims its stream while
// this registry survives — so every edit made the guard cry wolf about names
// that are perfectly unique. Forgetting the claims before each hot update
// keeps the warning meaningful: after an edit the modules simply claim again
// from a clean slate, and only a REAL duplicate still shows up.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => claimedStreams.clear())
}

/**
 * Every stream in the static world. Named as a union so a typo is a compile
 * error rather than a silently different world — and so this list doubles as
 * the map of what the seed actually controls.
 */
export type WorldStream =
  | 'terrain' // distant ranges, ground relief, mountain road
  | 'city' // City.ts: the blocks and platforms around each station
  | 'skyline' // Scenery.ts: the distant tower belt — its OWN stream, or it
  //            would draw the exact same numbers as 'city' and correlate
  | 'houses' // the shitamachi rows
  | 'vegetation' // pines, scrub, the hill's wood
  | 'canopy' // SakuraCanopy.ts: the blossom cards and the fallen-petal carpet
  | 'petals' // Scenery.ts: the drifting petal cloud — its OWN stream
  | 'signage' // neon, boards, textures baked at build time
  | 'trackside' // sleepers, poles, crossings, station furniture
  | 'coast' // sea, sand, boats, the island
  | 'tunnel' // the bore's concrete grime
  | 'sky' // DayNightCycle.ts: the star field
  | 'clouds' // Scenery.ts: the cloud slabs — its OWN stream

/**
 * A seeded stand-in for `Math.random` that also carries the small helpers the
 * builders kept re-deriving by hand.
 */
export class Rng {
  private next: () => number

  constructor(stream: WorldStream) {
    this.next = worldStream(stream)
  }

  /** 0..1, like Math.random(). */
  random(): number {
    return this.next()
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Symmetric around zero: ±amount. */
  spread(amount: number): number {
    return (this.next() - 0.5) * 2 * amount
  }

  /** Integer in [0, count). */
  int(count: number): number {
    return Math.floor(this.next() * count)
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** One of them. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }
}
