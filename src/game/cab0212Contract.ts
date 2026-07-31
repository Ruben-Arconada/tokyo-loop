/**
 * Mobile budget for the 0.2.1.2 cab art pass.
 *
 * The report comes from the real post-merge scene graph. Tests keep the guard
 * itself honest without having to construct WebGL or a browser DOM in Node.
 */

export const CAB0212_BUDGET = {
  draws: 20,
  triangles: 3_500,
  textures: 10,
  lights: 0,
} as const

export interface Cab0212Report {
  draws: number
  triangles: number
  textures: number
  lights: number
  unlit: boolean
}

export function assertCab0212Budget(report: Cab0212Report) {
  if (!report.unlit) throw new Error('CabInterior0212: la cabina debe seguir completamente unlit')
  if (report.lights !== CAB0212_BUDGET.lights) {
    throw new Error(`CabInterior0212: ${report.lights} luces != ${CAB0212_BUDGET.lights}`)
  }
  if (report.draws > CAB0212_BUDGET.draws) {
    throw new Error(`CabInterior0212: ${report.draws} draws > ${CAB0212_BUDGET.draws}`)
  }
  if (report.triangles > CAB0212_BUDGET.triangles) {
    throw new Error(`CabInterior0212: ${report.triangles} triángulos > ${CAB0212_BUDGET.triangles}`)
  }
  if (report.textures > CAB0212_BUDGET.textures) {
    throw new Error(`CabInterior0212: ${report.textures} texturas > ${CAB0212_BUDGET.textures}`)
  }
}

/**
 * An art-budget regression is loud in development but never turns production
 * into a blank screen. This mirrors the 0.2.1 station/passenger contract.
 */
export function enforceCab0212Budget(
  report: Cab0212Report,
  crashOnViolation: boolean,
  reportViolation: (message: string) => void = console.error,
) {
  try {
    assertCab0212Budget(report)
    return true
  } catch (error) {
    if (crashOnViolation) throw error
    reportViolation(error instanceof Error ? error.message : String(error))
    return false
  }
}
