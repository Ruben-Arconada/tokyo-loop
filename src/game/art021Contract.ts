/**
 * Pure, Node-testable contract for the 0.2.1 visual slice.
 *
 * The builders call these guards with their REAL post-merge reports. Keeping
 * the thresholds here lets the native test runner mutate pass/fail cases
 * without importing Three, Track or a browser scene.
 */

export const ART021_STATIONS = [2, 3] as const
export const ART021_MODEL_LOD_DISTANCE = 108

export const ART021_BUDGET = {
  staticDrawsDay: 10,
  staticDrawsWinter: 12,
  staticTriangles: 50_000,
  hybridDraws: 6,
  hybridTriangles: 10_000,
  hybridFigures: 26,
} as const

export interface Art021StaticReport {
  stations: readonly string[]
  meshes: number
  triangles: number
  designDrawsDay: number
  designDrawsWinter: number
}

export interface Art021HybridReport {
  figures: number
  draws: number
  triangles: number
  stations: readonly number[]
}

/** Pure twin of the runtime LOD decision, kept here so the mobile contract can mutate it in Node. */
export function art021ModelMask(distance0Squared: number, distance1Squared: number) {
  const limit = ART021_MODEL_LOD_DISTANCE * ART021_MODEL_LOD_DISTANCE
  let mask = 0
  if (distance0Squared <= limit) mask |= 1
  if (distance1Squared <= limit) mask |= 2
  return mask
}

export function assertStaticArtBudget(report: Art021StaticReport) {
  if (report.designDrawsDay > ART021_BUDGET.staticDrawsDay) {
    throw new Error(`ArtPass021: ${report.designDrawsDay} draws de día > ${ART021_BUDGET.staticDrawsDay}`)
  }
  if (report.designDrawsWinter > ART021_BUDGET.staticDrawsWinter) {
    throw new Error(`ArtPass021: ${report.designDrawsWinter} draws en invierno > ${ART021_BUDGET.staticDrawsWinter}`)
  }
  if (report.triangles > ART021_BUDGET.staticTriangles) {
    throw new Error(`ArtPass021: ${report.triangles} triángulos > ${ART021_BUDGET.staticTriangles}`)
  }
}

export function assertHybridArtBudget(report: Art021HybridReport) {
  if (report.figures !== ART021_BUDGET.hybridFigures) {
    throw new Error(`HybridPassengers021: ${report.figures} figuras != ${ART021_BUDGET.hybridFigures}`)
  }
  if (report.draws > ART021_BUDGET.hybridDraws) {
    throw new Error(`HybridPassengers021: ${report.draws} draws > ${ART021_BUDGET.hybridDraws}`)
  }
  if (report.triangles > ART021_BUDGET.hybridTriangles) {
    throw new Error(`HybridPassengers021: ${report.triangles} triángulos > ${ART021_BUDGET.hybridTriangles}`)
  }
}
