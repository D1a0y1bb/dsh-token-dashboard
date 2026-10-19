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

test('the activity grid is the calendar year, January through December', () => {
  // The ruler must read 1月 through 12月 in order. A rolling window starts
  // wherever the current month is and the ruler no longer matches the calendar.
  assert.ok(/const firstOfRange = `\$\{year\}-01-01`/.test(client), 'the grid starts in January')
  assert.ok(/const lastOfRange = `\$\{year\}-12-31`/.test(client), 'the grid ends in December')
  assert.ok(/!labelled.has\(monthKey\)/.test(client), 'each month is labelled once')
  assert.ok(/td-lv5/.test(client), 'the palette has five steps')
})

test('the heatmap does not single out today', () => {
  // A ring on one cell of a year reads as an error, not as emphasis.
  assert.ok(/--td-heat-outline/.test(client), 'the marker is a hairline, not a highlight')
  assert.ok(!/data-today\]\{outline:1\.5px solid var\(--td-heat-strong\)/.test(client),
    'today is not outlined in the accent colour')
})

test('every stat cell shares one structure and one height', () => {
  // Three rows in the main cell against two in the others made one card taller
  // than its neighbours.
  assert.ok(/\.td-stat\{[^}]*min-height:104px/.test(client), 'cells declare a shared minimum height')
  // Count the rendered cells, not the CSS selectors or the 'td-stats' wrapper,
  // both of which start the same way.
  const cells = client.match(/className: 'td-stat(?: td-stat-main)?' \}/g)
  assert.equal(cells?.length, 4, 'four stat cells')
})

test('the section declares itself a size container', () => {
  // The Settings panel is a fixed-width modal: a viewport query would size the
  // cards for the window and cram four columns into a narrow panel.
  assert.ok(/container-type:inline-size/.test(client), 'the section is a query container')
  assert.ok(/@container \(min-width:600px\)/.test(client), 'the wide layout is a container query')
})

test('the top row puts the live note beside the title', () => {
  assert.ok(/td-top-lead/.test(client), 'the title and note share a lead group')
  assert.ok(/\.td-top\{[^}]*justify-content:space-between/.test(client),
    'the range sits at the far edge of the row')
})

test('the account picture is read from the account service', () => {
  // There is no other copy of it in the client.
  assert.ok(/createAvatarStore/.test(client), 'the picture has a shared store')
  assert.ok(/remote\.account\.getProfile/.test(client), 'the picture comes from the account read')
  assert.ok(/td-avatar-strip/.test(client), 'the picture has a strip of its own')
})
