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
 */
export const WORLD_REFERENCES: Record<Season, SeasonReference> = {
  spring: { semantic: '494d8caa', structural: 'dfce1556' },
  summer: { semantic: '5cd79b31', structural: '087e9d3f' },
  autumn: { semantic: 'fe5b2886', structural: 'ddeaf5c7' },
  winter: { semantic: '312b1646', structural: '1346d80c' },
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
