// Original "departure melody" motifs, in the spirit of the short bell jingles
// (hassha melodies) played on real Japanese train platforms — but these are
// wholly original compositions written for this game, not transcriptions of
// any real JR East melody, which remain copyrighted by their composers.
//
// Each station gets a deterministic but distinct melody: a two-phrase template
// (a rising "question" half answered by a falling, resolving half) transposed
// into one of a handful of keys and lightly humanized in timing, so all 30
// stations feel related in style yet none repeats identically or sounds
// perfectly mechanical.

const MAJOR_PENTATONIC = [0, 2, 4, 7, 9] // bright, "ekimelo"-style scale
const PASSING_SEMITONES = [5, 11] // color tones used sparingly, off the main scale, on weak beats
const A4 = 440

type Note = { degree: number; beats: number; octave: 0 | 1 }
/** Scale-degree note (index into MAJOR_PENTATONIC). */
const T = (degree: number, beats: number, octave: 0 | 1 = 0): Note => ({ degree, beats, octave })
/** Passing-tone note (index into PASSING_SEMITONES) — encoded as degree+100. */
const P = (passingIdx: number, beats: number, octave: 0 | 1 = 0): Note => ({ degree: 100 + passingIdx, beats, octave })
/** Rest. */
const R = (beats: number): Note => ({ degree: -1, beats, octave: 0 })

// Two-phrase templates (rising question + falling/resolving answer), each
// ending on scale-degree index 1 — a soft resting tone, not the tonic, which
// is what gives these their characteristic "not quite finished" chime feel.
const TEMPLATES: Note[][] = [
  [T(0, 1), T(2, 1), T(4, 1), T(2, 0.5), P(0, 0.5), T(4, 1.5), R(0.5), T(4, 1), T(3, 1), T(2, 1), T(1, 2)],
  [T(4, 0.5), T(3, 0.5), T(2, 1), T(0, 1), T(2, 1), P(1, 0.5), T(4, 1.5), R(0.5), T(3, 1), T(1, 1), T(1, 2)],
  [T(0, 1), T(1, 1), T(2, 1), T(4, 1), T(2, 0.5), T(3, 0.5), T(4, 1.5), R(0.5), T(2, 1), T(0, 1), T(1, 2)],
  [T(2, 1), T(4, 1), T(3, 1), P(0, 0.5), T(4, 0.5), T(3, 1.5), R(0.5), T(2, 1), T(1, 1), T(0, 1), T(1, 2.5)],
  [T(0, 0.5), T(2, 0.5), T(3, 0.5), T(4, 0.5), T(3, 1), T(4, 1), R(0.5), P(1, 0.5), T(3, 1), T(2, 1), T(1, 2)],
  [T(4, 1), T(2, 1), T(0, 1), T(1, 1), T(3, 1), T(4, 1), R(0.5), T(2, 0.5), T(3, 0.5), T(1, 2.5)],
]

const ROOTS_HZ = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0] // C D E F G A — keeps a shared "family" sound

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Small deterministic PRNG (mulberry32), seeded per station so humanization is stable across replays. */
function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PlayableNote {
  freq: number | null
  duration: number
}

export function getStationMelody(stationId: string, tempoBpm = 132): PlayableNote[] {
  const h = hashString(stationId)
  const template = TEMPLATES[h % TEMPLATES.length]
  const root = ROOTS_HZ[(h >> 3) % ROOTS_HZ.length]
  const beatSec = 60 / tempoBpm
  const rand = mulberry32(h)

  return template.map((n) => {
    const durationJitter = 1 + (rand() * 2 - 1) * 0.035
    const duration = n.beats * beatSec * durationJitter
    if (n.degree < 0) return { freq: null, duration }
    const isPassing = n.degree >= 100
    const semitones = (isPassing ? PASSING_SEMITONES[n.degree - 100] : MAJOR_PENTATONIC[n.degree]) + n.octave * 12
    const detuneCents = (rand() * 2 - 1) * 6
    const freq = root * Math.pow(2, (semitones + detuneCents / 100) / 12)
    return { freq, duration }
  })
}

// A soft two-tone chime for doors opening/closing — generic interval, not a
// reproduction of any specific real chime.
export const DOOR_CHIME_OPEN: PlayableNote[] = [
  { freq: A4 * Math.pow(2, 7 / 12), duration: 0.18 },
  { freq: A4 * Math.pow(2, 12 / 12), duration: 0.32 },
]
export const DOOR_CHIME_CLOSE: PlayableNote[] = [
  { freq: A4 * Math.pow(2, 12 / 12), duration: 0.18 },
  { freq: A4 * Math.pow(2, 7 / 12), duration: 0.32 },
]

// Boarding finished — the conductor's "all aboard, you may close" cue: a
// bright ascending triplet, distinct from both door chimes (two notes) and
// the attention chime (descending).
export const BOARDING_DONE_CUE: PlayableNote[] = [
  { freq: A4 * Math.pow(2, 5 / 12), duration: 0.11 },
  { freq: A4 * Math.pow(2, 9 / 12), duration: 0.11 },
  { freq: A4 * Math.pow(2, 14 / 12), duration: 0.3 },
]

// A short, distinct two-note "attention" chime that precedes spoken PA
// announcements — deliberately different from the door chimes so the two
// cues stay easy to tell apart by ear.
export const ATTENTION_CHIME: PlayableNote[] = [
  { freq: A4 * Math.pow(2, 12 / 12), duration: 0.16 },
  { freq: A4 * Math.pow(2, 7 / 12), duration: 0.2 },
]

// A short ascending chiptune arpeggio (played with the 'retro' square-wave
// timbre) that opens the very first PA announcement of a session — a wholly
// original little fanfare, not a quotation of any real game's jingle.
const C4 = 261.63
const E4 = 329.63
const G4 = 392.0
const C5 = 523.25
export const RETRO_FANFARE: PlayableNote[] = [
  { freq: C4, duration: 0.09 },
  { freq: E4, duration: 0.09 },
  { freq: G4, duration: 0.09 },
  { freq: C5, duration: 0.16 },
  { freq: G4, duration: 0.09 },
  { freq: C5, duration: 0.24 },
]
