/**
 * Token usage dashboard — browser half.
 *
 * Registers one Settings section, laid out like DS Bot's Usage page:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Token 用量            [今天][7天][30天][90天][全部]  │
 *   ├──────────────────────────────────────────────────────┤
 *   │  近 7 天    │ 缓存命中率 │   输出    │   调用次数      │
 *   │  12.3M      │   98.2%    │  22.5M    │   50,142        │
 *   │  估算 $120.84 │           │           │                │
 *   ├──────────────────────────────────────────────────────┤
 *   │  趋势                                     [按天][按模型]│
 *   │  ▁▃▅▂▇▄▆                                              │
 *   ├───────────────────────────┬──────────────────────────┤
 *   │  按模型 (ring + 排行)      │  按项目 (排行)            │
 *   ├───────────────────────────┴──────────────────────────┤
 *   │  活跃度 (日历热力图)                                   │
 *   └──────────────────────────────────────────────────────┘
 *
 * Every visible string comes from the `tokenDashboard` dictionary this file
 * registers with `ctx.locale`. The dictionary covers `zh` and `en`, and the
 * section reads the active one through the `t` prop the slot kit hands to an
 * entry that declares `locale`. A declared namespace with no registered
 * dictionary makes the slot renderer throw, so the two must ship together.
 *
 * Colors come from the Host theme tokens (`--dsw-alias-*`), so the section
 * follows the app's light and dark themes. Only `react` is imported.
 */
window.__ModuleLoader__.load({
  id: 'dsh-token-dashboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const ROUTE = '/api/token-dashboard'
    /** The drill-down route behind one project or model row. */
    const DETAIL_ROUTE = '/api/token-dashboard/sessions'
    /** The signed-in picture, served by the plugin's own Host route. */
    const AVATAR_ROUTE = '/api/token-dashboard/avatar'
    /** Dictionary namespace; also the slot entry's `locale` option. */
    const NS = 'tokenDashboard'
    /**
     * The DSH release this bundle was built against. The account read requires
     * it as part of the requesting-UI identity. It is a constant here for the
     * same reason the account package keeps one: a client bundle carries no
     * runtime version of its own.
     */
    const GLOBAL_VERSION = '0.2.1-rc.2'

    /** English copy. Key source: every other dictionary mirrors these keys. */
    const en = {
      title: 'Token usage',
      nav: 'Token usage',
      reading: 'Reading sessions',
      readingProgress: 'Reading sessions {done}/{total}',
      empty: 'No usage in this range',
      nothing: 'No records in this range',
      from: 'From',
      to: 'To',
      cost: 'Estimated cost',
      meteredCost: 'Billed',
      planValue: 'plan',
      calls: 'Calls',
      input: 'Input',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      output: 'Output',
      cacheHit: 'Cache hit rate',
      byModel: 'By model',
      byProject: 'By project',
      trend: 'Trend',
      heat: 'Activity',
      year: 'Last 12 months',
      avatarPick: 'Upload a picture',
      avatarClear: 'Remove the picture',
      nameLabel: 'Your name',
      namePlaceholder: 'Set your name',
      restartNeeded: 'Restart DSH to finish updating',
      saveFailed: 'Could not save',
      byDay: 'By day',
      other: 'Other',
      scanning: 'Scanning',
      retry: 'Retry',
      failedWith: 'Read failed: {message}',
      free: 'free',
      approximate: 'approx.',
      subscription: 'plan',
      compact: 'Compaction',
      dayCount: '{n} days',
      tokens: 'tokens',
      today: 'Today',
      range7: '7 days',
      range30: '30 days',
      range90: '90 days',
      all: 'All',
      custom: 'Custom',
      last7: 'Last 7 days',
      last30: 'Last 30 days',
      last90: 'Last 90 days',
      drillTitle: 'Sessions',
      drillLoading: 'Reading sessions',
      drillFailed: 'Could not read the sessions',
      drillEmpty: 'No session in this range',
      drillCount: '{count} sessions',
      drillClose: 'Close',
    }

    /** Chinese copy. */
    const zh = {
      title: 'Token 用量',
      nav: 'Token 用量',
      reading: '正在读取会话',
      readingProgress: '正在读取会话 {done}/{total}',
      empty: '这个范围内没有用量',
      nothing: '这个范围内没有记录',
      from: '开始',
      to: '结束',
      cost: '估算成本',
      meteredCost: '实付',
      planValue: '套餐折算',
      calls: '调用次数',
      input: '输入',
      cacheRead: '缓存读',
      cacheWrite: '缓存写',
      output: '输出',
      cacheHit: '缓存命中率',
      byModel: '按模型',
      byProject: '按项目',
      trend: '趋势',
      heat: '活跃度',
      year: '近 12 个月',
      avatarPick: '上传头像',
      avatarClear: '移除头像',
      nameLabel: '你的名字',
      namePlaceholder: '设置名字',
      restartNeeded: '重启 DSH 后生效',
      saveFailed: '保存失败',
      byDay: '按天',
      other: '其他',
      scanning: '扫描中',
      retry: '重试',
      failedWith: '读取失败：{message}',
      free: '免费',
      approximate: '近似价',
      subscription: '订阅',
      compact: '压缩',
      dayCount: '{n} 天',
      tokens: 'tokens',
      today: '今天',
      range7: '7 天',
      range30: '30 天',
      range90: '90 天',
      all: '全部',
      custom: '自定义',
      last7: '近 7 天',
      last30: '近 30 天',
      last90: '近 90 天',
      drillTitle: '会话明细',
      drillLoading: '正在读取会话',
      drillFailed: '会话读取失败',
      drillEmpty: '这个范围内没有会话',
      drillCount: '{count} 个会话',
      drillClose: '关闭',
    }

    /** Range presets. `days: null` means "everything up to today". */
    function rangesOf(t) {
      return [
        { id: '1d', label: t('today'), days: 1 },
        { id: '7d', label: t('range7'), days: 7 },
        { id: '30d', label: t('range30'), days: 30 },
        { id: '90d', label: t('range90'), days: 90 },
        { id: 'all', label: t('all'), days: null },
        { id: 'custom', label: t('custom'), days: null },
      ]
    }

    /** Stack series, in stacking order. */
    function seriesOf(t) {
      return [
        { key: 'input', label: t('input'), token: 'var(--dsw-alias-brand-primary)' },
        { key: 'cacheRead', label: t('cacheRead'), token: 'var(--dsw-alias-state-success-primary)' },
        { key: 'cacheWrite', label: t('cacheWrite'), token: 'var(--dsw-alias-state-warning-primary,#d99a2b)' },
        { key: 'output', label: t('output'), token: 'var(--dsw-alias-state-error-primary)' },
      ]
    }

    /** A palette for ranked rows, so each row keeps a stable color. */
    const INKS = [
      'var(--dsw-alias-brand-primary)',
      'var(--dsw-alias-state-success-primary)',
      'var(--dsw-alias-state-warning-primary,#d99a2b)',
      'var(--dsw-alias-state-error-primary)',
      'var(--dsw-alias-label-secondary)',
      'var(--dsw-alias-label-tertiary)',
    ]

    const nf = new Intl.NumberFormat('zh-CN')
    const fmt = value => nf.format(Math.round(value ?? 0))

    function compact(value) {
      const n = value ?? 0
      if (n < 1000) return String(Math.round(n))
      if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`
      if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`
      return `${(n / 1e9).toFixed(1)}B`
    }

    function money(value) {
      const n = value ?? 0
      if (n === 0) return '$0'
      if (n < 0.01) return `$${n.toFixed(4)}`
      if (n < 1) return `$${n.toFixed(3)}`
      return `$${n.toFixed(2)}`
    }

    function percent(value, base) {
      if (!(base > 0)) return '—'
      return `${((value / base) * 100).toFixed(1)}%`
    }

    const dayOf = hour => String(hour ?? '').slice(0, 10)

    /** The label of the range in use, for the primary stat. */
    function rangeLabel(rangeId, t) {
      return {
        '1d': t('today'),
        '7d': t('last7'),
        '30d': t('last30'),
        '90d': t('last90'),
        all: t('all'),
        custom: '',
      }[rangeId] ?? t('last7')
    }

    /** The host's entry for one route, or undefined when the key is a label. */
    function modelOf(view, key) {
      return view?.models?.find(item => item.key === key)
    }

    /**
     * The unit price of a model, for the row subtitle. A free model reads
     * "free"; a model billed by a plan, or priced by a family rule rather than
     * its own rate, is marked so the number is not mistaken for money owed.
     */
    function rateOf(view, key, t) {
      const model = modelOf(view, key)
      if (model?.rate === undefined) return ''
      const { input, output } = model.rate
      if (input === 0 && output === 0) return ` · ${t('free')}`
      const notes = []
      if (model.subscription === true) notes.push(t('subscription'))
      if (model.priceApprox === true) notes.push(t('approximate'))
      return ` · $${input}/$${output}${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`
    }

    /** The scan status line, with a count while the first pass runs. */
    function scanText(view, t) {
      const pending = view?.progress?.pending ?? 0
      const total = view?.progress?.total ?? 0
      if (total > 0 && pending > 0) return t('readingProgress', { done: total - pending, total })
      return t('reading')
    }

    function todayKey() {
      const now = new Date()
      const pad = value => String(value).padStart(2, '0')
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    }

    function shiftDay(day, days) {
      const [y, m, d] = String(day).split('-').map(Number)
      const date = new Date(y, (m ?? 1) - 1, d ?? 1)
      date.setDate(date.getDate() + days)
      const pad = value => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    /** Whole days between two day keys, counting both ends. */
    function dayCount(from, to) {
      const [y1, m1, d1] = from.split('-').map(Number)
      const [y2, m2, d2] = to.split('-').map(Number)
      return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1
    }

    /** Weekday index of a day key, Monday first. */
    function weekday(day) {
      const [y, m, d] = day.split('-').map(Number)
      return (new Date(y, m - 1, d).getDay() + 6) % 7
    }

    /** Short month names for the heatmap headers, in the UI language. */
    function monthNames(uiLocale) {
      const format = new Intl.DateTimeFormat(uiLocale, { month: 'short' })
      return Array.from({ length: 12 }, (_, month) => format.format(new Date(2024, month, 1)))
    }

    // Payload column order, fixed by the host.
    const INPUT = 3
    const CACHE_READ = 4
    const CACHE_WRITE = 5
    const OUTPUT = 6
    const CALLS = 7
    const COST = 8
    const COMPACT_TOKENS = 9
    const COMPACT_CALLS = 10
    const METERED_COST = 11

    const tokensOf = row => row[INPUT] + row[CACHE_READ] + row[CACHE_WRITE] + row[OUTPUT]
    /** Total tokens of one drill-down Session record (an object, not a row). */
    const tokensOfSession = session => session.input + session.cacheRead + session.cacheWrite + session.output

    /**
     * The second line of a drill-down row: where the Session ran.
     *
     * The project is shown only when the name above does not already say it,
     * which happens when a Session has no title and the project is the label.
     */
    function drillSubtitle(session) {
      const name = session.title || session.project || session.session
      const parts = []
      if (session.project !== '' && session.project !== name) parts.push(session.project)
      if (session.cwd !== '') parts.push(session.cwd)
      if (session.cost > 0) parts.push(money(session.cost))
      return parts.join(' · ')
    }
    const compactOf = row => row[COMPACT_TOKENS] ?? 0
    const meteredOf = row => row[METERED_COST] ?? row[COST]

    /** A round axis maximum, so gridline labels read as whole numbers. */
    function niceMax(value) {
      if (!(value > 0)) return 1
      const magnitude = 10 ** Math.floor(Math.log10(value))
      for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
        if (step * magnitude >= value) return step * magnitude
      }
      return 10 * magnitude
    }

    /** Sum rows into one total plus a sorted group list, keyed by `keyOf`. */
    function summarize(rows, keyOf) {
      const groups = new Map()
      const blank = key => ({ key, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, cost: 0, metered: 0, tokens: 0, compact: 0, compactCalls: 0 })
      const total = blank('total')
      for (const row of rows) {
        const key = keyOf(row)
        const group = groups.get(key) ?? blank(key)
        group.input += row[INPUT]
        group.cacheRead += row[CACHE_READ]
        group.cacheWrite += row[CACHE_WRITE]
        group.output += row[OUTPUT]
        group.calls += row[CALLS]
        group.cost += row[COST]
        group.metered += meteredOf(row)
        group.tokens += tokensOf(row)
        group.compact += compactOf(row)
        group.compactCalls += row[COMPACT_CALLS] ?? 0
        groups.set(key, group)
        total.input += row[INPUT]
        total.cacheRead += row[CACHE_READ]
        total.cacheWrite += row[CACHE_WRITE]
        total.output += row[OUTPUT]
        total.calls += row[CALLS]
        total.cost += row[COST]
        total.metered += meteredOf(row)
        total.tokens += tokensOf(row)
        total.compact += compactOf(row)
        total.compactCalls += row[COMPACT_CALLS] ?? 0
      }
      return { groups: [...groups.values()].sort((a, b) => b.tokens - a.tokens), total }
    }

    /** Bucket rows by day, filling quiet days so gaps stay visible. */
    function byDay(rows, from, to) {
      const days = new Map()
      const blank = day => ({ day, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, calls: 0, tokens: 0, compact: 0 })
      for (const row of rows) {
        const day = dayOf(row[0])
        const bucket = days.get(day) ?? blank(day)
        bucket.input += row[INPUT]
        bucket.cacheRead += row[CACHE_READ]
        bucket.cacheWrite += row[CACHE_WRITE]
        bucket.output += row[OUTPUT]
        bucket.cost += row[COST]
        bucket.calls += row[CALLS]
        bucket.tokens += tokensOf(row)
        bucket.compact += compactOf(row)
        days.set(day, bucket)
      }
      if (from && to && dayCount(from, to) <= 400) {
        for (let day = from; day <= to; day = shiftDay(day, 1)) {
          if (!days.has(day)) days.set(day, blank(day))
        }
      }
      return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    }

    /** Two initials for a glyph, taken from the part after the last slash. */
    /**
     * A brand mark per model family, drawn as SVG.
     *
     * A ranking row is identified by its model at a glance, and two initials in
     * a coloured circle do not do that: `deepseek-flash` and `deepseek-v4-pro`
     * share "DE". Each family gets its own glyph and its own brand colour, so a
     * row is recognisable before its name is read. Unknown families fall back to
     * the initials, so a new model still renders.
     *
     * Every mark is drawn in a 24x24 box and takes `currentColor`, so one
     * definition works on the light and the dark theme.
     */
    /**
     * Official brand paths, from the simple-icons set (24x24, one path each).
     *
     * A hand-drawn approximation is worse than no icon: it reads as a bug. Only
     * families with a real mark get one here; the rest fall back to initials.
     */
    const BRANDS = [
      // DeepSeek
      { match: /deepseek/i, color: '#4D6BFE', paths: 'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45' },
      // Zhipu GLM (no icon in the set; the layered mark reads as a model family)
      { match: /glm|zhipu|chatglm/i, color: '#615CED', paths: 'M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z' },
      // Google Gemini
      { match: /gemini|bard|google/i, color: '#4285F4', paths: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81' },
      // Moonshot Kimi
      { match: /kimi|moonshot/i, color: '#16191E', paths: 'm1.053 16.91 9.538 2.55a21 20.981 0 0 0 .06 2.031l5.956 1.592a12 11.99 0 0 1-15.554-6.172m-1.02-5.79 11.352 3.035a21 20.981 0 0 0-.469 2.01l10.817 2.89a12 11.99 0 0 1-1.845 2.004L.658 15.918a12 11.99 0 0 1-.625-4.796m1.593-5.146L13.573 9.17a21 20.981 0 0 0-1.01 1.874l11.297 3.02a21 20.981 0 0 1-.67 2.362l-11.55-3.087L.125 10.26a12 11.99 0 0 1 1.499-4.285ZM6.067 1.58l11.285 3.016a21 20.981 0 0 0-1.688 1.719l7.824 2.091a21 20.981 0 0 1 .513 2.664L2.107 5.218a12 11.99 0 0 1 3.96-3.638M21.68 4.866 7.222 1.003A12 11.99 0 0 1 21.68 4.866' },
      // Alibaba Qwen
      { match: /qwen|tongyi|alibaba/i, color: '#615CED', paths: 'M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z' },
      // OpenAI
      { match: /gpt|openai|o1|o3|o4/i, color: '#412991', paths: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z' },
      // Anthropic Claude
      { match: /claude|anthropic/i, color: '#D97757', paths: 'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z' },
      // MiniMax
      { match: /minimax/i, color: '#E8474B', paths: 'M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997' },
      // Xiaomi MiMo
      { match: /mimo|xiaomi/i, color: '#FF6900', paths: 'M12 0C8.016 0 4.756.255 2.493 2.516.23 4.776 0 8.033 0 12.012c0 3.98.23 7.235 2.494 9.497C4.757 23.77 8.017 24 12 24c3.983 0 7.243-.23 9.506-2.491C23.77 19.247 24 15.99 24 12.012c0-3.984-.233-7.243-2.502-9.504C19.234.252 15.978 0 12 0zM4.906 7.405h5.624c1.47 0 3.007.068 3.764.827.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.151.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149zm12.131 0h1.949a.15.15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149zM8.92 10.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .152-.147Z' },
    ]

    /**
     * The brand mark for a route.
     *
     * The match runs on the model id and then the provider, so a family served
     * through a reseller still gets its own mark.
     */
    function brandOf(provider, model) {
      const text = `${model ?? ''} ${provider ?? ''}`
      for (const brand of BRANDS) {
        if (brand.match.test(text)) return brand
      }
      return undefined
    }

    /**
     * Redraw an image file at a square size and return a PNG data URL.
     *
     * A phone photo is several megabytes; the picture is shown in a 46px circle.
     * Scaling here keeps the stored file small and the round trip quick.
     *
     * @param file - the picked image file.
     * @param size - the square edge in pixels.
     * @returns a `data:image/png;base64,` URL.
     */
    async function shrinkImage(file, size) {
      const bitmap = await createImageBitmap(file)
      const edge = Math.min(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      // Centre-crop to a square, so a wide photo is not squashed.
      context.drawImage(
        bitmap,
        (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge,
        0, 0, size, size,
      )
      bitmap.close?.()
      return canvas.toDataURL('image/png')
    }

    /**
     * A line of text the user can edit in place.
     *
     * A label that is always an input looks like a form; a label that is only an
     * input on click reads as text. Enter or blur saves, Escape cancels, and an
     * empty value shows the placeholder rather than an empty line.
     */
    function EditableText({ value, placeholder, className, label, onSave }) {
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(value)

      useEffect(() => {
        if (!editing) setDraft(value)
      }, [value, editing])

      const commit = () => {
        setEditing(false)
        if (draft.trim() !== value) onSave(draft.trim())
      }

      if (!editing) {
        return h('button', {
          type: 'button',
          className: value === '' ? `${className} td-identity-empty` : className,
          title: label,
          onClick: () => { setDraft(value); setEditing(true) },
        }, value === '' ? placeholder : value)
      }
      return h('input', {
        className: `${className} td-identity-input`,
        value: draft,
        placeholder,
        autoFocus: true,
        'aria-label': label,
        onChange: event => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') { setDraft(value); setEditing(false) }
        },
      })
    }

    /** The mark for one route: a brand glyph, or the initials when unknown. */
    function Brand({ provider, model, paint, size = 36 }) {
      const brand = brandOf(provider, model)
      if (brand === undefined) return h(Glyph, { name: model ?? provider ?? '?', paint, size })
      return h('span', {
        className: 'td-brand',
        style: { width: `${size}px`, height: `${size}px` },
        'aria-hidden': true,
      }, h('svg', {
        width: Math.round(size * 0.66),
        height: Math.round(size * 0.66),
        viewBox: '0 0 24 24',
        fill: brand.color,
      }, h('path', { d: brand.paths })))
    }

    function initials(name) {
      const text = String(name ?? '').trim()
      if (text === '') return '?'
      const tail = text.includes('/') ? text.slice(text.lastIndexOf('/') + 1) : text
      const parts = tail.split(/[\s._-]+/).filter(Boolean)
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
      return tail.slice(0, 2).toUpperCase()
    }

    /** A square avatar for a model or project. */
    function Glyph({ name, paint, size = 32 }) {
      return h('span', {
        className: 'td-glyph',
        style: {
          width: size, height: size, fontSize: Math.round(size * 0.36),
          background: `color-mix(in srgb, ${paint} 15%, transparent)`,
          color: paint,
        },
        'aria-hidden': true,
      }, initials(name))
    }

    /**
     * A number that eases to its new value, so a range change reads as motion
     * rather than a jump. Falls back to the final value when animation is off.
     */
    function useTween(value) {
      const [shown, setShown] = useState(value)
      const from = useRef(value)
      useEffect(() => {
        const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduced || typeof requestAnimationFrame !== 'function') {
          from.current = value
          setShown(value)
          return undefined
        }
        const begin = from.current
        const started = performance.now()
        let frame
        const step = now => {
          const progress = Math.min(1, (now - started) / 650)
          from.current = begin + (value - begin) * (1 - (1 - progress) ** 3)
          setShown(from.current)
          if (progress < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
        return () => cancelAnimationFrame(frame)
      }, [value])
      return shown
    }

    /** One pill tab group. */
    function Tabs({ value, options, onChange, small }) {
      return h('div', { className: small ? 'td-tabs td-tabs-sm' : 'td-tabs', role: 'tablist' },
        options.map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          role: 'tab',
          'aria-pressed': id === value,
          onClick: () => onChange(id),
        }, label)),
      )
    }

    /**
     * The four-cell stats card. The primary cell carries the token total and
     * the estimated cost; the rest carry the cache-hit rate, output, and calls.
     */
    function Stats({ rangeId, total, t }) {
      const shown = useTween(total.tokens)
      const cacheHit = total.cacheRead + total.input > 0
        ? (total.cacheRead / (total.cacheRead + total.input)) * 100
        : 0
      const plan = total.cost - total.metered
      // Four cells, one shape each: a label, one value line, one supporting
      // line. The main cell leads with the token total, the delta badge on the
      // same line, and the cost underneath where the others carry their detail.
      return h('section', { className: 'td-stats' },
        h('div', { className: 'td-stat td-stat-main' },
          h('span', { className: 'td-stat-label' }, rangeLabel(rangeId, t)),
          h('span', { className: 'td-stat-value' }, compact(shown)),
          h('span', { className: 'td-stat-sub td-stat-cost' },
            h('em', null, t('meteredCost')),
            h('b', null, money(total.metered)),
            plan > 0.005 ? h('em', { className: 'td-stat-cost-alt' }, `${t('planValue')} ${money(plan)}`) : null,
          ),
        ),
        h('div', { className: 'td-stat' },
          h('span', { className: 'td-stat-label' }, t('cacheHit')),
          h('span', { className: 'td-stat-value' }, `${cacheHit.toFixed(1)}%`),
          h('span', { className: 'td-stat-sub' }, `${compact(total.cacheRead)} / ${compact(total.input + total.cacheRead)}`),
        ),
        h('div', { className: 'td-stat' },
          h('span', { className: 'td-stat-label' }, t('output')),
          h('span', { className: 'td-stat-value' }, compact(total.output)),
          h('span', { className: 'td-stat-sub' }, `${t('input')} ${compact(total.input)}`),
        ),
        h('div', { className: 'td-stat' },
          h('span', { className: 'td-stat-label' }, t('calls')),
          h('span', { className: 'td-stat-value' }, fmt(total.calls)),
          h('span', { className: 'td-stat-sub' },
            total.compact > 0
              ? `${t('compact')} ${compact(total.compact)} · ${percent(total.compact, total.tokens)}`
              : `${t('cacheWrite')} ${compact(total.cacheWrite)}`),
        ),
      )
    }

    /** The bar chart: two gridlines, stacked bars, and a side-aware tooltip. */
    function Chart({ days, series, showBy, onBy, t }) {
      const [hover, setHover] = useState(null)
      const max = useMemo(() => niceMax(Math.max(0, ...days.map(day => day.tokens))), [days])
      const count = days.length
      const tip = hover === null ? null : days[hover]
      // The tooltip flips to the other side of the hovered bar near the edge.
      const tipSide = hover === null
        ? {}
        : hover >= count / 2
          ? { right: `calc(${((count - hover) / count) * 100}% + 8px)` }
          : { left: `calc(${((hover + 1) / count) * 100}% + 8px)` }
      const tickEvery = Math.max(1, Math.ceil(count / 10))

      return h('section', { className: 'td-card td-chart-card' },
        h('div', { className: 'td-card-head' },
          h('h3', null, t('trend'), h('span', null, t('dayCount', { n: count }))),
          h(Tabs, {
            value: showBy,
            onChange: onBy,
            small: true,
            options: [['day', t('byDay')], ['model', t('byModel')]],
          }),
        ),
        h('div', { className: 'td-chart-body' },
          h('div', {
            className: 'td-plot',
            'data-hover': hover !== null ? '' : undefined,
            onMouseLeave: () => setHover(null),
          },
            [1, 0.5].map(level => h('div', {
              key: level,
              className: 'td-grid',
              style: { bottom: `${level * 100}%` },
            }, h('span', null, compact(max * level)))),
            h('div', { className: 'td-grid td-grid-base', style: { bottom: 0 } }, h('span', null, '0')),
            h('div', { className: 'td-cols' },
              days.map((day, index) => {
                const parts = series.filter(item => day[item.key] > 0)
                const height = day.tokens > 0 ? (day.tokens / max) * 100 : 0
                return h('div', {
                  key: day.day,
                  className: 'td-col',
                  'data-on': hover === index ? '' : undefined,
                  onMouseEnter: () => setHover(index),
                },
                  day.tokens > 0
                    ? h('div', { className: 'td-stack', style: { height: `${height}%`, '--i': index } },
                        parts.map(item => h('i', {
                          key: item.key,
                          style: { flexGrow: day[item.key], background: item.token },
                        })),
                      )
                    : h('span', { className: 'td-stub' }),
                )
              }),
            ),
            tip === null || tip === undefined
              ? null
              : h('div', { className: 'td-tip', style: tipSide },
                  h('div', { className: 'td-tip-title' }, tip.day),
                  h('div', { className: 'td-tip-total' }, `${fmt(tip.tokens)} ${t('tokens')}`),
                  series.filter(item => tip[item.key] > 0)
                    .sort((a, b) => tip[b.key] - tip[a.key])
                    .map(item => h('div', { className: 'td-tip-row', key: item.key },
                      h('span', { className: 'td-tip-dot', style: { background: item.token } }),
                      h('span', { className: 'td-tip-name' }, item.label),
                      h('b', null, fmt(tip[item.key])),
                    )),
                  h('div', { className: 'td-tip-row td-tip-foot' },
                    h('span', { className: 'td-tip-name' }, t('calls')),
                    h('b', null, fmt(tip.calls)),
                  ),
                  h('div', { className: 'td-tip-row td-tip-foot' },
                    h('span', { className: 'td-tip-name' }, t('cost')),
                    h('b', null, money(tip.cost)),
                  ),
                ),
          ),
          h('div', { className: 'td-ticks' },
            days.map((day, index) => h('span', {
              key: day.day,
              'data-now': index === count - 1 ? '' : undefined,
            }, index % tickEvery === 0 ? day.day.slice(5) : '')),
          ),
        ),
        h('div', { className: 'td-legend' },
          series.map(item => h('span', { className: 'td-key', key: item.key },
            h('span', { className: 'td-dot', style: { background: item.token } }),
            item.label,
          )),
        ),
      )
    }

    /**
     * One ranked row: glyph, name, share track, and the figure.
     *
     * A row with `onOpen` is a button: the drill-down is what makes a ranking
     * useful, and a row that only shows a number leaves the reader unable to
     * find out which Sessions produced it.
     */
    function Row({ name, sub, value, total, paint, t, onOpen, active, brand }) {
      const width = total > 0 ? Math.max(value > 0 ? 2 : 0, (value / total) * 100) : 0
      return h(onOpen === undefined ? 'div' : 'button', {
        className: active === true ? 'td-row td-row-open' : 'td-row',
        ...(onOpen === undefined ? {} : { type: 'button', onClick: onOpen }),
        title: `${fmt(value)} ${t('tokens')} · ${percent(value, total)}`,
      },
        brand === undefined
          ? h(Glyph, { name, paint, size: 36 })
          : h(Brand, { provider: brand.provider, model: brand.model, paint }),
        h('div', { className: 'td-row-body' },
          h('div', { className: 'td-row-line' },
            h('span', { className: 'td-row-name' }, name),
            sub === '' || sub === undefined ? null : h('span', { className: 'td-row-sub' }, sub),
          ),
          h('span', { className: 'td-track' },
            h('span', { className: 'td-track-fill', style: { width: `${width}%`, background: paint } }),
          ),
        ),
        h('div', { className: 'td-row-num' },
          h('b', null, compact(value)),
          h('small', null, percent(value, total)),
        ),
        onOpen === undefined ? null : h('span', {
          className: 'td-row-more',
          'aria-hidden': true,
        }, '›'),
      )
    }

    /** The share ring with the leader's glyph in the middle. */
    function Ring({ name, value, total, paint, brand }) {
      const share = total > 0 ? Math.min(1, value / total) : 0
      const radius = 40
      const circumference = 2 * Math.PI * radius
      return h('span', { className: 'td-ring' },
        h('svg', { viewBox: '0 0 96 96', 'aria-hidden': true },
          h('circle', { className: 'td-ring-track', cx: 48, cy: 48, r: radius, fill: 'none', strokeWidth: 9 }),
          share > 0
            ? h('circle', {
                className: 'td-ring-arc', cx: 48, cy: 48, r: radius, fill: 'none', strokeWidth: 9,
                stroke: paint,
                strokeDasharray: `${share * circumference} ${circumference}`,
                transform: 'rotate(-90 48 48)',
              })
            : null,
        ),
        h('span', { className: 'td-ring-face' },
          brand === undefined
            ? h(Glyph, { name, paint, size: 44 })
            : h(Brand, { provider: brand.provider, model: brand.model, paint, size: 44 })),
      )
    }

    /** A GitHub-style calendar heatmap of daily spend. */
    /**
     * The calendar heatmap, one row of cells per weekday and one column per week.
     *
     * It always shows **a full year**, matching the reference: the grid starts on
     * the Monday of the week containing the 1st of the current month a year ago,
     * so the month ruler reads 1月 through 12月 in order and never starts
     * mid-label. Months with no usage stay visible as empty cells, which is what
     * makes the shape of a year readable.
     */
    function Heat({ days, t, uiLocale }) {
      const cells = useMemo(() => {
        const byDay = new Map(days.map(day => [day.day, day]))
        const today = todayKey()
        // The calendar year in one row: 1 January on the left, 31 December on
        // the right. A year is 53 weeks, so the cell is 526/53 px — the panel
        // width sets that ceiling, not the style.
        const year = Number(today.slice(0, 4))
        const peak = Math.max(0, ...days.map(day => day.tokens))
        const names = monthNames(uiLocale)

        /** The whole year as one band: its columns and its month ruler. */
        const band = (firstMonth, monthCount) => {
          const firstOfRange = `${year}-${String(firstMonth).padStart(2, '0')}-01`
          const from = shiftDay(firstOfRange, -weekday(firstOfRange))
          const endMonth = firstMonth + monthCount - 1
          const lastOfRange = `${endMonth === 12
            ? `${year}-12-31`
            : `${year}-${String(endMonth).padStart(2, '0')}-${new Date(Date.UTC(year, endMonth, 0)).getUTCDate()}`}`
          const to = shiftDay(lastOfRange, 6 - weekday(lastOfRange))
          const span = Math.max(1, Math.round(dayCount(from, to) / 7))
          const columns = []
          const months = []
          const labelled = new Set()
          for (let week = 0; week < span; week += 1) {
            const monday = shiftDay(from, week * 7)
            // The month the week mostly occupies: its Thursday decides, which is
            // the ISO rule, so a week straddling two months is labelled once.
            const monthKey = shiftDay(monday, 3).slice(0, 7)
            const index = Number(monthKey.slice(5))
            if (monthKey.slice(0, 4) === String(year) && index >= firstMonth && index <= endMonth
              && !labelled.has(monthKey)) {
              labelled.add(monthKey)
              months.push({ column: week, label: names[index - 1] })
            }
            columns.push(Array.from({ length: 7 }, (_, offset) => {
              const day = shiftDay(monday, offset)
              const entry = byDay.get(day)
              return {
                day,
                tokens: entry?.tokens ?? 0,
                cost: entry?.cost ?? 0,
                // Padding outside the half is blank; a day inside it with no
                // usage is a real zero cell.
                future: day < firstOfRange || day > lastOfRange,
              }
            }))
          }
          return { columns, months, span: Math.max(1, Math.max(
            ...columns.map((_, week) => week + 1),
          )) }
        }

        return {
          peak,
          rows: [band(1, 12)],
        }
      }, [days, uiLocale])

      const level = (value) => {
        if (!(value > 0)) return 0
        // A square root keeps a few heavy days from flattening the rest.
        return Math.max(1, Math.ceil(5 * Math.sqrt(value / (cells.peak || 1))))
      }

      return h('section', { className: 'td-card td-heat-card' },
        h('div', { className: 'td-card-head' },
          h('h3', null, `${t('heat')} ${t('year')}`),
          // The five swatches show the colour range. No words are needed beside
          // them: the grid below is what they describe.
          h('div', { className: 'td-heat-scale' },
            [0, 1, 2, 3, 4, 5].map(item => h('i', { key: item, className: `td-cell td-lv${item}` })),
          ),
        ),
        cells.rows.every(row => row.columns.length === 0)
          ? h('p', { className: 'td-none' }, t('nothing'))
          : h('div', { className: 'td-heat-wrap' }, cells.rows.map((row, index) => h('div', {
              className: 'td-heat-row',
              key: index,
            },
              h('div', {
                className: 'td-heat-months',
                style: { gridTemplateColumns: `repeat(${row.columns.length}, var(--td-cell-size))` },
              }, row.months.map(month => h('span', {
                key: month.column,
                style: { gridColumn: month.column + 1 },
              }, month.label))),
              h('div', {
                className: 'td-heat-grid',
                style: { gridTemplateColumns: `repeat(${row.columns.length}, var(--td-cell-size))` },
              }, row.columns.flatMap((column, w) => column.map((cell, d) => h('span', {
                key: `${w}-${d}`,
                className: cell.future ? 'td-cell td-cell-void' : `td-cell td-lv${level(cell.tokens)}`,
                title: cell.future ? undefined : `${cell.day} · ${fmt(cell.tokens)} ${t('tokens')} · ${money(cell.cost)}`,
              })))),
            ))),
      )
    }

    /**
     * The Sessions behind one selected project or model.
     *
     * The three states that matter are all shown the same way: still loading,
     * nothing found, and a list. A Session without a stored title falls back to
     * its directory, and then to the id, because a row with no label cannot be
     * recognized at all.
     */
    function Drill({ label, sessions, loading, error, onClose, t }) {
      const heading = loading
        ? t('drillLoading')
        : error !== ''
          ? t('drillFailed')
          : sessions.length === 0
            ? t('drillEmpty')
            : t('drillCount', { count: sessions.length })
      return h('section', { className: 'td-card td-drill' },
        h('div', { className: 'td-card-head' },
          h('h3', null, t('drillTitle'), h('span', null, label)),
          h('button', { type: 'button', className: 'td-drill-close', onClick: onClose, 'aria-label': t('drillClose') }, '×'),
        ),
        h('p', { className: 'td-drill-note' }, heading),
        sessions.length === 0
          ? null
          : h('div', { className: 'td-rows' },
              sessions.map(session => h('div', { className: 'td-drill-row', key: session.session },
                h(Glyph, { name: session.title || session.project || session.session, paint: 'var(--dsw-alias-brand-primary)', size: 26 }),
                h('div', { className: 'td-drill-body' },
                  h('div', { className: 'td-drill-name', title: session.title || session.session },
                    session.title || session.project || session.session),
                  h('div', { className: 'td-drill-sub' }, drillSubtitle(session)),
                ),
                h('div', { className: 'td-row-num' },
                  h('b', null, compact(tokensOfSession(session))),
                  h('small', null, fmt(session.calls)),
                ),
              )),
            ),
      )
    }

    /** The whole section. `t` arrives from the slot kit for the declared namespace. */
    function TokenDashboard({ t, uiLocale, refresh, avatar }) {
      const [view, setView] = useState(null)
      const [profile, setProfile] = useState({ url: '', name: '' })
      const [avatarFailed, setAvatarFailed] = useState(false)
      const [profileError, setProfileError] = useState('')
      const fileRef = useRef(null)
      const avatarUrl = profile.url

      /**
       * Save one field of the profile card and adopt what the Host stored.
       *
       * A failure sets a short message instead of passing silently: a control
       * that does nothing is indistinguishable from one that is broken, and the
       * usual cause is a Host that has not loaded this plugin's route yet.
       */
      const onSaveProfile = useCallback(async (patch) => {
        try {
          const response = await fetch(AVATAR_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'save', ...patch }),
          })
          if (!response.ok) {
            setProfileError(response.status === 401 || response.status === 404
              ? 'restart'
              : `${response.status}`)
            return false
          }
          const body = await response.json()
          if (body?.ok !== true) {
            setProfileError(body?.error?.message ?? 'save')
            return false
          }
          setProfileError('')
          setProfile(body.value ?? { url: '', name: '' })
          setAvatarFailed(false)
          return true
        } catch (error) {
          setProfileError(error?.message ?? 'network')
          return false
        }
      }, [])

      /**
       * Upload or clear the dashboard picture.
       *
       * The file is redrawn on a canvas at 192px before it is stored: a phone
       * photo is several megabytes, and the circle is 46px. Clearing sends an
       * empty URL, which the Host stores as an empty picture.
       */
      const onPickAvatar = useCallback(async (event, clear = false) => {
        const pick = event?.target
        if (pick !== undefined) pick.value = ''
        if (clear) {
          await onSaveProfile({ url: '' })
          setAvatarFailed(false)
          return
        }
        const file = pick?.files?.[0]
        if (file === undefined) return
        try {
          await onSaveProfile({ url: await shrinkImage(file, 192) })
        } catch {
          // A rejected file leaves the previous picture in place.
        }
      }, [onSaveProfile])

      // The stored profile arrives after the first paint, so the card appears
      // when it does rather than being fixed at mount.
      useEffect(() => {
        if (avatar === undefined) return undefined
        setProfile(avatar.getSnapshot())
        return avatar.subscribe(() => {
          setProfile(avatar.getSnapshot())
          setAvatarFailed(false)
        })
      }, [avatar])

      const [error, setError] = useState('')
      const [rangeId, setRangeId] = useState('7d')
      const [span, setSpan] = useState(null)
      const [showBy, setShowBy] = useState('day')
      /** The open drill-down: `{ kind, project?, provider?, model?, label }`. */
      const [drill, setDrill] = useState(null)
      const [drillRows, setDrillRows] = useState([])
      const [drillLoading, setDrillLoading] = useState(false)
      const [drillError, setDrillError] = useState('')
      const stopped = useRef(false)
      const scanningRef = useRef(false)
      const reloadRef = useRef(null)

      const load = useCallback(async (force = false) => {
        try {
          const response = await fetch(ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            // `fresh` asks the host to rescan past its throttle. Only an
            // event-triggered refresh sets it, because that answer must not
            // describe the ledger as it was before the event.
            body: JSON.stringify({
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              ...(force ? { fresh: true } : {}),
            }),
          })
          const body = await response.json()
          if (stopped.current) return
          if (body?.ok !== true) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
          scanningRef.current = body.value?.scanning === true || body.value?.primed === false
          setView(body.value)
          setError('')
        } catch (failure) {
          if (stopped.current) return
          setError(failure?.message ?? String(failure))
        }
      }, [])

      useEffect(() => {
        stopped.current = false
        // Poll only while a scan is filling the ledger, then stop entirely: an
        // idle page issues no requests. A new call arrives as a forwarded
        // `api-session/activity` event instead, which is what the refresh below
        // listens for.
        let timer
        const tick = async () => {
          await load()
          if (stopped.current) return
          if (!scanningRef.current) return
          timer = setTimeout(tick, 1_200)
        }
        void tick()
        reloadRef.current = () => { void load(true) }
        // Let a forwarded Host event trigger the same refresh a poll would.
        if (refresh !== undefined) refresh.reload = reloadRef.current
        return () => {
          stopped.current = true
          clearTimeout(timer)
          reloadRef.current = null
          if (refresh !== undefined) refresh.reload = null
        }
      }, [load, refresh])

      const ranges = useMemo(() => rangesOf(t), [t])
      const stackSeries = useMemo(() => seriesOf(t), [t])
      const today = todayKey()
      const range = useMemo(() => {
        if (rangeId === 'custom') return { id: 'custom', from: span?.from ?? shiftDay(today, -6), to: span?.to ?? today }
        const preset = ranges.find(item => item.id === rangeId) ?? ranges[1]
        if (preset.days === null) return { id: preset.id, from: null, to: today }
        return { id: preset.id, from: shiftDay(today, -(preset.days - 1)), to: today }
      }, [rangeId, span, today, ranges])

      const inRange = useCallback((row, from, to) => {
        const day = dayOf(row[0])
        if (from !== null && day < from) return false
        if (to !== null && day > to) return false
        return true
      }, [])

      const rows = useMemo(() => (view ? view.rows.filter(row => inRange(row, range.from, range.to)) : []), [view, range, inRange])

      /**
       * The ranking key of a model row: the exact provider/model route.
       *
       * Two providers that serve the same model id are different routes with
       * their own rate and their own plan, so merging them by display name
       * would hide which one the calls went through and price them as one row.
       * The page therefore ranks by route and shows the model name beside it.
       */
      const modelRoute = useCallback(index => view?.models[index]?.key || view?.models[index]?.name || '—', [view])
      const modelLabel = useCallback(index => view?.models[index]?.name || view?.models[index]?.key || '—', [view])
      const projectName = useCallback(index => view?.projects[index]?.name || view?.projects[index]?.key || '—', [view])

      const byModel = useMemo(() => summarize(rows, row => modelRoute(row[2])), [rows, modelRoute])
      const byProject = useMemo(() => summarize(rows, row => projectName(row[1])), [rows, projectName])

      /** Top models get their own series; the rest fold into one bucket. */
      const modelSeries = useMemo(() => {
        const top = byModel.groups.slice(0, 4)
        const list = top.map((group, index) => ({ key: group.key, label: group.key, token: INKS[index % INKS.length] }))
        if (byModel.groups.length > top.length) {
          list.push({ key: t('other'), label: t('other'), token: 'var(--dsw-alias-label-quaternary)' })
        }
        return list
      }, [byModel, t])

      const days = useMemo(() => {
        if (showBy !== 'model') return byDay(rows, range.from, range.to)
        const keys = new Set(modelSeries.map(item => item.key))
        const merged = new Map()
        for (const row of rows) {
          const name = modelRoute(row[2])
          const key = keys.has(name) ? name : t('other')
          const day = dayOf(row[0])
          const entry = merged.get(day) ?? { day, calls: 0, cost: 0, tokens: 0 }
          entry[key] = (entry[key] ?? 0) + tokensOf(row)
          entry.calls += row[CALLS]
          entry.cost += row[COST]
          entry.tokens += tokensOf(row)
          merged.set(day, entry)
        }
        return [...merged.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
      }, [rows, showBy, modelSeries, modelRoute, range, t])

      // The heatmap shows the whole history, not the picked range: its job is
      // the long-term rhythm, and a range-filtered one goes blank on "today".
      const heatDays = useMemo(() => (view ? byDay(view.rows, null, null) : []), [view])

      const series = showBy === 'model' ? modelSeries : stackSeries
      const topModel = byModel.groups[0]
      const paintOf = index => INKS[index % INKS.length]

      const onCustom = (field, value) => {
        setSpan(previous => ({ from: previous?.from ?? shiftDay(today, -6), to: previous?.to ?? today, [field]: value }))
      }

      /**
       * Open the Sessions behind one project or model row.
       *
       * The range goes over as epoch milliseconds from the browser's own
       * calendar, so "last 7 days" means the same days on both sides without
       * agreeing on a time zone.
       */
      const openDrill = useCallback(async (selection) => {
        const fromMs = range.from === null
          ? 0
          : new Date(`${range.from}T00:00:00`).getTime()
        const toMs = range.to === null
          ? Date.now()
          : new Date(`${range.to}T00:00:00`).getTime() + 86_400_000
        setDrill(selection)
        setDrillRows([])
        setDrillError('')
        setDrillLoading(true)
        try {
          const response = await fetch(DETAIL_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              from: fromMs,
              to: toMs,
              ...(selection.project === undefined ? {} : { project: selection.project }),
              ...(selection.provider === undefined ? {} : { provider: selection.provider, model: selection.model }),
              limit: 10,
            }),
          })
          const body = await response.json()
          if (body?.ok !== true) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
          setDrillRows(body.value?.sessions ?? [])
          setDrillError('')
        } catch (failure) {
          setDrillError(failure?.message ?? String(failure))
        } finally {
          setDrillLoading(false)
        }
      }, [range.from, range.to])

      // Switching range makes an open drill-down answer a question about the old
      // range, so close it rather than show stale Sessions under a new label.
      useEffect(() => {
        setDrill(null)
        setDrillRows([])
      }, [rangeId, span?.from, span?.to])

      // A cold cache answers at once with nothing in it while the first pass
      // runs behind the request; that is "still reading", not "no usage".
      const reading = view !== null && view.primed === false
      const status = view === null
        ? null
        : [
            reading
              ? { key: 'scan', text: scanText(view, t), live: true }
              : view.scanning ? { key: 'scan', text: t('scanning'), live: true } : null,
            view.cached ? null : { key: 'cache', text: t('scanning'), live: false },
          ].filter(Boolean)

      return h('div', { className: 'td' },
        // One row: title and a live scan note on the left, the range on the
        // right. The range ends where the cards end, so the row reads as the
        // top edge of the same column.
        h('div', { className: 'td-top' },
          h('div', { className: 'td-top-lead' },
            h('h2', { className: 'td-title' }, t('title')),
            status === null
              ? null
              : h('div', { className: 'td-status' },
                  status.map(item => h('span', {
                    key: item.key,
                    className: item.live ? 'td-note' : 'td-note td-note-quiet',
                  }, item.text)),
                ),
          ),
          h(Tabs, {
            value: rangeId,
            onChange: setRangeId,
            options: ranges.map(item => [item.id, item.label]),
          }),
        ),

        // The signed-in picture sits below the title row, centered.
        h('div', { className: 'td-identity' },
          h('div', { className: 'td-avatar-strip' },
            h('button', {
              type: 'button',
              className: avatarUrl === '' || avatarFailed ? 'td-avatar td-avatar-empty' : 'td-avatar',
              title: t('avatarPick'),
              'aria-label': t('avatarPick'),
              onClick: () => fileRef.current?.click(),
            },
              avatarUrl === '' || avatarFailed
                ? h('span', { className: 'td-avatar-plus', 'aria-hidden': true }, '+')
                : h('img', { src: avatarUrl, alt: '', onError: () => setAvatarFailed(true) }),
            ),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/png,image/jpeg,image/webp,image/gif',
              className: 'td-avatar-input',
              onChange: onPickAvatar,
            }),
            avatarUrl === '' || avatarFailed
              ? null
              : h('button', {
                  type: 'button',
                  className: 'td-avatar-clear',
                  title: t('avatarClear'),
                  onClick: () => void onPickAvatar(undefined, true),
                }, '×'),
          ),
          // The name and handle are the user's own, not the account's: they
          // edit each field in place, and an empty field shows a placeholder.
          h('div', { className: 'td-identity-lines' },
            h(EditableText, {
              value: profile.name,
              placeholder: t('namePlaceholder'),
              className: 'td-identity-name',
              label: t('nameLabel'),
              onSave: next => void onSaveProfile({ name: next }),
            }),
            profileError === ''
              ? null
              : h('span', { className: 'td-identity-error' },
                  profileError === 'restart' ? t('restartNeeded') : t('saveFailed')),
          ),
        ),

        rangeId === 'custom'
          ? h('div', { className: 'td-custom' },
              h('label', null, t('from'),
                h('input', {
                  type: 'date',
                  value: span?.from ?? shiftDay(today, -6),
                  max: span?.to ?? today,
                  onChange: event => onCustom('from', event.target.value),
                }),
              ),
              h('label', null, t('to'),
                h('input', {
                  type: 'date',
                  value: span?.to ?? today,
                  min: span?.from ?? shiftDay(today, -6),
                  max: today,
                  onChange: event => onCustom('to', event.target.value),
                }),
              ),
            )
          : null,

        error !== ''
          ? h('div', { className: 'td-error' },
              h('span', null, t('failedWith', { message: error })),
              h('button', { type: 'button', className: 'td-retry', onClick: () => void load() }, t('retry')),
            )
          : null,

        view === null
          ? h('div', { className: 'td-empty' }, h('b', null, t('reading')), h('span', null, '…'))
          : reading && rows.length === 0
            ? h('div', { className: 'td-empty' },
                h('b', null, t('reading')),
                h('span', null, view.progress?.total > 0
                  ? `${view.progress.total - (view.progress.pending ?? 0)} / ${view.progress.total}`
                  : '…'),
              )
            : rows.length === 0
              ? h('div', { className: 'td-empty' }, h('b', null, t('empty')))
              : h(React.Fragment, null,
                  h(Stats, { rangeId, total: byModel.total, t }),
                  h(Chart, { days, series, showBy, onBy: setShowBy, t }),
                  h('div', { className: 'td-pair' },
                    h('section', { className: 'td-card' },
                      h('div', { className: 'td-card-head' },
                        h('h3', null, t('byModel'), h('span', null, String(byModel.groups.length))),
                      ),
                      topModel === undefined
                        ? h('p', { className: 'td-none' }, t('nothing'))
                        : h('div', { className: 'td-podium' },
                            byModel.groups.slice(0, 3).map((group, index) => h('div', {
                              className: 'td-podium-cell',
                              key: group.key,
                            },
                              h('span', { className: 'td-podium-rank' }, `#${index + 1}`),
                              h(Brand, {
                                provider: group.key.split('/')[0],
                                model: group.key.split('/').slice(1).join('/'),
                                paint: paintOf(index),
                                size: 28,
                              }),
                              h('div', { className: 'td-podium-body' },
                                h('div', { className: 'td-podium-name', title: group.key },
                                  modelOf(view, group.key)?.name ?? group.key),
                                h('div', { className: 'td-podium-sub' },
                                  `${compact(group.tokens)} · ${percent(group.tokens, byModel.total.tokens)}`),
                              ),
                            )),
                          ),
                      h('div', { className: 'td-rows' },
                        byModel.groups.slice(0, 8).map((group, index) => h(Row, {
                          key: group.key,
                          name: modelOf(view, group.key)?.name ?? group.key,
                          sub: `${group.key.split('/')[0]} · ${money(group.cost)}${rateOf(view, group.key, t)}`,
                          value: group.tokens,
                          total: byModel.total.tokens,
                          paint: paintOf(index),
                          t,
                          // The route decides the brand mark: the family lives
                          // in the model id, and a reseller keeps it.
                          brand: {
                            provider: group.key.split('/')[0],
                            model: group.key.split('/').slice(1).join('/'),
                          },
                          // The row names a route, so the host filters by it.
                          onOpen: () => void openDrill({
                            kind: 'model',
                            label: group.key,
                            provider: group.key.split('/')[0],
                            model: group.key.split('/').slice(1).join('/'),
                          }),
                          active: drill?.kind === 'model' && drill.label === group.key,
                        })),
                      ),
                    ),
                    h('section', { className: 'td-card' },
                      h('div', { className: 'td-card-head' },
                        h('h3', null, t('byProject'), h('span', null, String(byProject.groups.length))),
                      ),
                      byProject.groups.length === 0
                        ? h('p', { className: 'td-none' }, t('nothing'))
                        : h('div', { className: 'td-rows' },
                            byProject.groups.slice(0, 8).map((group, index) => h(Row, {
                              key: group.key,
                              name: group.key,
                              sub: money(group.cost),
                              value: group.tokens,
                              total: byProject.total.tokens,
                              paint: paintOf(index),
                              t,
                              onOpen: () => void openDrill({ kind: 'project', label: group.key, project: group.key }),
                              active: drill?.kind === 'project' && drill.label === group.key,
                            })),
                          ),
                    ),
                  ),
                  drill === null
                    ? null
                    : h(Drill, {
                        label: drill.label,
                        sessions: drillRows,
                        loading: drillLoading,
                        error: drillError,
                        onClose: () => { setDrill(null); setDrillRows([]) },
                        t,
                      }),
                  h(Heat, { days: heatDays, t, uiLocale }),
                ),
      )
    }

    /** Section styles, expressed in Host theme tokens. */
    const CSS = `
.td{
  display:flex;flex-direction:column;gap:14px;padding-bottom:4px;container-type:inline-size;color:var(--dsw-alias-label-primary);
  /* 53 columns must fit the card. The grid lives inside a card with 16px side
     padding, so 100cqw must lose that padding and the 52 gaps between cells.
     The floor keeps a cell legible in the narrowest panel. */
  /* The grid must fit the card exactly. 100cqw is the section; the card adds
     18px of padding per side (36px), and 52 gaps sit between the 53 columns.
     The remainder divided by 53 is the cell, so the tracks end on the card's
     inner edge. A cap keeps a very wide panel from drawing coarse squares. */
  /* One row of 53 weeks must fit the card: 100cqw is the section, minus the
     card padding (36px) and 52 gaps. That is the physical ceiling on the cell. */
  --td-cell-gap:2px;
  --td-cell-size:calc((100cqw - 36px - 104px) / 53);
  /* One pink at rising strength, mixed with transparent so the card behind
     shows through. An alpha tint adapts to the Host light and dark themes by
     itself; fixed colours needed a theme detector this plugin cannot rely on.
     The empty cell is a faint tint of the text colour, so it stays visible on
     either background. */
  --td-heat-empty:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  --td-heat-void:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  --td-heat-1:color-mix(in srgb, #e8629a 22%, transparent);
  --td-heat-2:color-mix(in srgb, #e8629a 40%, transparent);
  --td-heat-3:color-mix(in srgb, #e8629a 60%, transparent);
  --td-heat-4:color-mix(in srgb, #de4a86 82%, transparent);
  --td-heat-5:#d63b78;
}
/* The picture sits alone above the section, centered. It is an upload control:
   empty shows a plus, and a set picture can be replaced or removed. */
.td-avatar-strip{position:relative;display:flex;justify-content:center;align-items:center;gap:6px;padding:2px 0 6px}
.td-avatar{width:46px;height:46px;padding:0;border:0;border-radius:50%;overflow:hidden;background:var(--dsw-alias-fill-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.td-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.td-avatar:hover{box-shadow:0 0 0 2px var(--dsw-alias-border-l2)}
.td-avatar-empty{border:1px dashed var(--dsw-alias-border-l3);background:none;color:var(--dsw-alias-label-tertiary)}
.td-avatar-plus{font-size:20px;line-height:1;font-weight:300}
.td-avatar-input{display:none}
.td-avatar-clear{width:18px;height:18px;padding:0;border:0;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.td-avatar-clear:hover{color:var(--dsw-alias-label-primary)}
/* The card is a picture above a name, centred, like the account page. */
.td-identity{display:flex;flex-direction:column;align-items:center;gap:2px;padding:2px 0 4px}
.td-identity-lines{display:flex;flex-direction:column;align-items:center;gap:1px;max-width:100%}
.td-identity-name{max-width:100%;padding:1px 6px;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;line-height:19px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text}
.td-identity-name:hover{background:var(--dsw-alias-interactive-bg-hover)}
.td-identity-empty{color:var(--dsw-alias-label-quaternary);font-weight:400}
.td-identity-input{max-width:160px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;line-height:19px;font-weight:600;text-align:center;outline:none}
.td-identity-input:focus{border-color:var(--dsw-alias-brand-primary)}
.td-identity-error{font-size:11px;line-height:15px;color:var(--dsw-alias-state-warning-primary,#d99a2b)}
/* Title row: the lead group holds the title and the live note; the range sits
   at the far edge so it ends where the cards do. */
/* The title row shares its baseline with the nav row beside it: both are 24px
   lines at the top of the panel body, one 40px cell tall. */
/* The host's nav list starts 10px below the panel body's top edge (the nav title
   and its gap push it down). The title row takes that offset plus the nav row's
   40px height, so its centre line is the nav row's centre line. */
.td-top{position:relative;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:nowrap;min-height:40px;margin-top:10px}
.td-top-lead{display:flex;align-items:center;gap:10px;min-width:0;flex:0 1 auto}
.td-title{margin:0;font-size:16px;line-height:24px;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
/* One row only: the range must end on the cards' right edge, so it cannot wrap
   away from it. */
.td-top .td-tabs{flex:0 0 auto}
.td-tabs{display:inline-flex;flex:none;padding:3px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover)}
.td-tabs button{display:inline-flex;align-items:center;height:24px;padding:0 9px;border:0;border-radius:999px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:24px;white-space:nowrap;cursor:pointer;transition:color .15s ease,background-color .15s ease}
/* Six ranges must fit one row beside the title in a narrow panel; below that
   the row wraps rather than overflowing. */
.td-tabs{flex-wrap:nowrap}
.td-tabs button:hover{color:var(--dsw-alias-label-primary)}
.td-tabs button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.08),0 0 0 .5px var(--dsw-alias-border-l2)}
.td-tabs-sm button{height:22px;line-height:22px;font-size:11px;padding:0 9px}
.td-status{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.td-note{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.td-note::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:td-pulse 1.4s ease-in-out infinite}
.td-note-quiet::before{display:none}
.td-custom{display:flex;gap:10px;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.td-custom label{display:flex;gap:5px;align-items:center}
.td-custom input{font:inherit;font-size:12px;padding:3px 7px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.td-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-radius:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);animation:td-in .45s cubic-bezier(.22,1,.36,1) backwards}
/* Every cell is the same box: a label, a value line, and a supporting line, in
   that order and with the same spacing, so the grid reads as one row of peers.
   The content is centred as a group: the cells were tall enough to leave a gap
   under the figures, which read as padding rather than structure. */
.td-stat{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;min-width:0;padding:12px 15px;text-align:center}
/* All four cells fit one row once the section itself is wide enough. The query
   is on the section's own width, not the window: the Settings panel is a
   fixed-width modal, so a viewport query would apply while the panel is narrow
   and squeeze four columns into it. */
@container (min-width:600px){.td-stats{grid-template-columns:1.5fr 1fr 1fr 1fr}}
.td-stat+.td-stat{border-left:1px solid var(--dsw-alias-border-l1)}
.td-stats .td-stat:nth-child(3){border-left:0;border-top:1px solid var(--dsw-alias-border-l1)}
.td-stats .td-stat:nth-child(4){border-top:1px solid var(--dsw-alias-border-l1)}
@container (min-width:600px){
  .td-stats .td-stat:nth-child(3){border-left:1px solid var(--dsw-alias-border-l1);border-top:0}
  .td-stats .td-stat:nth-child(4){border-left:1px solid var(--dsw-alias-border-l1);border-top:0}
}
.td-stat-label{max-width:100%;overflow:hidden;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis}
/* One figure size for all four cells. A larger number in one cell made the row
   read as a hero card beside three footnotes. */
.td-stat-value{display:flex;align-items:baseline;min-width:0;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-.015em;font-variant-numeric:tabular-nums;white-space:nowrap}
.td-stat-value small{font-size:12px;font-weight:400;letter-spacing:0;color:var(--dsw-alias-label-tertiary)}
.td-stat-sub{display:flex;align-items:center;justify-content:center;max-width:100%;overflow:hidden;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;text-overflow:ellipsis}
.td-stat-cost{display:flex;flex-wrap:nowrap;align-items:baseline;justify-content:center;gap:5px;overflow:hidden;font-variant-numeric:tabular-nums;white-space:nowrap}
.td-stat-cost em{font-style:normal;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.td-stat-cost b{font-size:12.5px;line-height:16px;font-weight:600;color:var(--dsw-alias-brand-primary)}
.td-stat-cost-alt{overflow:hidden;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis}
.td-delta{align-self:center;margin-left:2px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-fill-tertiary);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:20px;font-weight:500;letter-spacing:0}
.td-delta-down{color:var(--dsw-alias-state-success-primary)}
.td-card{display:flex;flex-direction:column;gap:12px;min-width:0;padding:14px 18px 16px;border-radius:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);animation:td-in .45s cubic-bezier(.22,1,.36,1) backwards}
.td-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px}
.td-card-head h3{display:flex;align-items:baseline;gap:8px;min-width:0;margin:0;font-size:13px;line-height:18px;font-weight:600}
.td-card-head h3 span{font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.td-chart-body{display:flex;flex-direction:column;gap:8px;padding-top:6px}
.td-plot{position:relative;height:200px;margin-left:40px}
.td-grid{position:absolute;left:0;right:0;border-top:1px dashed var(--dsw-alias-border-l2);pointer-events:none}
.td-grid-base{border-top:1px solid var(--dsw-alias-border-l2)}
.td-grid span{position:absolute;right:calc(100% + 8px);top:-8px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.td-cols{position:absolute;inset:0;display:flex;align-items:flex-end}
.td-col{position:relative;flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center}
.td-stack{display:flex;flex-direction:column-reverse;gap:2px;width:min(72%,28px);min-width:3px;transform-origin:50% 100%;animation:td-grow .6s cubic-bezier(.22,1,.36,1) backwards;animation-delay:calc(var(--i,0) * 12ms)}
.td-stack>i{flex:1 1 0;min-height:2px;border-radius:5px;transition:flex-grow .45s cubic-bezier(.22,1,.36,1)}
.td-plot[data-hover] .td-col:not([data-on]) .td-stack{opacity:.3}
.td-stub{width:4px;height:4px;margin-bottom:-2px;border-radius:50%;background:var(--dsw-alias-border-l2)}
.td-ticks{display:flex;margin-left:40px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.td-ticks span{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap}
.td-ticks span[data-now]{color:var(--dsw-alias-label-primary);font-weight:500}
.td-tip{position:absolute;top:6px;z-index:3;min-width:168px;max-width:250px;padding:10px 12px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 18px 40px -16px rgba(0,0,0,.3);pointer-events:none;display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.td-tip-title{color:var(--dsw-alias-label-tertiary)}
.td-tip-total{margin:0 0 4px;font-size:15px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.td-tip-row{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
.td-tip-row b{margin-left:auto;font-weight:600;color:var(--dsw-alias-label-primary)}
.td-tip-dot{width:8px;height:8px;border-radius:3px;flex:none}
.td-tip-name{color:var(--dsw-alias-label-tertiary)}
.td-tip-foot{border-top:1px solid var(--dsw-alias-border-l1);padding-top:5px}
.td-legend{display:flex;flex-wrap:wrap;gap:6px}
.td-key{display:inline-flex;align-items:center;gap:6px;min-width:0;height:24px;padding:0 10px 0 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:24px}
.td-dot{width:8px;height:8px;border-radius:3px;flex:none}
.td-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.td-rows{display:flex;flex-direction:column;margin:0 -8px}
.td-row{display:flex;align-items:center;gap:12px;width:100%;padding:8px;border:0;border-radius:12px;background:none;color:inherit;font:inherit;text-align:left;transition:background-color .12s ease;animation:td-in .4s cubic-bezier(.22,1,.36,1) backwards}
button.td-row{cursor:pointer}
.td-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.td-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.td-row-open{background:var(--dsw-alias-interactive-bg-hover)}
.td-row-more{flex:none;margin-left:-2px;font-size:15px;line-height:1;color:var(--dsw-alias-label-quaternary);transition:color .12s ease,transform .12s ease}
button.td-row:hover .td-row-more{color:var(--dsw-alias-label-secondary);transform:translateX(1px)}
.td-brand{flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;background:var(--dsw-alias-fill-tertiary);color:inherit}
.td-brand svg{display:block}
.td-glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:30%;font-weight:600;line-height:1}
.td-row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.td-row-line{display:flex;align-items:baseline;flex-wrap:wrap;column-gap:8px;row-gap:1px;min-width:0;font-size:13px;line-height:18px}
/* The name keeps its room; the subtitle wraps under it when the row is narrow
   rather than squeezing the name out of recognition. */
.td-row-name{flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
/* The subtitle carries four facts (provider, cost, rate, badges). Clamping it
   to two lines keeps every row the same height and drops nothing important,
   where a one-line ellipsis was cutting the rate off in a narrow panel. */
.td-row-sub{flex:1 1 8em;min-width:0;max-width:100%;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.td-track{display:block;height:4px;border-radius:999px;background:var(--dsw-alias-fill-tertiary);overflow:hidden}
.td-track-fill{display:block;height:100%;border-radius:999px;transition:width .45s cubic-bezier(.22,1,.36,1)}
.td-row-num{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:48px;font-variant-numeric:tabular-nums}
.td-row-num b{font-size:13px;line-height:18px;font-weight:600}
.td-row-num small{font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
/* The top three models as one row of equal cells: a single large ring beside
   three short lines left the right half of the card empty. */
.td-podium{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:2px 0 6px}
@container (max-width:520px){.td-podium{grid-template-columns:minmax(0,1fr)}}
.td-podium-cell{display:flex;align-items:center;gap:9px;min-width:0;padding:8px 10px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover)}
.td-podium-rank{flex:none;font-size:11px;line-height:14px;font-weight:600;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.td-podium-body{display:flex;flex-direction:column;gap:1px;min-width:0}
.td-podium-name{overflow:hidden;font-size:12.5px;line-height:17px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.td-podium-sub{overflow:hidden;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.td-profile{display:flex;align-items:center;gap:20px;padding:2px 4px 6px}
.td-ring{position:relative;flex:none;width:96px;height:96px}
.td-ring-track{stroke:var(--dsw-alias-border-l1)}
.td-ring-arc{stroke-linecap:round;transition:stroke-dasharray .6s cubic-bezier(.22,1,.36,1);animation:td-ring 1s cubic-bezier(.22,1,.36,1) .1s backwards}
.td-ring-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.td-profile-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.td-profile-copy h3{margin:0;font-size:15px;line-height:20px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-profile-sub{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.td-heat-wrap{display:flex;flex-direction:column;gap:10px;padding-bottom:2px}
.td-heat-row{display:flex;flex-direction:column;gap:4px}
.td-heat-months{display:grid;gap:var(--td-cell-gap,2px);font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary);overflow:visible}
.td-heat-months span{white-space:nowrap;overflow:visible}
.td-heat-grid{display:grid;grid-template-rows:repeat(7,var(--td-cell-size,11px));grid-auto-flow:column;gap:var(--td-cell-gap,3px)}
.td-cell{position:relative;display:block;width:var(--td-cell-size,12px);height:var(--td-cell-size,12px);border-radius:2.5px;background:var(--td-heat-empty)}
/* Padding outside the year keeps its column but draws no fill: an invisible
   cell would read as lost data. */
.td-cell-void{background:none;box-shadow:inset 0 0 0 1px var(--td-heat-void)}
/* The outline is a hairline, not a highlight: it marks the current day without
   pulling the eye away from the year's shape. */
.td-lv0{background:var(--td-heat-empty)}
.td-lv1{background:var(--td-heat-1)}
.td-lv2{background:var(--td-heat-2)}
.td-lv3{background:var(--td-heat-3)}
.td-lv4{background:var(--td-heat-4)}
.td-lv5{background:var(--td-heat-5)}
.td-heat-scale{display:flex;align-items:center;justify-content:flex-end;gap:3px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
.td-heat-scale .td-cell{width:10px;height:10px;border-radius:2.5px}
.td-drill{padding-bottom:8px}
.td-drill .td-card-head h3 span{overflow:hidden;max-width:60%;text-overflow:ellipsis;white-space:nowrap}
.td-drill-close{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:24px;cursor:pointer}
.td-drill-close:hover{color:var(--dsw-alias-label-primary)}
.td-drill-note{margin:0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.td-drill-row{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:10px}
.td-drill-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.td-drill-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.td-drill-name{overflow:hidden;font-size:12.5px;line-height:17px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.td-drill-sub{overflow:hidden;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}
.td-none{margin:0;padding:14px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.td-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:48px 0;text-align:center}
.td-empty b{font-size:14px;font-weight:600}
.td-empty span{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.td-error{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px}
.td-retry{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;padding:2px 10px;border-radius:999px;cursor:pointer}
@keyframes td-pulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes td-in{from{opacity:0;transform:translateY(4px)}}
@keyframes td-grow{from{transform:scaleY(.02);opacity:.4}}
@keyframes td-ring{from{stroke-dasharray:0 999}}
`

    /**
     * The user's own profile card, read once and shared.
     *
     * No account picture is available to a plugin, so this is work the user
     * supplies: a picture and a display name. The value is a plain object, empty
     * until the read settles.
     */
    function createProfileStore(ctx) {
      const listeners = new Set()
      let snapshot = { url: '', name: '' }
      let started = false
      const publish = (next) => {
        const same = next.url === snapshot.url && next.name === snapshot.name
        snapshot = next
        if (!same) for (const listener of listeners) listener()
      }
      const load = async () => {
        try {
          const response = await fetch(AVATAR_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          const body = await response.json()
          if (body?.ok !== true) return
          publish({
            url: typeof body.value?.url === 'string' ? body.value.url : '',
            name: typeof body.value?.name === 'string' ? body.value.name : '',
          })
        } catch (error) {
          ctx.logger?.warn?.('token-dashboard: profile unavailable: %s',
            error?.message ?? error)
        }
      }
      return {
        subscribe(listener) {
          listeners.add(listener)
          if (!started) {
            started = true
            void load()
          }
          return () => listeners.delete(listener)
        },
        getSnapshot: () => snapshot,
      }
    }

    return {
      // The picture arrives through this plugin's own Host route, so the page
      // needs no `remote.*` namespace. Those are granted per package and a
      // wrong name would stop the whole plugin from loading.
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        const tagId = 'dsh-token-dashboard/section.css'
        ctx.effect(() => {
          if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return () => {}
          const tag = document.createElement('style')
          tag.dataset.pluginCss = tagId
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'token-dashboard: styles')

        // The slot entry declares this namespace, so the renderer refuses to
        // assemble the section until the dictionaries are registered.
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-dashboard: dictionaries')

        // A model call publishes `api-session/activity` when the Host records a
        // user message. Subscribing to it is what replaces the idle poll: the
        // page updates when there is new usage, not on a timer. The subscription
        // is optional — a Host without forwarded events keeps the poll-only path.
        /** Set by the mounted section, so a forwarded event can refresh it. */
        const refresh = { reload: null }
        ctx.effect(() => {
          if (typeof ctx.remote?.$on !== 'function') return () => {}
          let timer
          const dispose = ctx.remote.$on('api-session/activity', () => {
            // Coalesce a burst: one refresh per second is enough for a page.
            if (timer !== undefined) return
            timer = setTimeout(() => {
              timer = undefined
              refresh.reload?.()
            }, 1_000)
          })
          return () => {
            clearTimeout(timer)
            dispose?.()
          }
        }, 'token-dashboard: refresh on activity')

        // One account read for the whole section, shared across re-renders.
        const avatar = createProfileStore(ctx)

        // `label` is called with no arguments; binding the namespace here keeps
        // the navigation label in the active language on every re-render.
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'token-dashboard',
          order: 25,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({
            // Heatmap month headers are data, not copy: `Intl` formats them for
            // the active UI language instead of the dictionary.
            uiLocale: ctx.locale.getSnapshot().active,
            // The signed-in picture. Passed as the store rather than a value:
            // the account read answers after the first render, so the section
            // subscribes and shows the picture when it arrives.
            avatar,
            // The section registers its reload here so a forwarded activity
            // event can refresh it without a timer.
            refresh,
          }),
        }, TokenDashboard))
      },
    }
  },
})
