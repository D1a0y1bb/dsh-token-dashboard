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
const index = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
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

test('the activity grid is one row, January through December', () => {
  // The ask is one band: 1月 on the left, 12月 on the right.
  assert.ok(/rows: \[band\(1, 12\)\]/.test(client), 'the year is a single band')
  assert.ok(/band\(1, 12\)/.test(client), 'the band covers all twelve months')
  // A year is 53 weeks, so the cell is the card width divided by 53.
  assert.ok(/--td-cell-size:calc\(\(100cqw - 36px - 104px\) \/ 53\)/.test(client),
    'the cell divides the card width by 53 columns')
})

test('the heatmap does not single out today', () => {
  // A ring on one cell of the grid reads as a selection or an error. The test
  // asserts the absence of the attribute and the rule, not of a variable name:
  // an earlier version passed while the outline was still drawn.
  assert.ok(!/data-today/.test(client), 'no cell is marked as today')
  assert.ok(!/td-cell\[data-today\]/.test(client), 'no rule draws an outline')
})

test('every stat cell shares one structure and one height', () => {
  // Three rows in the main cell against two in the others made one card taller
  // than its neighbours.
  assert.ok(/\.td-stat\{[^}]*justify-content:center/.test(client), 'cell content is centred')
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

test('the profile card is the user\'s own, not the account\'s', () => {
  // A plugin cannot read the account picture, so the card is work the user
  // supplies: an uploaded picture and a typed name.
  assert.ok(/createProfileStore/.test(client), 'the card has a shared store')
  assert.ok(/td-avatar-empty/.test(client), 'an empty slot invites an upload')
  assert.ok(/shrinkImage/.test(client), 'a picked photo is downscaled before storing')
  assert.ok(/EditableText/.test(client), 'the name is edited in place')
  assert.ok(!/remote\.account/.test(client), 'the account service is not used')
})

test('the picked file is read before the input is reset', () => {
  // Resetting a file input's value empties its `files` list. Clearing first made
  // every upload find no file, so the button did nothing while the name save -
  // a different path - worked.
  const start = client.indexOf('const onPickAvatar = useCallback')
  const body = client.slice(start, client.indexOf('[onSaveProfile]', start))
  const filesAt = body.indexOf('pick?.files')
  const clearAt = body.indexOf("pick.value = ''")
  assert.ok(filesAt > 0 && clearAt > 0, 'both statements are present')
  assert.ok(filesAt < clearAt, 'the file is read before the input is reset')
})

test('clearing the picture is a save, not an unsupported value', () => {
  // The first version rejected the empty string as "unsupported", so a cleared
  // picture could never be removed.
  assert.ok(/if \(url === ''\) next\.url = ''/.test(index), 'an empty URL clears the picture')
  assert.ok(/if \(name !== undefined\)/.test(index), 'a partial save keeps the other field')
})


/** Read the brand table out of the client so the test needs no copy of it. */
function brandOf(provider, model) {
  const start = client.indexOf('const BRANDS = [')
  const end = client.indexOf('/** The mark for one route', start)
  assert.ok(start > 0 && end > start, 'the brand table is present')
  const source = `${client.slice(start, end)}\nreturn { BRANDS }`
  const { BRANDS } = new Function(source)()
  const text = `${model} ${provider}`
  return BRANDS.find((brand) => brand.match.test(text))
}

test('families with an official mark get one, and the rest fall back', () => {
  // A hand-drawn approximation is worse than no icon: it reads as a bug. Only
  // families whose real mark is in the set get a glyph.
  const withMark = {
    deepseek: ['deepseek-account', 'deepseek-v4.1-flash'],
    gemini: ['gemini', 'gemini-3.8-flash'],
    kimi: ['opencode-go', 'kimi-k2.7-code'],
    qwen: ['opencode-go', 'qwen3.8-flash'],
    openai: ['workbuddy', 'gpt-6-astra'],
    claude: ['buddy', 'claude-opus-5-5'],
    minimax: ['minimax', 'minimax-m3'],
    mimo: ['xiaomi', 'mimo-v2.6-flash'],
  }
  for (const [name, [provider, model]] of Object.entries(withMark)) {
    assert.ok(brandOf(provider, model) !== undefined, `${name} has a mark`)
  }
  // A family with no official mark uses the initials instead of an invention.
  for (const [provider, model] of [['nobody', 'unheard-of-model'], ['xai', 'grok-4.7']]) {
    assert.equal(brandOf(provider, model), undefined, `${model} falls back`)
  }
})

test('a brand mark carries its own colour and a valid SVG body', () => {
  const brand = brandOf('deepseek-account', 'deepseek-v4.1-flash')
  assert.match(brand.color, /^#[0-9A-Fa-f]{6}$/)
  assert.ok(brand.paths.length > 20, 'the mark has a real path')
  assert.ok(!/currentColor/.test(brand.color), 'the colour is a literal so it does not inherit')
})
