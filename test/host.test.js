/**
 * Tests for the two host rules that have to be exact but are not worth a
 * Session log fixture: how a log read separates the Session header from the
 * ordered events, and what happens to a config value the plugin cannot use.
 *
 * Both were silent failures in 1.1.6: the header was dropped by the sequence
 * filter, so every stored working directory was the lossy directory-name
 * decode, and a misspelt config key was ignored without a word.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { eventCollector, sanitizeConfig } from '../lib/index.js'

/** One serialized line, exactly as the log stores it. */
const line = value => JSON.stringify(value)

test('the Session header is kept even though it has no seq', () => {
  const sink = eventCollector()
  // The header is the only event without a `seq`; before 1.1.7 the sequence
  // filter dropped it and the exact cwd never reached the ledger.
  sink.line(line({ type: 'session', version: 4, id: 's1', createdAt: 1_700_000_000_000, cwd: '/Users/me/Now-CTF' }))
  sink.line(line({ type: 'assistant/message', seq: 7, data: { usage: { inputTokens: 1 } } }))
  assert.deepEqual(sink.events.map(event => event.seq), [7], 'only sequenced events are ordered')
  assert.equal(sink.header.cwd, '/Users/me/Now-CTF', 'the exact cwd is read, not the directory name')
  assert.equal(sink.header.createdAt, 1_700_000_000_000)
})

test('a line that is not wanted or not JSON is skipped without failing', () => {
  const sink = eventCollector()
  sink.line(line({ type: 'tool/call', seq: 3, data: {} }))
  sink.line('{"type":"assistant/message"')
  sink.line('')
  assert.deepEqual(sink.events, [])
  assert.equal(sink.header, undefined)
})

test('the first header wins and only one is reported', () => {
  const sink = eventCollector()
  sink.line(line({ type: 'session', cwd: '/first', createdAt: 1 }))
  sink.line(line({ type: 'session', cwd: '/second', createdAt: 2 }))
  assert.equal(sink.header.cwd, '/first')
})

test('a config typo is reported instead of silently ignored', () => {
  const messages = []
  const clean = sanitizeConfig({
    home: '/tmp/home',
    databse: '/tmp/db', // a typo must not be treated as a valid key
    sessions: 42,
    prices: {
      'deepseek/deepseek-v4.1-flash': { input: 0.15, output: 0.6 },
      'broken/rate': { input: 'cheap' },
    },
  }, message => messages.push(message))

  assert.equal(clean.home, '/tmp/home')
  assert.equal(clean.databse, undefined, 'an unknown key does not pass through')
  assert.equal(clean.sessions, undefined, 'a value of the wrong type does not pass through')
  assert.deepEqual(Object.keys(clean.prices), ['deepseek/deepseek-v4.1-flash'], 'only a usable rate is kept')
  assert.equal(messages.length, 3, 'one message per rejected value')
})

test('a config that is not an object is reported and ignored', () => {
  const messages = []
  assert.deepEqual(sanitizeConfig(['nope'], message => messages.push(message)), {})
  assert.deepEqual(sanitizeConfig('nope', message => messages.push(message)), {})
  assert.deepEqual(sanitizeConfig(undefined, () => assert.fail('no message for an absent config')), {})
  assert.equal(messages.length, 2)
})

test('an empty string is rejected rather than accepted as a path', () => {
  const messages = []
  const clean = sanitizeConfig({ home: '' }, message => messages.push(message))
  assert.equal(clean.home, undefined)
  assert.equal(messages.length, 1)
})
