/** Pure, Node-testable budget for the 0.2.3 Nara green vertical slice. */

export const ART023_STATIONS = [3, 4] as const

export const ART023_BUDGET = {
  drawsDay: 3,
  drawsWinter: 4,
  triangles: 12_000,
  textures: 0,
  lights: 0,
} as const

export interface Art023Report {
  family: 'green'
  stations: readonly string[]
  meshes: number
  triangles: number
  designDrawsDay: number
  designDrawsWinter: number
  textures: number
  lights: number
  /** The old Nara landmark used twenty individual meshes; 0.2.3 replaces it. */
  legacyMeshesReplaced: number
}

export function assertArt023Budget(report: Art023Report) {
  if (report.designDrawsDay > ART023_BUDGET.drawsDay) {
    throw new Error(`ArtPass023: ${report.designDrawsDay} draws de día > ${ART023_BUDGET.drawsDay}`)
  }
  if (report.designDrawsWinter > ART023_BUDGET.drawsWinter) {
    throw new Error(`ArtPass023: ${report.designDrawsWinter} draws en invierno > ${ART023_BUDGET.drawsWinter}`)
  }
  if (report.triangles > ART023_BUDGET.triangles) {
    throw new Error(`ArtPass023: ${report.triangles} triángulos > ${ART023_BUDGET.triangles}`)
  }
  if (report.textures !== ART023_BUDGET.textures) {
    throw new Error(`ArtPass023: ${report.textures} texturas nuevas != ${ART023_BUDGET.textures}`)
  }
  if (report.lights !== ART023_BUDGET.lights) {
    throw new Error(`ArtPass023: ${report.lights} luces reales != ${ART023_BUDGET.lights}`)
  }
  if (report.legacyMeshesReplaced !== 20) {
    throw new Error(`ArtPass023: reemplaza ${report.legacyMeshesReplaced} mallas legacy de Nara, se esperaban 20`)
  }
}

export function enforceArt023Budget(
  report: Art023Report,
  crashOnViolation: boolean,
  reportViolation: (message: string) => void = console.error,
) {
  try {
    assertArt023Budget(report)
    return true
  } catch (error) {
    if (crashOnViolation) throw error
    reportViolation(error instanceof Error ? error.message : String(error))
    return false
  }
}
