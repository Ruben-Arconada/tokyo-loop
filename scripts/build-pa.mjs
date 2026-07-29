#!/usr/bin/env node
// ————————————————————————————————————————————————————————————————
// Builds the station announcements.
//
// The PA used to be synthesized live by the browser's Web Speech API. On iOS
// that runs through AVSpeechSynthesizer, in its own audio session, and every
// time the utterance queue drained the main thread froze for about a third of
// a second — measured, once per station, and confirmed by an A/B where a cold
// muted lap had none of them. It also meant the voice could never go through
// the game's own audio graph, so it could not have the platform reverb.
//
// So the announcements are recorded ahead of time and played as buffers. The
// pieces are CONCATENATIVE, the way real JR announcements are assembled: a
// handful of fixed fragments plus the station's name. Of a whole sentence,
// the only part unique to a station is its name — which is why this fits in
// ~75 KB per language instead of ~1.2 MB.
//
// Everything is emitted by THIS script in one pass: the audio sprite and the
// offset table that indexes it. They must never be generated separately —
// re-record one clip, the sprite shifts, a stale table keeps the old offsets,
// and from that point every announcement says the wrong syllable.
//
//   node scripts/build-pa.mjs
//
// Needs macOS: `say` for the voices and `afconvert` for the encoding.
// ————————————————————————————————————————————————————————————————

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = join(ROOT, '.pa-build')
const OUT_AUDIO = join(ROOT, 'public', 'audio', 'pa')
const OUT_TABLE = join(ROOT, 'src', 'data', 'paClips.ts')

/** 24 kbps mono AAC. The speaker filter in the game cuts at 3.4 kHz, so there is little up there for more bits to describe — verified by ear before choosing. */
const BITRATE = 24000
/**
 * Silence between clips inside a sprite. AAC codes in frames of 1024 samples
 * and adds priming; without a gap the tail of one fragment bleeds into the
 * start of the next. Silence compresses to almost nothing, so this is free.
 */
const PAD_SECONDS = 0.1
/** Between the two repeats of a station name, the way a real announcement breathes. */
export const NAME_REPEAT_GAP = 0.25
/** Stations per name sprite. Six gives five arcs over the ring — small enough that holding two is cheap. */
const ARC_SIZE = 6

const VOICES = { ja: 'Kyoko', es: 'Mónica', en: 'Samantha' }

/**
 * The fixed pieces. Every announcement is one of these shapes with a name
 * dropped in, so thirty stations cost thirty names rather than sixty
 * sentences.
 */
const FRAGMENTS = {
  ja: {
    next: '次は、',
    soon: 'まもなく、',
    doors: 'です。お出口は',
    left: '左側',
    right: '右側',
    end: 'です。',
    closing: 'ドアが閉まります。ご注意ください。',
  },
  es: {
    next: 'Próxima estación:',
    soon: 'Llegamos a',
    doors: 'Las puertas se abrirán por el lado',
    left: 'izquierdo.',
    right: 'derecho.',
    closing: 'Las puertas se cierran.',
  },
  en: {
    next: 'The next station is',
    soon: 'We will soon arrive at',
    doors: 'Doors will open on the',
    left: 'left side.',
    right: 'right side.',
    closing: 'The doors are closing.',
  },
}

/**
 * Station names, read from the game's own data so the two can never disagree.
 *
 * Japanese uses `nameKana`, NOT `nameJa`, and that is not a stylistic choice:
 * 清水 is Kiyomizu here, but every Japanese synthesizer reads that kanji as
 * "Shimizu". Measured — 清水 and しみず come out at exactly 0.50 s while
 * きよみず takes 0.68. One of the thirty was wrong, and it was the hill
 * station. The kana reading is right for all thirty, so it is the rule.
 */
function readStations() {
  const src = readFileSync(join(ROOT, 'src', 'data', 'stations.ts'), 'utf8')
  const rows = [...src.matchAll(/id: '([^']+)', nameEn: '([^']+)', nameJa: '([^']+)', nameKana: '([^']+)'/g)]
  if (rows.length !== 30) throw new Error(`Se esperaban 30 estaciones y se han leído ${rows.length}`)
  return rows.map((m) => ({ id: m[1], nameEn: m[2], nameKana: m[4] }))
}

function say(voice, text, wavPath) {
  const aiff = join(TMP, 'say.aiff')
  execFileSync('say', ['-v', voice, '-o', aiff, text])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', aiff, wavPath])
}

/** Minimal WAV reader/writer — the clips are mono 16-bit by construction. */
function readWav(path) {
  const buf = readFileSync(path)
  let pos = 12
  let rate = 22050
  let data = null
  while (pos < buf.length - 8) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') rate = buf.readUInt32LE(pos + 12)
    if (id === 'data') data = buf.subarray(pos + 8, pos + 8 + size)
    pos += 8 + size + (size % 2)
  }
  if (!data) throw new Error(`WAV sin datos: ${path}`)
  return { rate, data }
}

function writeWav(path, rate, data) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
}

/** Concatenates clips into one sprite, returning where each one landed. */
function buildSprite(clips, spritePath) {
  const parts = []
  const table = {}
  let rate = 22050
  let cursor = 0
  for (const { key, wav } of clips) {
    const { rate: r, data } = readWav(wav)
    rate = r
    const seconds = data.length / 2 / rate
    table[key] = { at: round(cursor), dur: round(seconds) }
    parts.push(data, Buffer.alloc(Math.round(PAD_SECONDS * rate) * 2))
    cursor += seconds + PAD_SECONDS
  }
  writeWav(spritePath, rate, Buffer.concat(parts))
  return { table, seconds: cursor }
}

const round = (n) => Math.round(n * 1000) / 1000

function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  mkdirSync(OUT_AUDIO, { recursive: true })

  const stations = readStations()
  const manifest = {}
  let totalBytes = 0

  for (const lang of Object.keys(VOICES)) {
    const voice = VOICES[lang]
    // Split by WHEN each piece is needed, not by what it is. The fragments are
    // used at every station, so they are one sprite that stays resident. The
    // names are only needed as you approach them, so they go in arcs of the
    // ring: hold the arc you are in plus the next one and the rest can wait.
    //
    // The alternative extremes both lose. One sprite for all thirty names is
    // 3.3 MB of decoded audio resident for a name you use once a lap; one file
    // per name costs ~6 KB of container header EACH, which triples the
    // download. Arcs give most of the memory saving for a few KB.
    const groups = {
      frag: Object.entries(FRAGMENTS[lang]).map(([key, text]) => ({ key, text })),
    }
    for (let arc = 0; arc * ARC_SIZE < stations.length; arc++) {
      groups[`name${arc}`] = stations
        .slice(arc * ARC_SIZE, (arc + 1) * ARC_SIZE)
        .map((s) => ({ key: s.id, text: lang === 'ja' ? s.nameKana : s.nameEn }))
    }

    manifest[lang] = {}
    for (const [group, items] of Object.entries(groups)) {
      const clips = []
      for (const { key, text } of items) {
        const wav = join(TMP, `${lang}-${group}-${key}.wav`)
        say(voice, text, wav)
        clips.push({ key, wav })
      }
      const spriteWav = join(TMP, `${lang}-${group}.wav`)
      const { table, seconds } = buildSprite(clips, spriteWav)
      const out = join(OUT_AUDIO, `${lang}-${group}.m4a`)
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), '-c', '1', spriteWav, out])
      const bytes = readFileSync(out).length
      totalBytes += bytes
      manifest[lang][group] = table
      console.log(
        `  ${lang}/${group}: ${items.length} clips · ${seconds.toFixed(1)} s · ${(bytes / 1024).toFixed(0)} KB`,
      )
    }
  }

  const banner = `// GENERADO POR scripts/build-pa.mjs — NO EDITAR A MANO.
//
// Las posiciones de este fichero indexan los sprites de public/audio/pa/. Los
// dos salen del mismo comando a propósito: si se regenera el audio sin
// regenerar esta tabla, cada aviso empieza a decir la sílaba equivocada.
//
// Regenerar con:  npm run pa:build
`
  writeFileSync(
    OUT_TABLE,
    `${banner}
/** Dónde vive cada recorte dentro de su sprite, en segundos. */
export interface ClipSlice {
  at: number
  dur: number
}

/** Hueco entre las dos repeticiones del nombre, como respira un aviso de verdad. */
export const NAME_REPEAT_GAP = ${NAME_REPEAT_GAP}

export type PaLang = ${Object.keys(VOICES)
      .map((l) => `'${l}'`)
      .join(' | ')}

/** Which sprite each station's name lives in — the arc index, from its position on the ring. */
export const ARC_SIZE = ${ARC_SIZE}

export const PA_CLIPS: Record<PaLang, Record<string, Record<string, ClipSlice>>> =
${JSON.stringify(manifest, null, 2)} as const
`,
  )

  console.log(`\nTotal ${Object.keys(VOICES).length} idiomas: ${(totalBytes / 1024).toFixed(0)} KB`)
  console.log(`Tabla: ${OUT_TABLE.replace(ROOT + '/', '')}`)
  rmSync(TMP, { recursive: true, force: true })
}

if (!existsSync(join(ROOT, 'src', 'data', 'stations.ts'))) throw new Error('Ejecútalo desde la raíz del repo')
main()
