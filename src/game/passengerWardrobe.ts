/**
 * Wet-day identity shared by the billboard sheet and the close-range 3D LOD.
 * Index 0–7 is the passenger archetype; 8 is the station attendant.
 * `null` is deliberate: not every commuter carries an umbrella.
 */
export const PASSENGER_UMBRELLAS = [
  '#1d2738',
  '#7a3040',
  '#cfd8e2',
  null,
  '#3b4034',
  null,
  '#5a4a66',
  '#274a3f',
  null,
] as const

/** Pure visibility decision used by the live 3D LOD and exercised in Node. */
export function passengerUmbrellaColor(row: number, wet: boolean): string | null {
  if (!wet) return null
  return PASSENGER_UMBRELLAS[row] ?? null
}
