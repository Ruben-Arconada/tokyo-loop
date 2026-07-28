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
 */
export const WORLD_REFERENCES: Record<Season, SeasonReference> = {
  spring: { semantic: 'e780b8bf', structural: '7a4c4cc7' },
  summer: { semantic: '0f26584e', structural: '3f3d95ce' },
  autumn: { semantic: '1f5dabb7', structural: '17ea9252' },
  winter: { semantic: '3c23d813', structural: 'c6220415' },
}

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
