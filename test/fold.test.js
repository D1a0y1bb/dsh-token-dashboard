/**
 * Unit tests for the host half's fold logic.
 *
 * `foldCalls` is the one piece with real logic: it decides which Session
 * events count as a billed call and what the model was at that moment. Run
 * with `node --test test/`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { foldCalls } from '../lib/index.js'

/** One `assistant/message` event carrying provider-reported usage. */
const message = (turn, step, usage, time = 0) => ({
  type: 'assistant/message',
  time,
  data: { turn, step, usage },
})

const header = (provider, model) => ({
  type: 'request/header',
  data: { header: { config: { provider, model } } },
})

test('one attempt becomes one row', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    message(1, 1, { inputTokens: 100, outputTokens: 20 }),
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(
    { input: rows[0].input, output: rows[0].output, provider: rows[0].provider, model: rows[0].model, kind: rows[0].kind },
    { input: 100, output: 20, provider: 'p', model: 'm', kind: 'turn' },
  )
})

test('a later sample of the same attempt replaces the earlier one', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    message(1, 1, { inputTokens: 100, outputTokens: 20 }),
    message(1, 1, { inputTokens: 150, outputTokens: 30 }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].input, 150)
  assert.equal(rows[0].output, 30)
})

test('a retry starts a new attempt and both count', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    message(1, 1, { inputTokens: 100, outputTokens: 10 }),
    { type: 'llm/retry-started', data: { turn: 1, step: 1 } },
    message(1, 1, { inputTokens: 120, outputTokens: 15 }),
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].input + rows[1].input, 220)
})

test('a second retry in the same step counts again', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    { type: 'llm/retry-started', data: { turn: 1, step: 1 } },
    message(1, 1, { inputTokens: 10, outputTokens: 1 }),
    { type: 'llm/retry-started', data: { turn: 1, step: 1 } },
    message(1, 1, { inputTokens: 20, outputTokens: 2 }),
  ])
  assert.equal(rows.length, 2)
})

test('a retry in a different step starts its own attempt', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    { type: 'llm/retry-started', data: { turn: 1, step: 1 } },
    message(1, 1, { inputTokens: 10, outputTokens: 1 }),
    { type: 'llm/retry-started', data: { turn: 1, step: 2 } },
    message(1, 2, { inputTokens: 20, outputTokens: 2 }),
  ])
  assert.equal(rows.length, 2)
})

test('a forked Session drops the rows inherited from its parent', () => {
  const { rows, reset } = foldCalls([
    header('p', 'm'),
    message(1, 1, { inputTokens: 999, outputTokens: 999 }),
    { type: 'session/end-seed', data: { inherited: true } },
    message(2, 1, { inputTokens: 10, outputTokens: 1 }),
  ])
  assert.equal(reset, true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].input, 10)
})

test('an attempt with no usage is skipped', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    message(1, 1, undefined),
    { type: 'assistant/attempt', data: { turn: 1, step: 2, stream: [] } },
  ])
  assert.equal(rows.length, 0)
})

test('usage is read from the attempt stream when the message carries none', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    {
      type: 'assistant/attempt',
      data: {
        turn: 1,
        step: 1,
        stream: [{ type: 'chunk', chunk: { type: 'text', text: 'hi' } }, { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } } }],
      },
    },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].input, 7)
  assert.equal(rows[0].output, 3)
})

test('the model follows the latest request header', () => {
  const { rows } = foldCalls([
    header('p', 'first'),
    message(1, 1, { inputTokens: 1, outputTokens: 1 }),
    header('p', 'second'),
    message(1, 2, { inputTokens: 2, outputTokens: 2 }),
  ])
  assert.deepEqual(rows.map(row => row.model), ['first', 'second'])
})

test('request/context also names the model', () => {
  const { rows } = foldCalls([
    { type: 'request/context', data: { provider: 'p', model: 'ctx-model' } },
    message(1, 1, { inputTokens: 5, outputTokens: 5 }),
  ])
  assert.equal(rows[0].model, 'ctx-model')
})

test('cache counters are carried through and negatives are clamped to zero', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    message(1, 1, { inputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 50, outputTokens: 5 }),
    message(2, 1, { inputTokens: -5, cacheReadTokens: undefined, outputTokens: 1.5 }),
  ])
  assert.equal(rows[0].cacheRead, 1000)
  assert.equal(rows[0].cacheWrite, 50)
  assert.equal(rows[1].input, 0)
  assert.equal(rows[1].cacheRead, 0)
  assert.equal(rows[1].output, 0)
})

test('a compaction summary is billed as its own row with its own route', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    message(1, 1, { inputTokens: 100, outputTokens: 10 }),
    { type: 'compaction/start', data: { compactionId: 'c1' } },
    {
      type: 'compaction/summary',
      seq: 42,
      data: {
        compactionId: 'c1',
        provider: 'q',
        model: 'summarizer',
        usage: { inputTokens: 900, outputTokens: 90 },
      },
    },
  ])
  assert.equal(rows.length, 2)
  const compact = rows.find(row => row.kind === 'compact')
  assert.deepEqual(
    { input: compact.input, output: compact.output, provider: compact.provider, model: compact.model },
    { input: 900, output: 90, provider: 'q', model: 'summarizer' },
  )
})

test('a compaction summary without usage is skipped', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    { type: 'compaction/summary', seq: 7, data: { compactionId: 'c1' } },
  ])
  assert.equal(rows.length, 0)
})

test('a compaction summary keyed by seq is stable across a rescan', () => {
  const events = [
    header('p', 'm'),
    { type: 'compaction/summary', seq: 9, data: { usage: { inputTokens: 5, outputTokens: 1 } } },
  ]
  assert.deepEqual(foldCalls(events).rows.map(row => row.key), foldCalls(events).rows.map(row => row.key))
})

test('the fold state carries across reads', () => {
  const first = foldCalls([header('p', 'm'), message(1, 1, { inputTokens: 10, outputTokens: 1 })])
  const second = foldCalls([message(1, 2, { inputTokens: 20, outputTokens: 2 })], first.state)
  assert.equal(second.rows.length, 1)
  assert.equal(second.rows[0].model, 'm')
  assert.equal(second.rows[0].input, 20)
})

test('an empty log folds to nothing', () => {
  const { rows, reset } = foldCalls([])
  assert.deepEqual(rows, [])
  assert.equal(reset, false)
})

test('a session title is carried in the fold state', () => {
  const first = foldCalls([
    header('p', 'm'),
    { type: 'session/title', data: { title: 'first title' } },
    message(1, 1, { inputTokens: 10, outputTokens: 1 }),
  ])
  assert.equal(first.state.title, 'first title')
  // A later read only sees appended events, so the title must survive.
  const second = foldCalls([
    message(1, 2, { inputTokens: 20, outputTokens: 2 }),
  ], first.state)
  assert.equal(second.state.title, 'first title')
})

test('a newer title replaces the older one', () => {
  const result = foldCalls([
    { type: 'session/title', data: { title: 'old' } },
    { type: 'session/title', data: { title: 'new' } },
  ])
  assert.equal(result.state.title, 'new')
})

test('an empty or malformed title is ignored', () => {
  const result = foldCalls([
    { type: 'session/title', data: { title: 'kept' } },
    { type: 'session/title', data: { title: '   ' } },
    { type: 'session/title', data: { title: 42 } },
    { type: 'session/title', data: {} },
  ])
  assert.equal(result.state.title, 'kept')
})

test('a title is not counted as a billed call', () => {
  const { rows } = foldCalls([
    header('p', 'm'),
    { type: 'session/title', data: { title: 'a name' } },
  ])
  assert.equal(rows.length, 0)
})
