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
  // The ask is one band: 1月 on the left, 12月 on the right. The band is built
  // once, by a helper the share card also draws from, so the panel and the
  // exported picture cannot disagree.
  assert.ok(/function yearBand\(days, uiLocale\)/.test(client), 'the year band has one builder')
  assert.ok(/const cells = useMemo\(\(\) => yearBand\(days, uiLocale\)/.test(client),
    'the heat map draws the year from it')
  assert.ok(/const first = `\$\{year\}-01-01`/.test(client), 'the band starts on 1 January')
  assert.ok(/const last = `\$\{year\}-12-31`/.test(client), 'the band ends on 31 December')
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
  // Six cells, drawn as two rows of three.
  const cells = client.match(/className: 'td-stat(?: td-stat-main)?'/g)
  assert.equal(cells?.length, 6, 'six stat cells')
  assert.ok(/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(client), 'three per row')
})

test('the section declares itself a size container', () => {
  // The Settings panel is a fixed-width modal: a viewport query would size the
  // cards for the window and cram the grid into a narrow panel.
  assert.ok(/container-type:inline-size/.test(client), 'the section is a query container')
  // Six cells stay three per row at every width. A wide-panel rule used to put
  // four in the first row while the separators still assumed three.
  assert.ok(!/@container[^{]*\{[^}]*\.td-stats/.test(client), 'no rule overrides the stat columns')
  const columns = client.match(/\.td-stats\{[^}]*grid-template-columns:repeat\((\d+)/)
  assert.equal(Number(columns?.[1]), 3, 'three columns, at any width')
})

test('every stat caption sits on its row baseline', () => {
  // The rate cell used to carry a small unit whose own line box made that cell
  // 34px tall instead of 30, so its caption sat 2px above the two beside it.
  // The unit is now the same size as the figure and shares the row outright.
  assert.ok(/\.td-stat-value\{[^}]*height:30px/.test(client), 'the value row has a fixed height')
  assert.ok(!/\.td-stat-value small/.test(client), 'no smaller unit inside the value row')
  assert.ok(!/h\('small', null, 'tok\/s'\)/.test(client), 'the unit is part of the figure')
})


test('the section opens with the identity block, without a title or a status', () => {
  // The Settings nav already names the section, and a background rescan does not
  // announce itself. The first element is the avatar, offset so its top edge
  // lands on the nav row's top edge: the Host draws its nav list 10px below the
  // panel body's top edge.
  assert.ok(!/className: 'td-top'/.test(client), 'no title row')
  assert.ok(!/td-title/.test(client), 'no title')
  assert.ok(!/td-note/.test(client), 'no scan status')
  // 10px is how far the nav list sits below the panel body; 9px more is the nav
  // row's own top padding, so the avatar's top edge meets the TEXT's top edge.
  assert.ok(/padding-top:19px/.test(client), 'the section takes the nav text offset')
  assert.ok(!/scanText/.test(client), 'the status text helper is gone')
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

test('the signature is stored beside the name and saved on its own', () => {
  // Free text under the name, edited and saved the same way the name is.
  assert.ok(/signature: typeof value\?\.signature === 'string'/.test(index), 'the store reads it')
  assert.ok(/next\.signature = signature\.trim\(\)\.slice\(0, 120\)/.test(index), 'it is trimmed and capped')
  assert.ok(/if \(signature !== undefined\)/.test(index), 'a partial save keeps the other fields')
  assert.ok(/t\('signatureLabel'\)/.test(client), 'the page labels it')
  assert.ok(/td-identity-signature/.test(client), 'it has its own style')
})

test('the month ruler has equal gaps and flush ends', () => {
  // A month is four or five weeks, so pinning a label to each month's first week
  // left gaps from 39 to 50px. space-between equalises the gaps and still pins
  // the first and last label to the row's edges.
  assert.ok(/justify-content:space-between[^}]*\}/.test(client), 'the ruler distributes its labels')
  assert.ok(/\.td-heat-months\{display:flex/.test(client), 'and is a flex row')
  // The evenly respaced columns are no longer needed.
  assert.ok(!/month\.at = first \+ index \* step/.test(client), 'no manual respacing remains')
})

test('the generation rate drops implausible samples', () => {
  // A corrupted decode window must not print an impossible number. The host
  // drops per-call samples above its ceiling and the page guards the aggregate.
  assert.ok(/MAX_CREDIBLE_TPS = 250/.test(index), 'the host has a ceiling')
  assert.ok(/MIN_DECODE_MS = 250/.test(index), 'the host has a floor')
  assert.ok(/rawRate <= MAX_CREDIBLE_TPS/.test(client), 'the page guards the aggregate')
})

test('reasoning tokens are folded and carried to the page', () => {
  // The value is recorded in the log and is a real cost driver on these models.
  assert.ok(/reasoning: count\(usage\.reasoningTokens\)/.test(index), 'the fold reads it')
  assert.ok(/addColumn\('calls', 'reasoning'/.test(index), 'the ledger stores it')
  assert.ok(/bucket\[15\] \+= group\.reasoning/.test(index), 'the payload carries it')
})

test('the first card shows one estimated cost', () => {
  // The billed / plan-value split was detail nobody asked for at this level.
  assert.ok(/t\('estimate'\)/.test(client), 'one label')
  assert.ok(!/planValue/.test(client), 'no plan-value split')
  assert.ok(!/td-stat-cost-alt/.test(client), 'no second amount')
})

test('the ranking header counts the rows it draws', () => {
  // The header said 10 while the list drew 8: one read the total, the other a
  // slice literal. Both read the same constant now.
  assert.ok(/const MODEL_ROWS = 10/.test(client), 'one constant for the model count')
  assert.ok(/String\(MODEL_ROWS\)/.test(client), 'the header reads it')
  assert.ok(/slice\(0, MODEL_ROWS\)/.test(client), 'the list reads it')
  assert.ok(/String\(PROJECT_ROWS\)/.test(client), 'the project header reads its constant')
  assert.ok(/slice\(0, PROJECT_ROWS\)/.test(client), 'the project list reads it')
})

test('the top-three block is gone', () => {
  // It repeated rows 1-3 of the list immediately below it.
  assert.ok(!/td-podium/.test(client), 'no podium block')
})

test('a saved profile survives a remount', () => {
  // The store kept its first read forever, and a save updated only the section's
  // own state. Closing and reopening Settings therefore showed the old value and
  // the picture appeared to vanish.
  assert.ok(/put\(next\)/.test(client), 'the store accepts a saved value')
  assert.ok(/avatarRef\.current\?\.put\?\.\(stored\)/.test(client), 'a save writes through the store')
  assert.ok(/avatar\.reload\?\.\(\)/.test(client), 'a remount re-reads from disk')
  // The × beside the picture was removed: replacing it is the same click.
  assert.ok(!/td-avatar-clear/.test(client), 'no clear button beside the picture')
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

test('the section opens on the daily range', () => {
  // "进去后默认应该是每日的视图" — the first paint shows today, not a week.
  assert.ok(/const \[rangeId, setRangeId\] = useState\('1d'\)/.test(client),
    'the default range is the daily preset')
  assert.ok(/ranges\.find\(item => item\.id === rangeId\) \?\? ranges\[0\]/.test(client),
    'an unknown range falls back to the first preset, which is daily')
})

test('every host request goes through the shared helper', () => {
  // The helper adds the deadline and the unmount abort. A bare `fetch` here
  // would spin forever when the host stops answering.
  const calls = client.match(/await fetch\(/g) ?? []
  assert.equal(calls.length, 1, 'only the helper itself calls fetch')
  assert.ok(/async function postJSON\(url, payload, signal\)/.test(client), 'the helper exists')
  assert.ok(/REQUEST_TIMEOUT_MS = 20_000/.test(client), 'the request has a deadline')
  assert.ok(/controller\.abort\(\)/.test(client), 'the request can be aborted')
})

test('the dead share ring is gone', () => {
  // The ring chart stopped rendering in 1.1.x; the component and its keyframes
  // stayed behind and read like live code.
  assert.ok(!/function Ring\(/.test(client), 'no Ring component')
  assert.ok(!/td-ring/.test(client), 'no ring styles or keyframes')
  assert.ok(!/td-profile/.test(client), 'no profile-panel styles')
  assert.ok(!/td-delta/.test(client), 'no delta badge styles')
})

test('the payload column count matches the host row', () => {
  // The constants are hand-written on both sides; a drift silently reads the
  // wrong column instead of failing.
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const zeros = host.match(/const bucket = buckets\.get\(id\) \?\? \[\.\.\.row, ((?:0, )*0)\]/)
  assert.ok(zeros, 'the host row is initialised from the key columns')
  const width = 3 + zeros[1].split(',').length
  assert.equal(width, 16, 'the host sends 16 columns')
  const last = client.match(/const REASONING = (\d+)/)
  assert.equal(Number(last?.[1]), width - 1, 'the client reads the last column by the same index')
  assert.ok(!/meteredCost/.test(client), 'the client no longer reads the retired column')
})

test('the rate card says how much of the range it covers', () => {
  // Only a small slice of real calls has a usable decode window, so the figure
  // is not a whole-range average and must say so.
  assert.ok(/t\('rateSample', \{ share: timedShare \}\)/.test(client), 'the coverage share is shown')
  assert.ok(/t\('rateHint'/.test(client), 'the cell explains the discarded samples')
  assert.ok(/total\.timedCalls/.test(client), 'the count comes from the payload')
})

test('the share card is one 4:5 picture drawn locally', () => {
  // The picture is a designed artefact, not a screenshot, and nothing leaves
  // the machine: no new route, no third-party renderer.
  assert.ok(/const SHARE_WIDTH = 1080/.test(client), 'the card is 1080 wide')
  assert.ok(/const SHARE_HEIGHT = 1350/.test(client), 'and 1350 tall, which is 4:5')
  assert.ok(/function drawShare\(canvas, \{/.test(client), 'one function draws it')
  assert.ok(!/import\s/.test(client), 'the browser half has no imports')
  assert.ok(!/html2canvas|foreignObject/.test(client), 'no third-party rasteriser and no SVG detour')
})

test('the share card and the panel draw the same year', () => {
  // A picture that disagrees with the panel it came from is worse than no picture.
  assert.ok(/band: yearBand\(heatDays, uiLocale\)/.test(client), 'the card builds the band the same way')
  assert.ok(/heatLevel\(day\.tokens, band\.peak\)/.test(client), 'and colours cells with the same rule')
})

test('the share card reads the live theme instead of a fixed palette', () => {
  // A canvas cannot parse `color-mix()`, so each colour is resolved by painting
  // one pixel and reading it back — that is also what makes it follow the theme.
  assert.ok(/function shareColours\(host\)/.test(client), 'colours come from the host element')
  assert.ok(/getComputedStyle\(host\)/.test(client), 'read from computed style')
  assert.ok(/fillRect\(0, 0, 1, 1\)/.test(client), 'resolved through a one-pixel probe')
  assert.ok(/function markColour\(hex, colours\)/.test(client), 'a mark keeps contrast on either theme')
})

test('the share card can be copied and saved, and says when copying fails', () => {
  assert.ok(/new ClipboardItem\(\{ 'image\/png': blob \}\)/.test(client), 'copy puts a PNG on the clipboard')
  assert.ok(/anchor\.download = `token-usage-\$\{data\.stamp\}\.png`/.test(client), 'download names the file')
  assert.ok(/t\('shareCopyFailed'\)/.test(client), 'a failed copy is reported, not silent')
  assert.ok(/URL\.revokeObjectURL\(url\)/.test(client), 'the blob URL is released')
})

test('the share card only shows what the range actually contains', () => {
  // "18.9B" without a range reads as all time; the card states the range.
  assert.ok(/rangeText: rangeLabel\(rangeId, t\)/.test(client), 'the range travels with the picture')
  assert.ok(/\$\{labels\.tokens\} · \$\{rangeText\}/.test(client), 'and is drawn beside the token total')
})
