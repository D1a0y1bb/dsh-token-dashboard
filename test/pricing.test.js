/**
 * Pricing tests.
 *
 * The table is data, so the tests check the resolution order and the shapes
 * that matter: an override wins, a family pattern covers a new model, a free
 * model costs nothing, and an unknown model still returns a usable rate.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { costOf, EXACT, FALLBACK, isDeepseekOffPeak, PATTERNS, resolvePrice, timeMultiplier } from '../lib/pricing.js'

test('an exact override from the config wins over everything', () => {
  const { rate, source } = resolvePrice('deepseek-official', 'deepseek-flash', {
    'deepseek-official/deepseek-flash': { input: 9, output: 9 },
  })
  assert.equal(source, 'config')
  assert.equal(rate.input, 9)
})

test('an exact table entry beats a pattern', () => {
  const { rate, source } = resolvePrice('gemini', 'gemini-3.8-flash', {})
  assert.equal(source, 'exact')
  assert.equal(rate.input, 0.75)
})

test('a family pattern covers a model that is not in the exact table', () => {
  const { rate, source } = resolvePrice('some-host', 'deepseek-v9-flash', {})
  assert.equal(source, 'pattern')
  assert.equal(rate.input, 0.15)
})

test('a model served by a different provider keeps its family rate', () => {
  const a = resolvePrice('deepseek-official', 'deepseek-flash', {}).rate
  const b = resolvePrice('buddy', 'deepseek-flash', {}).rate
  assert.deepEqual(a, b)
})

test('a free model costs nothing, in both suffix spellings', () => {
  for (const model of ['mimo-v2.6-flash-free', 'ling-3.1-flash:free', 'ling-3.1-flash-free', 'muse-spark-1.3-contributor-free']) {
    const { rate } = resolvePrice('our-free-model', model, {})
    assert.equal(rate.input, 0, model)
    assert.equal(rate.output, 0, model)
    assert.equal(rate.cacheRead, 0, model)
  }
})

test('an unknown model falls back to a usable rate and says so', () => {
  const { rate, source } = resolvePrice('mystery-host', 'zzz-unknown-1', {})
  assert.equal(source, 'fallback')
  assert.deepEqual(rate, { ...FALLBACK, cacheWrite: FALLBACK.input })
})

test('a rate that omits cacheWrite uses the input rate', () => {
  const { rate } = resolvePrice('deepseek-official', 'deepseek-flash', {})
  assert.equal(rate.cacheWrite, rate.input)
})

test('a rate that sets cacheWrite keeps it', () => {
  const { rate } = resolvePrice('apiapikeyfan', 'claude-opus-5-5', {})
  assert.equal(rate.cacheWrite, 5)
  assert.equal(rate.cacheRead, 0.2)
})

test('costOf prices each counter at its own rate', () => {
  const { cost } = costOf({
    provider: 'deepseek-official', model: 'deepseek-flash',
    input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000,
  }, {})
  // 0.15 + 0.6 + 0.003 + 0.15
  assert.ok(Math.abs(cost - 0.903) < 1e-9, `got ${cost}`)
})

test('costOf returns the rate it used', () => {
  const { source, rate } = costOf({ provider: 'x', model: 'glm-5.3-flash', input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, {})
  assert.equal(source, 'pattern')
  assert.equal(rate.input, 0.04)
})

test('a zero-usage group costs nothing', () => {
  const { cost } = costOf({ provider: 'deepseek-official', model: 'deepseek-flash', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, {})
  assert.equal(cost, 0)
})

test('every pattern is well formed', () => {
  for (const entry of PATTERNS) {
    assert.ok(entry.model instanceof RegExp, String(entry.model))
    assert.ok(entry.provider === null || entry.provider instanceof RegExp)
    assert.equal(typeof entry.rate.input, 'number')
    assert.equal(typeof entry.rate.output, 'number')
    assert.ok(entry.rate.input >= 0 && entry.rate.output >= 0)
    assert.equal(typeof entry.note, 'string')
  }
})

test('every exact entry is well formed', () => {
  for (const [route, rate] of Object.entries(EXACT)) {
    assert.ok(route.includes('/'), route)
    assert.ok(rate.input >= 0 && rate.output >= 0, route)
  }
})

test('a more specific pattern is listed before a broader one', () => {
  // `deepseek-v4-pro` must not be priced as a flash model.
  const pro = resolvePrice('x', 'deepseek-v4-pro', {})
  const flash = resolvePrice('x', 'deepseek-v4-flash', {})
  assert.ok(pro.rate.input > flash.rate.input, 'pro should cost more than flash')
})

test('glm flash is cheaper than the glm flagship', () => {
  const flash = resolvePrice('x', 'glm-5.3-flash', {}).rate
  const full = resolvePrice('x', 'glm-5.3', {}).rate
  assert.ok(flash.input < full.input)
})

/** A UTC instant inside DeepSeek's discount window, as epoch milliseconds. */
const offPeakAt = hour => Date.UTC(2026, 9, 17, hour, 0, 0)
/** One hour outside the window. */
const peakAt = hour => Date.UTC(2026, 9, 17, hour, 0, 0)

test('DeepSeek discount window wraps midnight UTC', () => {
  // 16:30 – 00:30 UTC is discounted; the rest bills at the peak multiplier.
  assert.equal(isDeepseekOffPeak(offPeakAt(17)), true, '17:00 UTC')
  assert.equal(isDeepseekOffPeak(offPeakAt(23)), true, '23:00 UTC')
  assert.equal(isDeepseekOffPeak(offPeakAt(0)), true, '00:00 UTC')
  assert.equal(isDeepseekOffPeak(peakAt(8)), false, '08:00 UTC')
  assert.equal(isDeepseekOffPeak(peakAt(16)), false, '16:00 UTC')
})

test('the peak multiplier applies only to DeepSeek direct routes', () => {
  assert.equal(timeMultiplier('deepseek-official', peakAt(8)), 2)
  assert.equal(timeMultiplier('deepseek', peakAt(8)), 2)
  // A plan or a reseller does not follow DeepSeek's own schedule.
  assert.equal(timeMultiplier('buddy', peakAt(8)), 1)
  assert.equal(timeMultiplier('opencode-go', peakAt(8)), 1)
  assert.equal(timeMultiplier('opendesign', peakAt(8)), 1)
  // The same route is not marked up inside the discount window.
  assert.equal(timeMultiplier('deepseek-official', offPeakAt(20)), 1)
})

test('a peak-hour call costs twice an off-peak call', () => {
  const group = { provider: 'deepseek-official', model: 'deepseek-flash', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
  const off = costOf({ ...group, time: offPeakAt(20) }, {})
  const peak = costOf({ ...group, time: peakAt(8) }, {})
  assert.ok(Math.abs(peak.cost - off.cost * 2) < 1e-9, `${peak.cost} vs ${off.cost}`)
  assert.equal(off.timed, false)
  assert.equal(peak.timed, true)
})

test('a group spanning peak and off-peak hours is priced per slot', () => {
  const { cost } = costOf({
    provider: 'deepseek-official', model: 'deepseek-flash',
    slots: [
      { time: offPeakAt(20), input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { time: peakAt(8), input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    ],
  }, {})
  // 0.15 off-peak + 0.30 peak
  assert.ok(Math.abs(cost - 0.45) < 1e-9, `got ${cost}`)
})

test('a call with no time is priced off-peak', () => {
  const { cost, timed } = costOf({ provider: 'deepseek-official', model: 'deepseek-flash', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, {})
  assert.ok(Math.abs(cost - 0.15) < 1e-9, `got ${cost}`)
  assert.equal(timed, false)
})
