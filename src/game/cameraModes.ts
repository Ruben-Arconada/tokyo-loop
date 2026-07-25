/**
 * The three eyes the player can look through. Kept in its own module because
 * both Game (which owns the cameras) and UI (which offers the chip) need it,
 * and importing one from the other would make a cycle.
 */
export type CameraMode = 'cab' | 'exterior' | 'platform'

export const CAMERA_MODES: { id: CameraMode; label: string; icon: string }[] = [
  { id: 'cab', label: 'Cabina', icon: '🚉' },
  { id: 'exterior', label: 'Exterior', icon: '🚃' },
  { id: 'platform', label: 'Andén', icon: '🧍' },
]
