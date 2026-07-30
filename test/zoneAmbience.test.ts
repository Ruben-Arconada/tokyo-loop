import test from 'node:test'
import assert from 'node:assert/strict'
import { AmbienceTrack, DISTRICT_AMBIENCE } from '../src/game/zoneAmbience.ts'

// ————————————————————————————————————————————————————————————————
// The ring's air. Stations hold their district's profile around the
// platform and cross-fade through the middle of each gap; the seam
// (t wrapping 1 → 0) is a segment like any other.
// ————————————————————————————————————————————————————————————————

const STOPS = [
  { tFraction: 0.0, district: 'business' },
  { tFraction: 0.25, district: 'shitamachi' },
  { tFraction: 0.5, district: 'bay' },
  { tFraction: 0.75, district: 'downtown' },
]

test('at a station marker the district profile is exact', () => {
  const track = new AmbienceTrack(STOPS)
  const s = track.sample(0.25)
  assert.equal(s.fogNearMul, DISTRICT_AMBIENCE.shitamachi.fogNearMul)
  assert.equal(s.fogTintW, DISTRICT_AMBIENCE.shitamachi.fogTintW)
})

test('the identity holds flat for the first fifth of the gap', () => {
  const track = new AmbienceTrack(STOPS)
  // 0.25 → 0.5 is shitamachi → bay; u = 0.15 is inside the flat head.
  const s = track.sample(0.25 + 0.25 * 0.15)
  assert.equal(s.fogNearMul, DISTRICT_AMBIENCE.shitamachi.fogNearMul)
})

test('mid-gap is the exact midpoint of the two profiles', () => {
  const track = new AmbienceTrack(STOPS)
  const s = track.sample(0.375)
  const want = (DISTRICT_AMBIENCE.shitamachi.fogNearMul + DISTRICT_AMBIENCE.bay.fogNearMul) / 2
  assert.ok(Math.abs(s.fogNearMul - want) < 1e-9, `${s.fogNearMul} vs ${want}`)
})

test('the seam segment blends the last station into the first', () => {
  const track = new AmbienceTrack(STOPS)
  // 0.75 → 1.0/0.0 is downtown → business; sample the middle of the seam.
  const s = track.sample(0.875)
  const want = (DISTRICT_AMBIENCE.downtown.fogFarMul + DISTRICT_AMBIENCE.business.fogFarMul) / 2
  assert.ok(Math.abs(s.fogFarMul - want) < 1e-9, `${s.fogFarMul} vs ${want}`)
})

test('an unknown district falls back instead of crashing', () => {
  const track = new AmbienceTrack([
    { tFraction: 0.0, district: 'atlantis' },
    { tFraction: 0.5, district: 'atlantis' },
  ])
  const s = track.sample(0.2)
  assert.ok(Number.isFinite(s.fogNearMul))
})

test('sampling is allocation-free after construction (same object back)', () => {
  const track = new AmbienceTrack(STOPS)
  const a = track.sample(0.1)
  const b = track.sample(0.6)
  assert.equal(a, b)
})
