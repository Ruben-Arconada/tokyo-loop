import test from 'node:test'
import assert from 'node:assert/strict'
import { probeLegPlan } from '../src/game/probePlan.ts'

// ————————————————————————————————————————————————————————————————
// The A/B probe's schedule, which shipped confounded once: station and
// condition both derived from `leg % 2`, so condition A only ever saw one
// station's approach and condition B only ever saw the other's. The log's two
// rows compared scenery, not sectorisation. These tests pin the property that
// run lost, and each fails against that original schedule.
// ————————————————————————————————————————————————————————————————

const LEGS = 8
const STATIONS = 2

test('every station × condition cell is driven equally often', () => {
  const counts = new Map<string, number>()
  for (let leg = 0; leg < LEGS; leg++) {
    const p = probeLegPlan(leg, STATIONS)
    const key = `${p.stationSlot}:${p.sectorsOn}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // 4 cells, 8 legs → exactly 2 each. The confounded schedule fails here with
  // two cells at 4 and two cells never driven at all.
  assert.equal(counts.size, STATIONS * 2)
  for (const [key, n] of counts) assert.equal(n, LEGS / (STATIONS * 2), `cell ${key}`)
})

test('the condition never sits still long enough to soak up the thermal drift', () => {
  // The phone throttles as it heats; interleaving is the whole reason the
  // probe alternates within one run. No more than two consecutive legs may
  // share a condition (ABBA's pairs), or one condition runs on a hotter chip.
  let run = 1
  for (let leg = 1; leg < LEGS; leg++) {
    const same = probeLegPlan(leg, STATIONS).sectorsOn === probeLegPlan(leg - 1, STATIONS).sectorsOn
    run = same ? run + 1 : 1
    assert.ok(run <= 2, `legs ${leg - 1}..${leg} extend a run of ${run}`)
  }
})

test('stations alternate every leg so the destination roll rebuilds', () => {
  for (let leg = 1; leg < LEGS; leg++) {
    assert.notEqual(probeLegPlan(leg, STATIONS).stationSlot, probeLegPlan(leg - 1, STATIONS).stationSlot)
  }
})

test('both conditions get the same share of legs', () => {
  const on = Array.from({ length: LEGS }, (_, leg) => probeLegPlan(leg, STATIONS)).filter((p) => p.sectorsOn).length
  assert.equal(on, LEGS / 2)
})
