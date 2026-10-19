/**
 * Tests for the browser half's model grouping and for the host's yield points.
 *
 * Both are properties a type system cannot check: the ranking key decides which
 * rows the page shows, and the yields decide whether the host stays responsive
 * during a scan.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

test('the model ranking is keyed by route, not by display name', () => {
  // Two providers serving one model id are separate rates and separate plans,
  // so grouping by name would hide the route and misprice the row.
  assert.ok(/const modelRoute = useCallback\(index => view\?\.models\[index\]\?\.key/.test(client),
    'the ranking key must be the provider/model route')
  assert.ok(/summarize\(rows, row => modelRoute\(row\[2\]\)\)/.test(client),
    'byModel must group by route')
  assert.ok(/const name = modelRoute\(row\[2\]\)/.test(client),
    'the per-model trend series must group by route')
})

test('the route is displayed together with its model name', () => {
  // A route key such as `buddy/deepseek-v4.1-flash` is precise but noisy, so
  // the row shows the model name and names the provider beside it.
  assert.ok(/function modelOf\(view, key\)/.test(client), 'the host entry must be looked up by route')
  assert.ok(/name: modelOf\(view, group\.key\)\?\.name \?\? group\.key/.test(client),
    'a ranked row must show the model name')
  assert.ok(/\.split\('\/'\)\[0\]/.test(client), 'a ranked row must show its provider')
})

test('a scan yields to the host event loop inside a large frame', () => {
  // The decode and the line split are the two stretches that can block a frame.
  assert.ok(/const DECODE_SLICE_BYTES = /.test(host), 'the decode needs a slice budget')
  assert.ok(/decoder\.pause\(\)/.test(host), 'the decoder must pause to yield')
  assert.ok(/setImmediate\(\(\) => decoder\.resume\(\)\)/.test(host),
    'the decoder must resume from a macrotask')
  assert.ok(/const EMIT_SLICE_BYTES = /.test(host), 'line splitting needs a slice budget')
  assert.ok(/async function emitLines\(/.test(host), 'line splitting must be awaitable')
  assert.ok(/await emitLines\(/.test(host), 'the reader must await line splitting')
})

test('a scan yields between Sessions', () => {
  assert.ok(/await worker\(next\)\s*\n\s*\/\/[\s\S]{0,300}setImmediate\(resolve\)/.test(host),
    'eachLimited must yield between items')
})

test('the aggregated payload is cached across polls', () => {
  // Rebuilding it costs one grouping query over every call, which a 1.2 s poll
  // would otherwise pay again and again.
  assert.ok(/const VIEW_REBUILD_MS = /.test(host), 'the rebuild needs a throttle window')
  assert.ok(/let cachedView/.test(host), 'the payload must be cached')
  assert.ok(/let builtRevision = -1/.test(host), 'the cache must record its revision')
  assert.ok(/if \(fresh\) \{/.test(host), 'a fresh cache must short-circuit the aggregation')
  assert.ok(/cachedView = \{ zone, projects, models, rows \}/.test(host),
    'the cache must be keyed by the formatting zone as well')
})
