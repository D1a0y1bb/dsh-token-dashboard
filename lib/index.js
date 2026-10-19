/**
 * Token usage dashboard — host half.
 *
 * The dashboard reads the same source DSH's own token accounting reads: the
 * durable Session logs. It walks every Session's `assistant/message` /
 * `assistant/attempt` and `compaction/summary` events, folds them into one row
 * per billed call, and aggregates those rows by hour, by model, and by project.
 *
 * The fold mirrors `@deepseek-ai/dsh-token-meter`'s `tokenUsage` projection: a
 * later sample of one attempt replaces the earlier one, and `llm/retry-started`
 * begins a new attempt. It does not import the token-meter package, so this
 * plugin keeps working when that package is absent, and it does not depend on
 * any other third-party plugin.
 *
 * Aggregated rows are cached in a small SQLite file under DSH_HOME so a page
 * load does not rescan every Session. Deleting the file is safe: it is rebuilt
 * from the Session logs.
 */

import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createZstdDecompress as zstdCreateDecompress } from 'node:zlib'

import { costOf as priceCostOf, FALLBACK, resolvePrice, SUBSCRIPTION_PROVIDERS } from './pricing.js'

// Version 6 adds `session_meta`, the Session title and working directory the
// drill-down needs, so a version 5 ledger rebuilds once to fill it in.
// Version 5 reads the current Session log generation, counts
// `compaction/summary` usage, and stores its read offset per Session so a scan
// decodes only appended frames. Version 4 read a fixed `session.v4` filename
// and never counted compaction.
const LEDGER_VERSION = 6
const PAGE_MESSAGES = 400
const PAGE_TIMEOUT_MS = 20_000
const SCAN_TIMEOUT_MS = 180_000
const SCAN_PARALLEL = 4
const RESCAN_AFTER_MS = 5_000
/**
 * How often the aggregated payload may be rebuilt while the ledger is changing.
 *
 * A rebuild re-runs the grouping query and is the expensive part of one page
 * request. On a cold scan every commit changes the ledger, so rebuilding on
 * every poll would spend the whole aggregation again and again — measured at
 * 34 ms on the first poll, rising to 72 ms as the ledger filled. Serving the
 * last build until this window passes keeps every poll cheap and still moves the
 * page forward visibly.
 */
const VIEW_REBUILD_MS = 1_500
/** Decoded bytes one turn may produce before the decoder pauses for the host. */
const DECODE_SLICE_BYTES = 2 << 20
/** Bytes of one decoded frame one turn may split into lines before yielding. */
const EMIT_SLICE_BYTES = 1024 * 1024
/** Rowid ranges one aggregate read is split into, so each stays a few ms. */
const AGGREGATE_CHUNKS = 10
/** Calls are summed per quarter hour, which every time zone offset divides. */
const SLOT_MS = 15 * 60_000
const ROUTE = '/api/token-dashboard'
/** The drill-down route: sessions behind one project or model in one range. */
const DETAIL_ROUTE = '/api/token-dashboard/sessions'
/** The signed-in account picture, proxied so the page needs no account service. */
const AVATAR_ROUTE = '/api/token-dashboard/avatar'
/** Where the user's own dashboard picture is stored (a small JSON data URL). */
const AVATAR_FILE_NAME = 'avatar.json'
/**
 * The running Host's version, for calls that require a client identity.
 *
 * The account service accepts any non-empty string, but naming the real build
 * keeps its logs honest. Read once; a failure falls back to the plugin version.
 */
const HOST_VERSION = '0.2.1-rc.2'

/**
 * One Session log path per format generation, newest first.
 *
 * DSH writes one immutable file per Session format version and keeps the older
 * file after a migration. A Session that has never been opened again is still
 * on v3, so both must be read. The generation is part of the file name, so this
 * list is how a scan finds the newest log a Session has.
 */
const LOG_NAMES = [
  'session.v4.jsonl.zstd',
  'session.v3.jsonl.zstd',
  'session.v2.jsonl.zstd',
  'session.v1.jsonl.zstd',
  'session.jsonl.zstd',
  'session.v4.jsonl',
  'session.v3.jsonl',
  'session.v2.jsonl',
  'session.v1.jsonl',
  'session.jsonl',
]

const count = value => (Number.isSafeInteger(value) && value > 0 ? value : 0)

/** The usage chunk of an attempt's stream, if it carries one. */
function usageChunk(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage
  }
  return undefined
}

const tokensOf = usage => ({
  input: count(usage.inputTokens),
  cacheRead: count(usage.cacheReadTokens),
  cacheWrite: count(usage.cacheWriteTokens),
  output: count(usage.outputTokens),
})

/**
 * Fold Session events, oldest first, into one row per billed call.
 *
 * A row is either one model attempt (`kind: 'turn'`) or one compaction summary
 * request (`kind: 'compact'`). Both are billed calls; the kind lets the page
 * show how much of a total came from compaction.
 *
 * @param events - Session events in ascending sequence order.
 * @param from - fold state carried over from an earlier read of the same log.
 * @returns the call rows, the carry-over state, and whether a fork cut was seen.
 */
export function foldCalls(events, from = {}) {
  const state = { provider: from.provider ?? '', model: from.model ?? '', retry: from.retry ?? null, title: from.title ?? '' }
  const rows = new Map()
  let reset = false
  for (const event of events) {
    const data = event?.data ?? {}
    switch (event?.type) {
      case 'request/header': {
        const config = data.header?.config
        if (config?.provider && config?.model) Object.assign(state, { provider: config.provider, model: config.model })
        break
      }
      case 'request/context':
        if (data.provider && data.model) Object.assign(state, { provider: data.provider, model: data.model })
        break
      case 'llm/retry-started':
        state.retry = state.retry?.turn === data.turn && state.retry.step === data.step
          ? { ...state.retry, count: state.retry.count + 1 }
          : { turn: data.turn, step: data.step, count: 1 }
        break
      case 'session/end-seed':
        // A fork's events up to its inherited cut belong to the parent.
        if (data.inherited === true) {
          rows.clear()
          reset = true
        }
        break
      case 'compaction/summary': {
        if (data.usage === undefined || data.usage === null) break
        // `seq` is the stable identity of one summary event, so a rescan of the
        // same log rewrites the same row instead of adding to it.
        const key = Number.isSafeInteger(event.seq) ? `c${event.seq}` : `c${data.compactionId ?? rows.size}`
        rows.set(key, {
          key,
          kind: 'compact',
          time: Number.isFinite(event.time) ? event.time : 0,
          provider: typeof data.provider === 'string' && data.provider !== '' ? data.provider : state.provider,
          model: typeof data.model === 'string' && data.model !== '' ? data.model : state.model,
          ...tokensOf(data.usage),
        })
        break
      }
      case 'session/title':
        if (typeof data.title === 'string' && data.title.trim() !== '') state.title = data.title.trim()
        break
      case 'assistant/message':
      case 'assistant/attempt': {
        const usage = (event.type === 'assistant/message' ? data.usage : undefined) ?? usageChunk(data.stream)
        if (usage === undefined || usage === null) break
        const attempt = state.retry?.turn === data.turn && state.retry.step === data.step ? state.retry.count : 0
        const key = `${data.turn}:${data.step}:${attempt}`
        rows.set(key, {
          key,
          kind: 'turn',
          time: Number.isFinite(event.time) ? event.time : 0,
          provider: state.provider,
          model: state.model,
          ...tokensOf(usage),
        })
        break
      }
      default:
        break
    }
  }
  return { rows: [...rows.values()], state, reset }
}

/**
 * A SQLite-backed ledger of per-call usage rows.
 *
 * One row is one billed call, keyed by `session#turn:step:attempt` for a model
 * attempt and `session#c<seq>` for a compaction request, so a commit is
 * idempotent: rescanning a Session rewrites the same keys instead of adding to
 * them, and a scan that reads only new events cannot lose the rows an earlier
 * scan wrote for the same time slot. Aggregation happens at read time.
 *
 * Everything here is derived data: `marks` records how far each Session log was
 * read and the byte offset the next read starts at, so a rescan decodes only
 * what was appended. Deleting the database rebuilds it from the Session logs.
 */
function sqliteLedger(DatabaseSync, path, onWrite = () => {}) {
  const db = new DatabaseSync(path)
  // A cold scan commits once per Session, and the default rollback journal makes
  // each commit an fsync: 365 ms for 705 transactions against 78 ms in WAL. This
  // database has one writer (the scan) and short readers (the page), which is
  // the shape WAL is for.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calls (
      key TEXT PRIMARY KEY, session TEXT NOT NULL, time INTEGER NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'turn',
      input INTEGER NOT NULL, cache_read INTEGER NOT NULL,
      cache_write INTEGER NOT NULL, output INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS calls_session ON calls (session);
    CREATE TABLE IF NOT EXISTS marks (
      session TEXT PRIMARY KEY, through INTEGER NOT NULL, fold TEXT NOT NULL,
      updated INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
      file TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS projects (session TEXT PRIMARY KEY, project TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS session_meta (
      session TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    );
  `)
  // These columns were added after the first release; an old table lacks them.
  const addColumn = (table, column, declaration) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
  }
  addColumn('marks', 'updated', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('marks', 'bytes', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('marks', 'file', "TEXT NOT NULL DEFAULT ''")
  addColumn('calls', 'kind', "TEXT NOT NULL DEFAULT 'turn'")

  const version = db.prepare('SELECT value FROM meta WHERE key = ?').get('version')
  if (version === undefined) {
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('version', String(LEDGER_VERSION))
  } else if (Number(version.value) !== LEDGER_VERSION) {
    // A shape change invalidates the derived rows; the logs are the source of truth.
    db.exec('DELETE FROM calls; DELETE FROM marks; DELETE FROM projects;')
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('version', String(LEDGER_VERSION))
  }

  const putCall = db.prepare(`
    INSERT INTO calls (key, session, time, provider, model, kind, input, cache_read, cache_write, output)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET
      time = excluded.time, provider = excluded.provider, model = excluded.model,
      kind = excluded.kind, input = excluded.input, cache_read = excluded.cache_read,
      cache_write = excluded.cache_write, output = excluded.output
  `)
  const dropSession = db.prepare('DELETE FROM calls WHERE session = ?')
  const getMark = db.prepare('SELECT through, fold, updated, bytes, file FROM marks WHERE session = ?')
  const setMark = db.prepare(`
    INSERT OR REPLACE INTO marks (session, through, fold, updated, bytes, file)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const putProject = db.prepare('INSERT OR REPLACE INTO projects (session, project) VALUES (?, ?)')
  const putSessionMeta = db.prepare(`
    INSERT INTO session_meta (session, title, cwd, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (session) DO UPDATE SET
      title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE session_meta.title END,
      cwd = CASE WHEN excluded.cwd <> '' THEN excluded.cwd ELSE session_meta.cwd END,
      created_at = CASE WHEN excluded.created_at > 0 THEN excluded.created_at ELSE session_meta.created_at END
  `)
  const dropSessionMeta = db.prepare('DELETE FROM session_meta WHERE session = ?')
  const allSessionMeta = db.prepare('SELECT session, title, cwd, created_at FROM session_meta')
  /**
   * The heaviest Sessions in one slice of the range.
   *
   * This is the drill-down query: the page already knows the time range, and it
   * narrows by project or model by passing their index, so the ledger answers one
   * ordered list of Sessions instead of the whole per-call table.
   */
  const sessionsBase = `
    SELECT c.session, c.provider, c.model,
           SUM(c.input) AS input, SUM(c.cache_read) AS cacheRead,
           SUM(c.cache_write) AS cacheWrite, SUM(c.output) AS output, COUNT(*) AS calls
    FROM calls c
    JOIN projects p ON p.session = c.session
    WHERE c.time >= ? AND c.time < ?
  `
  const sessionsOrdered = ` GROUP BY c.session, c.provider, c.model
    ORDER BY (SUM(c.input) + SUM(c.cache_read) + SUM(c.cache_write) + SUM(c.output)) DESC`
  const sessionsInRange = db.prepare(`${sessionsBase}${sessionsOrdered}`)
  const sessionsOfProject = db.prepare(`${sessionsBase} AND p.project = ?${sessionsOrdered}`)
  const sessionsOfRoute = db.prepare(`${sessionsBase} AND c.provider = ? AND c.model = ?${sessionsOrdered}`)
  const allProjects = db.prepare('SELECT session, project FROM projects')
  /**
   * Every Session's read state: how far it was read, the log time it was read
   * at, and the byte offset the next read starts at.
   */
  const allMarks = db.prepare('SELECT session, through, updated, bytes FROM marks')
  // One aggregate per Session, model, kind, and quarter hour, summed at read time.
  /**
   * One page of the aggregate, over a rowid range.
   *
   * Chunked by rowid rather than run as one query: the full grouping needs about
   * 65 ms, which is four dropped frames, and it holds the database so the scan's
   * own commit waits behind it. Ten ranges cost about the same in total and no
   * single page blocks longer than 6 ms.
   */
  const groupedRange = db.prepare(`
    SELECT session, provider, model, kind, time / ${SLOT_MS} AS slot,
           SUM(input) AS input, SUM(cache_read) AS cacheRead,
           SUM(cache_write) AS cacheWrite, SUM(output) AS output, COUNT(*) AS calls
    FROM calls WHERE rowid >= ? AND rowid < ?
    GROUP BY session, provider, model, kind, slot
  `)
  const callBounds = db.prepare('SELECT MIN(rowid) AS low, MAX(rowid) AS high FROM calls')

  return {
    mark: session => {
      const row = getMark.get(session)
      if (row === undefined) return undefined
      let fold
      try {
        fold = JSON.parse(row.fold)
      } catch {
        return undefined
      }
      return { through: row.through, fold, updated: row.updated, bytes: row.bytes, file: row.file }
    },
    /** Each Session's read state, for the per-Session skip test. */
    marks() {
      return new Map(allMarks.all().map(row => [row.session, { through: row.through, updated: row.updated, bytes: row.bytes }]))
    },
    commit(session, { rows, reset, mark }) {
      db.exec('BEGIN')
      try {
        if (reset) dropSession.run(session)
        for (const row of rows) putCall.run(
          `${session}#${row.key}`, session, row.time, row.provider, row.model, row.kind ?? 'turn',
          row.input, row.cacheRead, row.cacheWrite, row.output,
        )
        setMark.run(session, mark.through, JSON.stringify(mark.fold), mark.updated ?? Date.now(), mark.bytes ?? 0, mark.file ?? '')
        // The title travels in the fold state, so an incremental read still
        // stores the newest one without re-reading the log's start.
        const fold = mark.fold ?? {}
        putSessionMeta.run(
          session,
          typeof fold.title === 'string' ? fold.title : '',
          typeof mark.cwd === 'string' ? mark.cwd : '',
          Number.isFinite(mark.createdAt) ? mark.createdAt : 0,
        )
        db.exec('COMMIT')
        onWrite()
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    setProject(session, project) {
      putProject.run(session, project)
      onWrite()
    },
    projects() {
      return new Map(allProjects.all().map(row => [row.session, row.project]))
    },
    /** Every Session's display name and working directory. */
    sessionMeta() {
      return new Map(allSessionMeta.all().map(row => [row.session, {
        title: row.title,
        cwd: row.cwd,
        createdAt: row.created_at,
      }]))
    },
    /**
     * The heaviest Sessions inside one time range, optionally narrowed to one
     * project label or one provider/model route.
     *
     * The query returns one row per Session **and route**, because cost depends
     * on the route: a Session that switched models must be priced in two parts.
     * The caller merges the slices it wants and prices each one.
     *
     * @param from - inclusive epoch milliseconds.
     * @param to - exclusive epoch milliseconds.
     * @param limit - how many Sessions' worth of slices to fetch.
     * @param facet - `{ project }` or `{ provider, model }`, or nothing.
     * @returns per-Session, per-route counters, heaviest first.
     */
    topSessionSlices(from, to, limit, facet = undefined) {
      const rows = facet?.project !== undefined
        ? sessionsOfProject.all(from, to, facet.project)
        : facet?.provider !== undefined && facet?.model !== undefined
          ? sessionsOfRoute.all(from, to, facet.provider, facet.model)
          : sessionsInRange.all(from, to)
      return rows.map(row => ({
        session: row.session,
        provider: row.provider,
        model: row.model,
        input: row.input,
        cacheRead: row.cacheRead,
        cacheWrite: row.cacheWrite,
        output: row.output,
        calls: row.calls,
      }))
    },
    /**
     * Delete every derived row that names a Session the disk no longer holds.
     *
     * A Session directory can be removed outside DSH — an archive cleanup, a
     * manual delete, a restored backup — and its rows would otherwise stay in
     * the ledger forever, inflating every total. The walk that builds the log
     * index already knows the live set, so one pass here keeps the ledger equal
     * to the Sessions that exist.
     *
     * @param live - the Session ids present on disk.
     * @returns how many Sessions were forgotten.
     */
    forgetSessions(live) {
      const stale = db.prepare('SELECT session FROM marks').all()
        .map(row => row.session)
        .filter(session => !live.has(session))
      if (stale.length === 0) return 0
      const dropCalls = db.prepare('DELETE FROM calls WHERE session = ?')
      const dropMark = db.prepare('DELETE FROM marks WHERE session = ?')
      const dropProject = db.prepare('DELETE FROM projects WHERE session = ?')
      db.exec('BEGIN')
      try {
        for (const session of stale) {
          dropCalls.run(session)
          dropMark.run(session)
          dropProject.run(session)
          dropSessionMeta.run(session)
        }
        db.exec('COMMIT')
        onWrite()
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return stale.length
    },
    /**
     * The aggregate, in pages, yielding the host between them.
     *
     * @returns one array of groups, in the same shape a single query would give.
     */
    async groups() {
      const bounds = callBounds.get()
      const out = []
      if (bounds?.low === null || bounds?.high === null) return out
      const span = bounds.high - bounds.low + 1
      const step = Math.max(1, Math.ceil(span / AGGREGATE_CHUNKS))
      for (let low = bounds.low; low <= bounds.high; low += step) {
        for (const row of groupedRange.all(low, low + step)) {
          out.push({
            session: row.session,
            provider: row.provider,
            model: row.model,
            kind: row.kind,
            slot: row.slot,
            input: row.input,
            cacheRead: row.cacheRead,
            cacheWrite: row.cacheWrite,
            output: row.output,
            calls: row.calls,
          })
        }
        // A macrotask boundary, so the scan's next commit can run between pages.
        await new Promise(resolve => setImmediate(resolve))
      }
      return out
    },
    close() {
      db.close()
    },
  }
}

const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])

/**
 * Event types the fold reads. A log line of any other type is skipped before
 * `JSON.parse`, which is what keeps a cold scan affordable: most of a Session
 * log is tool results and assistant message bodies, and parsing those only to
 * discard them costs seconds and holds gigabytes of temporary objects.
 */
const WANTED_TYPES = new Set([
  'session',
  'assistant/message',
  'assistant/attempt',
  'compaction/summary',
  'request/header',
  'request/context',
  'llm/retry-started',
  'session/end-seed',
  // Not a billed call, but the only place a Session's display name appears.
  'session/title',
])

/**
 * Whether one serialized event line carries a type the fold reads.
 *
 * Every line DSH writes starts with `{"type":"<name>"`, so the name is read
 * from a fixed offset without parsing. The check is deliberately conservative:
 * a line it cannot classify is parsed, so a shape change undercounts nothing.
 *
 * @param line - one JSONL line without its newline.
 * @returns true when the line must be parsed.
 */
function wantedLine(line) {
  if (line.charCodeAt(0) !== 0x7B) return true
  if (line.startsWith('{"type":"') !== true) return true
  const close = line.indexOf('"', 9)
  if (close < 0) return true
  return WANTED_TYPES.has(line.slice(9, close))
}

/** Positions of every zstd frame start in one buffer. */
function frameStarts(raw) {
  const starts = []
  for (let at = raw.indexOf(MAGIC); at !== -1; at = raw.indexOf(MAGIC, at + 4)) starts.push(at)
  return starts
}

/**
 * Decode one frame, handing the host event loop its turn between output chunks.
 *
 * A zstd frame is not random-access, so a 1.9 MB frame cannot be split across
 * calls. It can be streamed, though: the decoder emits 16 KB chunks, and each
 * chunk arrives in its own turn of the event loop. One frame that decodes to
 * 10.8 MB would otherwise block the main thread for about 12 ms at once;
 * streaming bounds any single blocking slice to splitting one 16 KB chunk.
 *
 * @param buffer - one complete frame.
 * @returns the decoded bytes.
 */
async function decodeFrame(buffer) {
  const decoder = zstdCreateDecompress()
  const parts = []
  let total = 0
  await new Promise((resolve, reject) => {
    decoder.on('data', (chunk) => {
      parts.push(chunk)
      total += chunk.length
      // Pausing here is what makes the decode yield. Without it the decoder
      // keeps producing while `data` handlers run, and the whole frame's chunks
      // land in one turn: measured at 1141 ms of blocked host for the largest
      // Session. Resuming from an immediate runs the next chunk in a later turn.
      if (total >= DECODE_SLICE_BYTES) {
        decoder.pause()
        total = 0
        setImmediate(() => decoder.resume())
      }
    })
    decoder.on('error', reject)
    decoder.on('end', resolve)
    decoder.end(buffer)
  })
  return parts.length === 1 ? parts[0] : Buffer.concat(parts)
}

/**
 * Walk the complete JSONL lines of a Session log, yielding to the event loop.
 *
 * DSH appends one zstd frame per write, so the file holds many concatenated
 * frames — thousands for an active Session, and one frame can decode to ten
 * megabytes. `zstdDecompressSync` stops after the first frame and would return
 * a fraction of the log, and decoding every frame on the main thread blocks the
 * host for as long as the largest Session takes: measured at 171 ms for one
 * 9.7 MB log.
 *
 * So every frame is decoded in the thread pool. Only the line splitting stays
 * on the main thread, and it is bounded by one frame's decoded size, not by the
 * whole log. The awaiting frame boundary is where the event loop gets its turn.
 *
 * A frame is consumed only once the text decoded so far ends at a line
 * boundary. A Session that is being written can leave a torn trailing frame;
 * leaving those frames unconsumed means the next read decodes them again, so a
 * partial line is never parsed and no line is emitted twice.
 *
 * @param raw - the bytes to decode.
 * @param onLine - receives each complete line, without its newline.
 * @param signal - optional cancellation, checked between frames.
 * @returns how many bytes were consumed, always on a frame boundary.
 */
async function readLogLines(raw, onLine, signal) {
  const starts = frameStarts(raw)
  if (starts.length === 0) {
    // Not a zstd container: an uncompressed log, or a single unframed write.
    let chunk
    try {
      chunk = await decodeFrame(raw)
    } catch {
      chunk = raw
    }
    if (chunk.length === 0 || chunk[chunk.length - 1] !== 0x0A) return 0
    await emitLines(chunk, onLine)
    return raw.length
  }
  let pending = undefined
  let consumed = 0
  for (let index = 0; index < starts.length; index += 1) {
    signal?.throwIfAborted()
    const start = starts[index]
    const end = index + 1 < starts.length ? starts[index + 1] : raw.length
    let chunk
    try {
      chunk = await decodeFrame(raw.subarray(start, end))
    } catch {
      // A torn trailing frame is normal while a Session is being written.
      break
    }
    pending = pending === undefined ? chunk : Buffer.concat([pending, chunk])
    if (pending.length === 0) continue
    if (pending[pending.length - 1] === 0x0A) {
      await emitLines(pending, onLine)
      pending = undefined
      consumed = end
    }
  }
  // `pending` may still hold complete lines followed by a partial one. Emitting
  // them would duplicate them on the next read, so they are dropped with the
  // bytes that produced them.
  return consumed
}

/**
 * Hand every newline-terminated line of one buffer to `onLine`, yielding inside
 * a large frame.
 *
 * One frame can decode to ten megabytes, and the `toString` plus `JSON.parse`
 * per line is the remaining main-thread work in a scan: measured at 43 ms for a
 * single frame, which is three dropped frames of a 60 Hz UI. The budget below
 * bounds it, and the `setImmediate` is the macrotask boundary that lets the
 * host's timers and sockets run.
 *
 * @param buffer - decoded bytes, ending at a newline.
 * @param onLine - receives each line without its newline.
 */
async function emitLines(buffer, onLine) {
  let from = 0
  let budget = EMIT_SLICE_BYTES
  for (;;) {
    const at = buffer.indexOf(0x0A, from)
    if (at === -1) return
    if (at > from) onLine(buffer.toString('utf8', from, at))
    budget -= at + 1 - from
    from = at + 1
    if (budget <= 0) {
      budget = EMIT_SLICE_BYTES
      await new Promise(resolve => setImmediate(resolve))
    }
  }
}

/**
 * Decode a Session project directory name back to a working directory.
 *
 * DSH names the directory `--<cwd with separators as dashes>--`, escaping each
 * character outside `[A-Za-z0-9._-]` as `~XXXX` with its hex code point, and
 * collapsing a run of separators into one dash. A dash inside a path segment is
 * escaped (`~002D`), so the remaining dashes are separators.
 *
 * This is the fallback label. The Session header carries the exact `cwd`, so a
 * normal read uses that instead of this lossy decode.
 *
 * @param name - the directory name, for example `--Users-me-Desktop-~56FD--`.
 * @returns the working directory, or the name unchanged when it does not fit.
 */
function decodeDirName(name) {
  if (!name.startsWith('--') || !name.endsWith('--')) return name
  const body = name.slice(2, -2)
  const segments = body.split('-').map(part =>
    part.replace(/~([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))))
  return `/${segments.join('/')}`
}

/** Local-time hour key `YYYY-MM-DDTHH` for an instant, in the given zone. */
function hourKeyer(timeZone) {
  let format
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
  } catch {
    format = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
  }
  return (time) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(time)).map(part => [part.type, part.value]))
    // `hour12: false` can render midnight as `24` in some ICU builds.
    const hour = parts.hour === '24' ? '00' : parts.hour
    return `${parts.year}-${parts.month}-${parts.day}T${hour}`
  }
}

/** Run `worker` over `items`, at most `limit` at a time. */
async function eachLimited(items, limit, worker) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift()
      if (next === undefined) return
      await worker(next)
      // One macrotask boundary per item: the scan runs four workers, and
      // without this they take turns back to back and the host waits for the
      // whole batch. `await` alone would only drain microtasks.
      await new Promise(resolve => setImmediate(resolve))
    }
  })
  await Promise.all(runners)
}

export const name = 'dsh-token-dashboard'

/**
 * Host services to mount before `apply` runs.
 *
 * `sessionController` serves a Session whose log this plugin cannot find;
 * `connection` registers the browser route. `llm` is optional — it only supplies
 * display names — so it is read through `ctx.llm?.` instead of being injected.
 */
export const inject = ['sessionController', 'connection']

/**
 * Host half of the dashboard.
 *
 * @param ctx - the plugin context.
 * @param config - the row's config.
 */
export function apply(ctx, config = {}) {
  const home = config.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dbPath = config.database ?? join(home, 'token-dashboard', 'usage.sqlite')
  /** The uploaded dashboard picture, stored next to the ledger. */
  const avatarFile = join(dirname(dbPath), AVATAR_FILE_NAME)
  const sessionsDir = config.sessions ?? join(home, 'sessions')
  /** USD per million tokens, per `provider/model`; merged over DEFAULT_PRICES. */
  const prices = { ...(config.prices ?? {}) }

  let DatabaseSync
  let ledger
  let ledgerFailed = false
  let scanning
  let scannedAt = 0
  /** Progress of the running scan: `{ total, pending }`. */
  let scanned = null
  /** Set once the ledger holds a completed pass, so the page can trust it. */
  let primed = false
  /** Session id to log path, working directory, and file time, built on first read. */
  let logIndex
  /**
   * Bumped on every ledger write by `revision`. The aggregated payload is
   * rebuilt only when this changes, because the grouping query alone costs
   * about 65 ms over 70k rows: a page that polls every 1.2 s would otherwise
   * block the host for that long on every poll.
   */
  let revision = 0
  /**
   * The revision the cached payload was built from. It differs from `revision`
   * while a cold scan commits: rebuilding on every commit would make each poll
   * pay the whole aggregation again, and the cost grows as the ledger fills.
   * A rebuild therefore happens only past `VIEW_REBUILD_MS`, and the page sees
   * the in-flight data move in steps instead of on every commit.
   */
  let builtRevision = -1
  let builtAt = 0
  /** Last built payload, keyed by the zone that formatted its hour columns. */
  let cachedView

  async function openLedger() {
    if (ledger !== undefined) return ledger
    if (ledgerFailed) return undefined
    try {
      if (DatabaseSync === undefined) ({ DatabaseSync } = await import('node:sqlite'))
      await mkdir(dirname(dbPath), { recursive: true })
      ledger = sqliteLedger(DatabaseSync, dbPath, () => { revision += 1; cachedView = undefined })
      return ledger
    } catch (error) {
      // The dashboard still works without the cache; it just rescans every time.
      ledgerFailed = true
      ctx.logger?.warn?.('token-dashboard: cache unavailable, rescanning instead: %s', error?.message ?? error)
      return undefined
    }
  }

  /** The project label of a Session: its working directory, or `(unknown)`. */
  const projectOf = item => {
    const cwd = typeof item?.cwd === 'string' && item.cwd !== '' ? item.cwd : undefined
    if (cwd === undefined) return '(unknown)'
    const parts = cwd.split('/').filter(Boolean)
    return parts.length === 0 ? '/' : parts[parts.length - 1]
  }

  /**
   * Map every Session id on disk to its newest log path and file time.
   *
   * One walk covers the whole history, so a per-Session disk read is a map hit
   * rather than another scan of the directory tree. Each Session is probed for
   * the newest generation it has: a Session that was never opened again is
   * still on v3, and one that was migrated has a v4 file beside it.
   *
   * @returns the index, keyed by Session id.
   */
  async function buildLogIndex() {
    const index = new Map()
    // Whether the walk saw every directory it should have. The prune of
    // vanished Sessions trusts this: a partial walk must never look like a
    // deletion, or a permission error would erase live usage.
    let complete = true
    let dirs
    try {
      dirs = await readdir(sessionsDir)
    } catch {
      complete = false
      dirs = []
    }
    for (const dir of dirs) {
      let sessions
      try {
        sessions = await readdir(join(sessionsDir, dir))
      } catch {
        complete = false
        continue
      }
      for (const sessionId of sessions) {
        const base = join(sessionsDir, dir, sessionId)
        for (const candidate of LOG_NAMES) {
          const file = join(base, candidate)
          let info
          try {
            info = await stat(file)
          } catch {
            continue
          }
          if (!info.isFile()) continue
          index.set(sessionId, {
            file,
            name: candidate,
            cwd: decodeDirName(dir),
            updatedAt: info.mtimeMs,
            size: info.size,
          })
          break
        }
      }
    }
    return { index, complete }
  }

  /**
   * Read a Session's log from disk, starting at the byte offset the ledger
   * already consumed.
   *
   * Reading only the appended frames is what keeps a warm scan cheap: an active
   * Session gains a few frames per model call, not a full re-decode of a log
   * that can hold thousands of frames. The offset is trusted only while the
   * file name and size still match the recorded mark, so a v3-to-v4 migration or
   * a truncation restarts the read instead of skipping it.
   *
   * @param sessionId - the Session id.
   * @param mark - the ledger's read state, or `undefined` for a first read.
   * @param forceFull - read from byte zero even when the mark allows a resume.
   * @returns the new events, the byte offset reached, and the header's `cwd`.
   */
  async function readLogFromDisk(sessionId, mark, forceFull = false) {
    if (logIndex === undefined) logIndex = (await buildLogIndex()).index
    const found = logIndex.get(sessionId)
    if (found === undefined) return undefined
    let handle
    try {
      handle = await open(found.file, 'r')
    } catch {
      return undefined
    }
    try {
      const info = await handle.stat()
      const size = info.size
      const resume = !forceFull
        && mark !== undefined
        && mark.file === found.name
        && Number.isSafeInteger(mark.bytes)
        && mark.bytes > 0
        && mark.bytes <= size
      const start = resume ? mark.bytes : 0
      const buffer = Buffer.alloc(size - start)
      let read = 0
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, start + read)
        if (bytesRead === 0) break
        read += bytesRead
      }
      const events = []
      const consumed = await readLogLines(buffer.subarray(0, read), (line) => {
        if (!wantedLine(line)) return
        try {
          const event = JSON.parse(line)
          if (Number.isSafeInteger(event.seq)) events.push(event)
        } catch { /* a torn last line is not fatal */ }
      })
      events.sort((a, b) => a.seq - b.seq)
      // The header line names the exact working directory; the directory name is
      // a lossy encoding of it. Only a read from byte zero sees the header.
      const header = start === 0 && events.length > 0 && events[0].type === 'session' ? events[0] : undefined
      const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : found.cwd
      return {
        events,
        cwd,
        createdAt: Number.isFinite(header?.createdAt) ? header.createdAt : 0,
        start,
        consumed: start + consumed,
        updated: info.mtimeMs,
        size,
        name: found.name,
        lastSeq: events.length > 0 ? events[events.length - 1].seq : (mark?.through ?? -1),
      }
    } finally {
      await handle.close()
    }
  }

  /**
   * Read one Session's new events and store its billed calls.
   *
   * The log on disk is the primary source: it is complete for every Session,
   * including one the controller cannot serve because it has no live Agent and
   * no warm projection cache. The controller is the fallback, for a Session
   * whose log is not where this plugin expects it.
   *
   * @returns `{ read }` when the Session was handled, `{ unresolved }` when its
   *   length could not be determined so a later scan must retry it.
   */
  async function scanSession(book, sessionId, asOfSeq, signal) {
    const mark = book?.mark(sessionId)

    // Primary: the Session log on disk.
    let onDisk = await readLogFromDisk(sessionId, mark)
    if (onDisk !== undefined) {
      let restart = mark === undefined
      let fresh = onDisk.events
      // The offset can disagree with the log when the two sources were mixed: a
      // Session first read through the controller has no byte offset, and a
      // migration replaces the file. The log is authoritative, so a gap re-reads
      // the Session from the start instead of stalling on it.
      if (!restart && fresh.length > 0 && fresh[0].seq !== mark.through + 1) {
        onDisk = await readLogFromDisk(sessionId, mark, true)
        if (onDisk === undefined) return { unresolved: true }
        restart = true
        fresh = onDisk.events
      }
      // A torn trailing frame leaves bytes unread. Keep the old file time in that
      // case, so the next scan still sees the Session as changed and retries the
      // tail instead of skipping it.
      const complete = onDisk.consumed >= onDisk.size
      const updated = complete ? onDisk.updated : (mark?.updated ?? 0)
      if (!restart && fresh.length === 0) {
        // Nothing new. Record the newer file time so the next scan can skip it.
        if (mark !== undefined && (updated !== mark.updated || onDisk.consumed !== mark.bytes)) {
          book?.commit(sessionId, {
            rows: [],
            reset: false,
            mark: { through: mark.through, fold: mark.fold, updated, bytes: onDisk.consumed, file: onDisk.name },
          })
        }
        return { read: false }
      }
      const fold = foldCalls(fresh, restart ? undefined : mark?.fold)
      book?.commit(sessionId, {
        rows: fold.rows,
        reset: restart || fold.reset,
        mark: {
          through: onDisk.lastSeq,
          fold: fold.state,
          updated,
          bytes: onDisk.consumed,
          file: onDisk.name,
          cwd: onDisk.cwd ?? '',
          createdAt: onDisk.createdAt ?? 0,
        },
      })
      if (onDisk.start === 0) book?.setProject(sessionId, projectOf({ cwd: onDisk.cwd }))
      return { read: true }
    }

    // Fallback: ask the controller, which needs a live Agent or a warm cache.
    let through = asOfSeq
    if (!Number.isSafeInteger(through)) {
      const projections = await ctx.sessionController.projections({ sessionId }, signal)
      if (projections !== null && projections !== undefined) through = projections.asOfSeq
    }
    if (!Number.isSafeInteger(through)) return { unresolved: true }
    const from = mark?.through ?? -1
    if (through <= from) return { read: false }

    const events = []
    let beforeSeq
    for (let reached = false; !reached;) {
      const page = await ctx.sessionController.page({
        address: { kind: 'session', sessionId },
        throughSeq: through,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: PAGE_MESSAGES,
      }, AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]))
      const got = page.records.map(record => record.event)
      for (let index = got.length - 1; index >= 0; index -= 1) {
        if (got[index].seq <= from) {
          reached = true
          break
        }
        events.push(got[index])
      }
      if (!page.hasMore || got.length === 0) break
      beforeSeq = got[0].seq
    }
    events.reverse()
    if (events.length > 0 && events[0].seq !== from + 1) {
      throw new Error(`token-dashboard: the history of ${sessionId} came back with a gap`)
    }

    const fold = foldCalls(events, mark?.fold)
    // The ledger stores one row per call, keyed by the Session and the call key,
    // so committing the same events twice changes nothing. No byte offset is
    // recorded: a later scan that finds the log re-reads it from the start.
    book?.commit(sessionId, {
      rows: fold.rows,
      reset: fold.reset,
      mark: { through, fold: fold.state, updated: (logIndex?.get(sessionId)?.updatedAt) ?? Date.now(), bytes: 0, file: '' },
    })
    return { read: true }
  }

  /**
   * Read every known Session's new events, and store the billed calls.
   *
   * A Session whose log has not been written since the last scan is skipped, so
   * a warm scan reads only what moved. On a first run everything is new, which
   * takes a few seconds for a large history; the page never waits for it.
   */
  /**
   * Read every Session's new events.
   *
   * @param force - ignore the rescan throttle. Set by a request that knows the
   *   ledger moved — a forwarded activity event — so the page can answer with
   *   the new usage instead of a stale snapshot.
   */
  function scan(force = false) {
    if (scanning !== undefined) return scanning
    if (!force && Date.now() - scannedAt < RESCAN_AFTER_MS) return Promise.resolve()
    const job = (async () => {
      const book = await openLedger()
      const signal = AbortSignal.timeout(SCAN_TIMEOUT_MS)

      // The session directory is the primary enumeration: it is complete, it
      // carries the log time that decides a skip, and reading it costs no RPC.
      // The index is rebuilt every scan because its modification times are what
      // the skip test compares, so a cached one would hide every later write.
      const walk = await buildLogIndex()
      logIndex = walk.index
      const targets = new Map()
      for (const [sessionId, entry] of logIndex) {
        targets.set(sessionId, { asOfSeq: undefined, updatedAt: entry.updatedAt })
      }
      /** Whether `targets` is the complete Session set, so a prune is safe. */
      let listedCompletely = walk.complete && targets.size > 0
      // A deployment whose sessions live elsewhere still gets a dashboard: ask
      // the controller only when the disk walk found nothing to read.
      if (targets.size === 0) {
        try {
          const listed = (await ctx.sessionController.list({}, signal)).items ?? []
          for (const item of listed) {
            if (item.blank === true) continue
            targets.set(item.sessionId, {
              asOfSeq: item.projections?.asOfSeq,
              updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
            })
            book?.setProject(item.sessionId, projectOf(item))
          }
          listedCompletely = true
        } catch (error) {
          ctx.logger?.warn?.('token-dashboard: could not list the Sessions: %s', error?.message ?? error)
          listedCompletely = false
        }
      }

      // Skip a Session whose log has not been written since it was last read.
      // Only a Session with no recorded time is always attempted.
      const marks = book?.marks() ?? null
      const pending = [...targets].filter(([sessionId, target]) => {
        if (marks === null) return true
        const mark = marks.get(sessionId)
        if (mark === undefined) return true
        if (!(target.updatedAt > 0)) return true
        return target.updatedAt > mark.updated
      })

      scanned = { total: targets.size, pending: pending.length }
      let unresolved = 0
      await eachLimited(pending, SCAN_PARALLEL, async ([sessionId, target]) => {
        try {
          const outcome = await scanSession(book, sessionId, target.asOfSeq, signal)
          if (outcome?.unresolved === true) unresolved += 1
        } catch (error) {
          ctx.logger?.warn?.('token-dashboard: could not read %s: %s', sessionId, error?.message ?? error)
        }
      })
      scanned = { total: targets.size, pending: 0 }
      // A Session the disk no longer holds must not keep counting. This runs
      // only on a listing that saw every Session, so a transient directory
      // failure cannot erase live usage.
      if (listedCompletely) {
        try {
          const forgotten = book?.forgetSessions(new Set(targets.keys())) ?? 0
          if (forgotten > 0) {
            ctx.logger?.warn?.('token-dashboard: dropped %s Session(s) that no longer exist on disk', forgotten)
          }
        } catch (error) {
          ctx.logger?.warn?.('token-dashboard: could not drop missing Sessions: %s', error?.message ?? error)
        }
      }
      // A Session whose log length could not be resolved was not counted. The
      // ledger is only complete when every Session was read, so the next scan
      // retries those instead of reporting a finished pass.
      primed = unresolved === 0
      if (unresolved > 0) {
        ctx.logger?.warn?.('token-dashboard: %s Session(s) could not be read yet; will retry', unresolved)
      }
    })().finally(() => {
      scannedAt = Date.now()
      scanning = undefined
    })
    scanning = job
    return job
  }

  /**
   * The dashboard payload the browser renders.
   *
   * Rows are
   * `[hour, project, model, input, cacheRead, cacheWrite, output, calls, cost, compactTokens, compactCalls, meteredCost]`.
   * The columns from index 3 on are additive. `compactTokens` and
   * `compactCalls` say how much of that row came from compaction requests.
   * `cost` is every call priced at list rates, and `meteredCost` is the part of
   * it billed per token rather than covered by a plan. The browser sums rows by
   * the range the user picked.
   *
   * @param request - `{ timeZone }` from the browser.
   */
  async function usageView({ timeZone, force } = {}) {
    // Never make the page wait for a scan. The answer comes from what the
    // ledger already holds; a scan started here (or at startup) fills it in
    // behind the request, and the browser polls again while `scanning` is true.
    // A warm scan reads only the Sessions whose logs moved, so it is cheap.
    //
    // `fresh` asks the scan to skip its throttle. Only an event-triggered
    // refresh sets it: that request is answering "what changed", so it must not
    // report the state from before the change.
    void scan(force === true).catch(error => ctx.logger?.warn?.('token-dashboard: scan failed: %s', error?.message ?? error))

    const book = await openLedger()
    const hourOf = hourKeyer(typeof timeZone === 'string' && timeZone !== '' ? timeZone : undefined)
    const stored = book?.projects() ?? new Map()

    // The aggregates depend only on the ledger, and building them costs about
    // 65 ms — one grouping query over every billed call. A page polling every
    // 1.2 s would pay that on every poll, which is what the dashboard's own
    // stalls were made of. So the last build is reused until the ledger
    // changes; only the progress fields are live on each answer.
    const zone = timeZone ?? ''
    // Rebuild on the first request, when the formatting zone changed, or when a
    // finished scan left the ledger moved past the throttle window.
    //
    // A scan in progress never triggers a rebuild. It commits once per Session,
    // so a rebuild during the scan would run again and again while the ledger
    // grows, and the cost grows with it — measured at 34 ms on the first poll and
    // 94 ms near the end. The page already says it is reading, so it answers
    // from the previous build until the scan finishes and then rebuilds once.
    const scanningNow = scanning !== undefined
    const zoneChanged = cachedView !== undefined && cachedView.zone !== zone
    const stale = revision !== builtRevision
    const due = cachedView === undefined
      || zoneChanged
      || (!scanningNow && stale && Date.now() - builtAt >= VIEW_REBUILD_MS)
    const fresh = !due
    let projects
    let models
    let rows
    if (fresh) {
      projects = cachedView.projects
      models = cachedView.models
      rows = cachedView.rows
    } else {
      projects = []
      const projectIndex = new Map()
      // Sessions that no longer exist keep the label they were last read under.
      const projectOf2 = (sessionId) => {
        const key = stored.get(sessionId) ?? '(unknown)'
        if (!projectIndex.has(key)) {
          projectIndex.set(key, projects.length)
          projects.push({ key, name: key })
        }
        return projectIndex.get(key)
      }

      models = []
      const modelIndex = new Map()
      const modelOf = (provider, model) => {
        const key = `${provider}/${model}`
        if (!modelIndex.has(key)) {
          modelIndex.set(key, models.length)
          // The rate is attached here so the page can show what priced each row
          // and flag a rate that is only a family or generic guess.
          const { rate, source, note } = resolvePrice(provider, model, prices)
          models.push({
            key,
            provider,
            model,
            name: model,
            providerName: provider,
            rate,
            priceSource: source,
            priceNote: note ?? null,
            /** A family or generic rule, not a rate for this exact model. */
            priceApprox: source === 'fallback' || (source === 'pattern' && /generic/i.test(note ?? '')),
            /** Billed by a plan, so the figure is consumed value, not money owed. */
            subscription: SUBSCRIPTION_PROVIDERS.has(provider),
          })
        }
        return modelIndex.get(key)
      }

      const buckets = new Map()
      for (const group of (await book?.groups()) ?? []) {
        const row = [
          hourOf(group.slot * SLOT_MS),
          projectOf2(group.session),
          modelOf(group.provider, group.model),
        ]
        const id = row.join('\n')
        const bucket = buckets.get(id) ?? [...row, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        bucket[3] += group.input
        bucket[4] += group.cacheRead
        bucket[5] += group.cacheWrite
        bucket[6] += group.output
        bucket[7] += group.calls
        // The group is a quarter hour, so one instant prices it exactly; the
        // time-of-day schedule never straddles a slot boundary.
        const priced = priceCostOf({ ...group, time: group.slot * SLOT_MS }, prices)
        bucket[8] += priced.cost
        if (!SUBSCRIPTION_PROVIDERS.has(group.provider)) bucket[11] += priced.cost
        if (group.kind === 'compact') {
          bucket[9] += group.input + group.cacheRead + group.cacheWrite + group.output
          bucket[10] += group.calls
        }
        buckets.set(id, bucket)
      }
      rows = [...buckets.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      cachedView = { zone, projects, models, rows }
      builtRevision = revision
      builtAt = Date.now()
    }

    return {
      projects,
      models,
      // [hour, project, model, input, cacheRead, cacheWrite, output, calls, cost, compactTokens, compactCalls, meteredCost]
      rows,
      now: hourOf(Date.now()),
      scanning: scanning !== undefined,
      /** Sessions read so far in the running scan, and how many still need it. */
      progress: scanned === null ? null : { total: scanned.total, pending: scanned.pending },
      /** False until one full pass finished; the page says "reading" until then. */
      primed,
      cached: book !== undefined,
      /** The generic rate, shown when a model has no family rate. */
      fallbackRate: FALLBACK,
    }
  }

  /**
   * The user's own profile card: picture, display name, and handle.
   *
   * The account picture is not reachable from a plugin, so this is the user's
   * own file. It lives beside the ledger, so it survives a restart without
   * touching the Session logs.
   *
   * @returns `{ url, name }`, each empty until the user sets it.
   */
  async function profileView() {
    try {
      const text = await readFile(avatarFile, 'utf8')
      const value = JSON.parse(text)
      const url = typeof value?.url === 'string' ? value.url : ''
      return {
        // Only a raster image data URL is accepted; anything else could be a
        // file reference or markup the page would try to load.
        url: /^data:image\/(png|jpeg|webp|gif);base64,/.test(url) ? url : '',
        name: typeof value?.name === 'string' ? value.name.slice(0, 40) : '',
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return { url: '', name: '' }
      return { url: '', name: '', reason: `failed: ${error?.message ?? error}` }
    }
  }

  /**
   * Store part of the profile card.
   *
   * Only the named fields change, so saving a name keeps the picture and saving
   * a picture keeps the name. An empty string clears a field.
   *
   * @param request - `{ url }`, `{ name }`, or both.
   * @returns the stored profile, or an error the page can show.
   */
  async function profileSave({ url, name } = {}) {
    const stored = await profileView()
    const next = {
      url: stored.url,
      name: stored.name,
    }
    if (url !== undefined) {
      // An empty string clears the picture; anything else must be a raster data
      // URL. The prior version rejected the empty string as "unsupported".
      if (url === '') next.url = ''
      else if (typeof url !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(url)) {
        return { ok: false, error: 'unsupported' }
      } else if (url.length > 700_000) {
        // 512 KB of base64 is about 384 KB of image, which is ample for 46px.
        return { ok: false, error: 'too-large' }
      } else next.url = url
    }
    if (name !== undefined) {
      if (typeof name !== 'string') return { ok: false, error: 'unsupported' }
      next.name = name.trim().slice(0, 40)
    }
    await mkdir(dirname(avatarFile), { recursive: true })
    await writeFile(avatarFile, JSON.stringify(next), 'utf8')
    return { ok: true, ...next }
  }

  /**
   * The Sessions behind one drill-down selection.
   *
   * The page already knows which project index or model index it asked about,
   * but the host stores labels and routes, so the request carries the resolved
   * names the page read from its own payload. The range arrives as absolute
   * epoch milliseconds computed from the browser's calendar, so the two sides
   * never have to agree on a time zone.
   *
   * @param request - `{ from, to, project, provider, model, limit }`.
   */
  async function detailView({ from, to, project, provider, model, limit } = {}) {
    // The page shows this after it already has its totals, so a scan started
    // here only fills in Sessions that arrived after that response.
    void scan().catch(error => ctx.logger?.warn?.('token-dashboard: scan failed: %s', error?.message ?? error))
    const book = await openLedger()
    if (book === undefined) return { sessions: [], building: true }

    const end = Number.isFinite(to) ? to : Date.now()
    const begin = Number.isFinite(from) ? from : end - 7 * 24 * 60 * 60_000
    const howMany = Math.min(Math.max(Number.isInteger(limit) ? limit : 10, 1), 50)
    const facet = typeof project === 'string' && project !== ''
      ? { project }
      : typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
        ? { provider, model }
        : undefined

    const metas = book.sessionMeta()
    const stored = book.projects()
    // Merge the per-route slices of one Session, pricing each slice at its own
    // rate and its own peak/off-peak multiplier.
    const sessions = new Map()
    for (const slice of book.topSessionSlices(begin, end, howMany, facet)) {
      const meta = metas.get(slice.session)
      const entry = sessions.get(slice.session) ?? {
        session: slice.session,
        title: meta?.title ?? '',
        cwd: meta?.cwd ?? '',
        project: stored.get(slice.session) ?? '',
        createdAt: meta?.createdAt ?? 0,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        calls: 0,
        cost: 0,
      }
      entry.input += slice.input
      entry.cacheRead += slice.cacheRead
      entry.cacheWrite += slice.cacheWrite
      entry.output += slice.output
      entry.calls += slice.calls
      entry.cost += priceCostOf({
        provider: slice.provider,
        model: slice.model,
        input: slice.input,
        cacheRead: slice.cacheRead,
        cacheWrite: slice.cacheWrite,
        output: slice.output,
      }, prices).cost
      sessions.set(slice.session, entry)
    }
    const ranked = [...sessions.values()]
      .sort((a, b) => (b.input + b.cacheRead + b.cacheWrite + b.output) - (a.input + a.cacheRead + a.cacheWrite + a.output))
      .slice(0, howMany)
    return { sessions: ranked, building: false }
  }

  // One exact Fetch route on the shared /api channel; the browser authenticates
  // with its session cookie. `connection` is injected, so it is present here;
  // the guard keeps a host that lacks the service from failing the whole plugin.
  const connection = ctx.get?.('connection') ?? ctx.connection
  if (connection?.fetch?.register === undefined) {
    ctx.logger?.error?.('token-dashboard: this DSH cannot serve the dashboard route (no connection service)')
    return
  }
  ctx.effect(() => connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      try {
        const value = await usageView({ timeZone: body?.timeZone, force: body?.fresh === true })
        return new Response(JSON.stringify({ ok: true, value }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'token-dashboard/failed', message: error?.message ?? String(error) },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    },
  }), 'token-dashboard: api route')

  ctx.effect(() => connection.fetch.register({
    path: DETAIL_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      try {
        const value = await detailView(body ?? {})
        return new Response(JSON.stringify({ ok: true, value }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'token-dashboard/detail-failed', message: error?.message ?? String(error) },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    },
  }), 'token-dashboard: detail route')

  ctx.effect(() => connection.fetch.register({
    path: AVATAR_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        let body = {}
        try {
          body = await request.json()
        } catch {
          body = {}
        }
        const saved = body?.action === 'save' ? await profileSave(body) : undefined
        const value = saved === undefined
          ? await profileView()
          : { url: saved.url ?? '', name: saved.name ?? '' }
        if (saved !== undefined && !saved.ok) {
          return new Response(JSON.stringify({
            ok: false,
            error: { code: `token-dashboard/avatar-${saved.error}`, message: saved.error },
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({ ok: true, value }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        })
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'token-dashboard/avatar-failed', message: error?.message ?? String(error) },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    },
  }), 'token-dashboard: avatar route')

  // A rescan is cheap but not free; do one at startup so the first page is warm.
  ctx.effect(() => {
    void scan()
    return () => {
      ledger?.close()
      ledger = undefined
    }
  }, 'token-dashboard: warm the ledger')
}
