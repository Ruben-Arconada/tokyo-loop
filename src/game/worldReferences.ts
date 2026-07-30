import type { Season } from './Seasons'

// ————————————————————————————————————————————————————————————————
// The reference hashes the ring sectorisation has to reproduce.
//
// They live in the repo, next to the code that produces them, because the
// previous reference lived in a note and did not survive: `e7cdb9f8` was
// written down as "the" semantic hash of the default seed, and re-measuring
// it on the same commit with clean storage gave `851a0eed`. A number nobody
// can reproduce is worse than no number — it makes a refactor look verified.
//
// So this table is captured by a documented ritual (see CAPTURE_RECIPE) and
// compared by `__checkWorld()` rather than by eye.
//
// WHAT EACH ONE MEANS AFTER SECTORISING:
//   semantic   — MUST still match. It is blind to how instances are parcelled
//                into meshes, which is the only thing a sector split changes.
//   structural — WILL change, and that is correct: it answers "is the scene
//                built the same way?", and after sectorising it is not.
//
// All four seasons are here on purpose: a partition can preserve spring and
// still break the seasonal recolor, because the season pass rewrites twelve
// instance-colour buffers and it has to find its pools after the split.
// ————————————————————————————————————————————————————————————————

export interface SeasonReference {
  /** Partition-blind. The gate for any refactor that moves geometry between meshes. */
  semantic: string
  /** Partition-sensitive. Expected to change when the ring is sectorised. */
  structural: string
}

/**
 * Captured 2026-07-28 on the canonical scenario (default seed, clear, auto
 * fronts off) with only the season varied — every entry taken from one clean
 * `?canon` load, which is also what `__checkWorld()` does.
 *
 * Re-captured the same day when polylines joined the walk: the utility wires
 * and the bridge cables are `LineSegments`, which the traversal used to skip,
 * so the first table described the world minus its wires.
 *
 * Re-captured 2026-07-30 after the GROUNDING BATCH — a deliberate world
 * change in one sweep (Rubén's lap report + the full grounding audit):
 * · neon signs down to earth via groundHeightAt + a real pylon per banner
 *   (new group `neon-sign-poles`) — they hung at an absolute height until
 *   the night halos exposed them as levitating lights;
 * · Kobe tower and the Kanazawa spire read the rolling relief instead of a
 *   flat-earth −0.58 (the noise swings ±11.5/±14 out there);
 * · platform slabs grew a 0.6 foundation (they ended at rail height, a
 *   ribbon of daylight under all 30 platforms);
 * · the platform map board became a floor-standing totem (it hovered 0.85
 *   over the slab with no leg).
 * Same recipe, all four seasons re-taken in one clean `?canon` load.
 */
export const WORLD_REFERENCES: Record<Season, SeasonReference> = {
  spring: { semantic: '6c6e4064', structural: '81ecf986' },
  summer: { semantic: 'cf3482df', structural: '2e199c1f' },
  autumn: { semantic: '7562d812', structural: 'f5f712ff' },
  winter: { semantic: 'cc6fdcb6', structural: 'de5a5ecc' },
}

// ————————————————————————————————————————————————————————————————
// WHAT THESE HASHES DO NOT COVER — read before quoting them as "same world".
//
// 1. Only `Mesh`, `Points` and `Line` are walked. `Sprite` is not: the sun and
//    the moon are the only ones, they are repositioned every frame from the
//    clock, and they carry `userData.dynamic` to say so deliberately rather
//    than by omission. Anything else drawable that gets added later is
//    invisible here until this walk learns about it.
// 2. A `Points` or `Line` mesh is digested as ONE record holding its whole
//    buffer, unlike instances which are flattened individually. That is fine
//    while each of them is a single object — and it stops being fine the day
//    stars, petals or the catenary get split across sectors, because the
//    partition would then change the record. Flatten them like the instances
//    before sectorising any of those.
//
// So the guarantee the ring sectorisation may lean on is precise: INSTANCED
// POOLS can be repartitioned freely and the semantic hash will hold. It is not
// a blanket "the whole world is verified".
// ————————————————————————————————————————————————————————————————

export const CAPTURE_RECIPE =
  'Carga limpia con ?canon en dev y ejecuta __checkWorld() en la consola. ' +
  'Para RE-capturar tras un cambio deliberado del mundo, copia la tabla que imprime en worldReferences.ts.'

export interface ReferenceResult {
  season: Season
  semantic: string
  structural: string
  /** The one that must hold across a partition change. */
  semanticOk: boolean
  /** Informational: false after sectorising is expected, not a failure. */
  structuralOk: boolean
}

export function compareToReference(season: Season, semantic: string, structural: string): ReferenceResult {
  const ref = WORLD_REFERENCES[season]
  return {
    season,
    semantic,
    structural,
    semanticOk: semantic === ref.semantic,
    structuralOk: structural === ref.structural,
  }
}

/** Human-readable verdict — the line that says whether a refactor kept the world. */
export function summariseReferences(results: ReferenceResult[]): string {
  const broken = results.filter((r) => !r.semanticOk)
  const restructured = results.filter((r) => r.semanticOk && !r.structuralOk)
  if (broken.length) {
    return `❌ EL MUNDO CAMBIÓ en ${broken.map((r) => r.season).join(', ')} — el hash semántico no coincide con la referencia.`
  }
  if (restructured.length) {
    return `✅ Mismo mundo, construido distinto (${restructured.map((r) => r.season).join(', ')}): es lo que se espera tras sectorizar. Re-captura el estructural cuando el refactor esté cerrado.`
  }
  return '✅ Idéntico a la referencia en las cuatro estaciones, semántico y estructural.'
}
