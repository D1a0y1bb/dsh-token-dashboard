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
    /** Dictionary namespace; also the slot entry's `locale` option. */
    const NS = 'tokenDashboard'

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
      callsUnit: 'calls',
      input: 'Input',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      output: 'Output',
      cacheHit: 'Cache hit rate',
      byModel: 'By model',
      byProject: 'By project',
      trend: 'Trend',
      heat: 'Activity',
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
      less: 'Less',
      more: 'More',
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
      callsUnit: '次调用',
      input: '输入',
      cacheRead: '缓存读',
      cacheWrite: '缓存写',
      output: '输出',
      cacheHit: '缓存命中率',
      byModel: '按模型',
      byProject: '按项目',
      trend: '趋势',
      heat: '活跃度',
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
      less: '少',
      more: '多',
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
    function Stats({ rangeId, total, previous, t }) {
      const shown = useTween(total.tokens)
      const change = previous > 0 ? Math.round(((total.tokens - previous) / previous) * 100) : null
      const cacheHit = total.cacheRead + total.input > 0
        ? (total.cacheRead / (total.cacheRead + total.input)) * 100
        : 0
      return h('section', { className: 'td-stats' },
        h('div', { className: 'td-stat td-stat-main' },
          h('span', { className: 'td-stat-label' }, rangeLabel(rangeId, t)),
          h('span', { className: 'td-stat-value' },
            compact(shown),
            h('small', null, t('tokens')),
            change === null ? null : h('span', {
              className: change >= 0 ? 'td-delta' : 'td-delta td-delta-down',
            }, `${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}%`),
          ),
          h('span', { className: 'td-stat-cost' },
            h('em', null, t('meteredCost')),
            h('b', null, money(total.metered)),
            total.cost - total.metered > 0.005
              ? h('em', { className: 'td-stat-cost-alt' }, `${t('planValue')} ${money(total.cost - total.metered)}`)
              : null,
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

    /** One ranked row: glyph, name, share track, and the figure. */
    function Row({ name, sub, value, total, paint, t }) {
      const width = total > 0 ? Math.max(value > 0 ? 2 : 0, (value / total) * 100) : 0
      return h('div', {
        className: 'td-row',
        title: `${fmt(value)} ${t('tokens')} · ${percent(value, total)}`,
      },
        h(Glyph, { name, paint }),
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
      )
    }

    /** The share ring with the leader's glyph in the middle. */
    function Ring({ name, value, total, paint }) {
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
        h('span', { className: 'td-ring-face' }, h(Glyph, { name, paint, size: 44 })),
      )
    }

    /** A GitHub-style calendar heatmap of daily spend. */
    function Heat({ days, weeks: weekCount = 26, t, uiLocale }) {
      const cells = useMemo(() => {
        if (days.length === 0) return { columns: [], months: [], peak: 0 }
        const byDay = new Map(days.map(day => [day.day, day]))
        const last = days[days.length - 1].day
        // End on the Sunday of the current week so the grid is always full.
        const tail = 6 - weekday(last)
        const end = shiftDay(last, tail)
        const start = shiftDay(end, -(weekCount * 7 - 1))
        const peak = Math.max(0, ...days.map(day => day.tokens))
        const columns = []
        const months = []
        const names = monthNames(uiLocale)
        let previousMonth = ''
        for (let week = 0; week < weekCount; week += 1) {
          const monday = shiftDay(start, week * 7)
          const month = monday.slice(0, 7)
          if (month !== previousMonth) {
            months.push({ column: week, label: names[Number(month.slice(5)) - 1] })
            previousMonth = month
          }
          columns.push(Array.from({ length: 7 }, (_, offset) => {
            const day = shiftDay(monday, offset)
            const entry = byDay.get(day)
            return { day, tokens: entry?.tokens ?? 0, cost: entry?.cost ?? 0, future: day > last }
          }))
        }
        return { columns, months, peak }
      }, [days, weekCount, uiLocale])

      const level = (value) => {
        if (!(value > 0)) return 0
        // A square root keeps a few heavy days from flattening the rest.
        return Math.max(1, Math.ceil(4 * Math.sqrt(value / (cells.peak || 1))))
      }
      const today = todayKey()

      return h('section', { className: 'td-card' },
        h('div', { className: 'td-card-head' },
          h('h3', null, t('heat'), h('span', null, t('dayCount', { n: weekCount * 7 }))),
          h('div', { className: 'td-heat-scale' },
            h('span', null, t('less')),
            [0, 1, 2, 3, 4].map(item => h('i', { key: item, className: `td-cell td-lv${item}` })),
            h('span', null, t('more')),
          ),
        ),
        cells.columns.length === 0
          ? h('p', { className: 'td-none' }, t('nothing'))
          : h('div', { className: 'td-heat-wrap' },
              h('div', { className: 'td-heat-months', style: { gridTemplateColumns: `repeat(${cells.columns.length}, 13px)` } },
                cells.months.map(month => h('span', { key: month.column, style: { gridColumn: month.column + 1 } }, month.label)),
              ),
              h('div', { className: 'td-heat-grid', style: { gridTemplateColumns: `repeat(${cells.columns.length}, 13px)` } },
                cells.columns.flatMap((column, w) => column.map((cell, d) => h('span', {
                  key: `${w}-${d}`,
                  className: cell.future ? 'td-cell td-cell-void' : `td-cell td-lv${level(cell.tokens)}`,
                  'data-today': cell.day === today ? '' : undefined,
                  title: cell.future ? undefined : `${cell.day} · ${fmt(cell.tokens)} ${t('tokens')} · ${money(cell.cost)}`,
                }))),
              ),
            ),
      )
    }

    /** The whole section. `t` arrives from the slot kit for the declared namespace. */
    function TokenDashboard({ t, uiLocale }) {
      const [view, setView] = useState(null)
      const [error, setError] = useState('')
      const [rangeId, setRangeId] = useState('7d')
      const [span, setSpan] = useState(null)
      const [showBy, setShowBy] = useState('day')
      const stopped = useRef(false)
      const scanningRef = useRef(false)

      const load = useCallback(async () => {
        try {
          const response = await fetch(ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
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
        // Poll quickly while a scan fills the ledger, then settle to a slow
        // refresh so a new model call shows up without a reload.
        let timer
        const tick = async () => {
          await load()
          if (stopped.current) return
          timer = setTimeout(tick, scanningRef.current ? 1_200 : 20_000)
        }
        void tick()
        return () => {
          stopped.current = true
          clearTimeout(timer)
        }
      }, [load])

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

      const previousRows = useMemo(() => {
        if (!view || range.from === null || range.to === null) return []
        const length = dayCount(range.from, range.to)
        const prevTo = shiftDay(range.from, -1)
        const prevFrom = shiftDay(prevTo, -(length - 1))
        return view.rows.filter(row => inRange(row, prevFrom, prevTo))
      }, [view, range, inRange])

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
      const previousTotal = useMemo(() => summarize(previousRows, () => 'all').total, [previousRows])

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
        h('div', { className: 'td-top' },
          h('h2', { className: 'td-title' }, t('title')),
          h(Tabs, {
            value: rangeId,
            onChange: setRangeId,
            options: ranges.map(item => [item.id, item.label]),
          }),
          status === null
            ? null
            : h('div', { className: 'td-status' },
                status.map(item => h('span', {
                  key: item.key,
                  className: item.live ? 'td-note' : 'td-note td-note-quiet',
                }, item.text)),
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
                  h(Stats, { rangeId, total: byModel.total, previous: previousTotal.tokens, t }),
                  h(Chart, { days, series, showBy, onBy: setShowBy, t }),
                  h('div', { className: 'td-pair' },
                    h('section', { className: 'td-card' },
                      h('div', { className: 'td-card-head' },
                        h('h3', null, t('byModel'), h('span', null, String(byModel.groups.length))),
                      ),
                      topModel === undefined
                        ? h('p', { className: 'td-none' }, t('nothing'))
                        : h('div', { className: 'td-profile' },
                            h(Ring, {
                              name: topModel.key,
                              value: topModel.tokens,
                              total: byModel.total.tokens,
                              paint: paintOf(0),
                            }),
                            h('div', { className: 'td-profile-copy' },
                              h('h3', null, modelOf(view, topModel.key)?.name ?? topModel.key),
                              h('span', { className: 'td-profile-sub' }, topModel.key.split('/')[0]),
                              h('span', { className: 'td-profile-sub' },
                                `${compact(topModel.tokens)} ${t('tokens')} · ${percent(topModel.tokens, byModel.total.tokens)}`),
                              h('span', { className: 'td-profile-sub' },
                                `${fmt(topModel.calls)} ${t('callsUnit')} · ${money(topModel.cost)}`),
                            ),
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
                            })),
                          ),
                    ),
                  ),
                  h(Heat, { days: heatDays, t, uiLocale }),
                ),
      )
    }

    /** Section styles, expressed in Host theme tokens. */
    const CSS = `
.td{display:flex;flex-direction:column;gap:14px;padding-bottom:4px;color:var(--dsw-alias-label-primary)}
.td-top{position:relative;z-index:4;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.td-title{flex:1 1 auto;margin:0;font-size:16px;line-height:24px;font-weight:600}
.td-tabs{display:inline-flex;flex:none;padding:3px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover)}
.td-tabs button{display:inline-flex;align-items:center;height:26px;padding:0 12px;border:0;border-radius:999px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:26px;white-space:nowrap;cursor:pointer;transition:color .15s ease,background-color .15s ease}
.td-tabs button:hover{color:var(--dsw-alias-label-primary)}
.td-tabs button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.08),0 0 0 .5px var(--dsw-alias-border-l2)}
.td-tabs-sm button{height:22px;line-height:22px;font-size:11px;padding:0 9px}
.td-status{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.td-note{display:inline-flex;align-items:center;gap:7px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.td-note::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:td-pulse 1.4s ease-in-out infinite}
.td-note-quiet::before{display:none}
.td-custom{display:flex;gap:10px;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.td-custom label{display:flex;gap:5px;align-items:center}
.td-custom input{font:inherit;font-size:12px;padding:3px 7px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.td-stats{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;border-radius:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);animation:td-in .45s cubic-bezier(.22,1,.36,1) backwards}
.td-stat{display:flex;flex-direction:column;justify-content:flex-end;gap:6px;min-width:0;padding:16px 18px}
.td-stat+.td-stat{border-left:1px solid var(--dsw-alias-border-l1)}
.td-stat-label{overflow:hidden;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis}
.td-stat-value{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap}
.td-stat-value small{font-size:13px;font-weight:400;letter-spacing:0;color:var(--dsw-alias-label-tertiary)}
.td-stat-main .td-stat-value{font-size:34px;line-height:40px;letter-spacing:-.025em}
.td-stat-sub{overflow:hidden;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;text-overflow:ellipsis}
.td-stat-cost{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 6px;font-variant-numeric:tabular-nums}
.td-stat-cost em{font-style:normal;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.td-stat-cost b{font-size:15px;line-height:20px;font-weight:600;color:var(--dsw-alias-brand-primary)}
.td-stat-cost-alt{flex-basis:100%}
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
.td-stack{display:flex;flex-direction:column-reverse;gap:2px;width:56%;min-width:4px;max-width:28px;transform-origin:50% 100%;animation:td-grow .6s cubic-bezier(.22,1,.36,1) backwards;animation-delay:calc(var(--i,0) * 12ms)}
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
.td-row{display:flex;align-items:center;gap:12px;padding:8px;border-radius:12px;transition:background-color .12s ease;animation:td-in .4s cubic-bezier(.22,1,.36,1) backwards}
.td-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.td-glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:30%;font-weight:600;line-height:1}
.td-row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.td-row-line{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:13px;line-height:18px}
.td-row-name{flex:0 1 auto;min-width:0;overflow:hidden;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.td-row-sub{flex:0 1 auto;min-width:0;overflow:hidden;font-size:12px;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}
.td-track{display:block;height:4px;border-radius:999px;background:var(--dsw-alias-fill-tertiary);overflow:hidden}
.td-track-fill{display:block;height:100%;border-radius:999px;transition:width .45s cubic-bezier(.22,1,.36,1)}
.td-row-num{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:52px;font-variant-numeric:tabular-nums}
.td-row-num b{font-size:13px;line-height:18px;font-weight:600}
.td-row-num small{font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
.td-profile{display:flex;align-items:center;gap:20px;padding:2px 4px 6px}
.td-ring{position:relative;flex:none;width:96px;height:96px}
.td-ring-track{stroke:var(--dsw-alias-border-l1)}
.td-ring-arc{stroke-linecap:round;transition:stroke-dasharray .6s cubic-bezier(.22,1,.36,1);animation:td-ring 1s cubic-bezier(.22,1,.36,1) .1s backwards}
.td-ring-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.td-profile-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.td-profile-copy h3{margin:0;font-size:15px;line-height:20px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-profile-sub{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.td-heat-wrap{display:flex;flex-direction:column;gap:6px;overflow-x:auto;padding-bottom:2px}
.td-heat-months{display:grid;gap:3px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);min-width:max-content}
.td-heat-months span{white-space:nowrap}
.td-heat-grid{display:grid;grid-template-rows:repeat(7,13px);grid-auto-flow:column;gap:3px;min-width:max-content}
.td-cell{position:relative;display:block;width:13px;height:13px;border-radius:3px;background:var(--dsw-alias-fill-tertiary)}
.td-cell-void{background:none}
.td-cell[data-today]{outline:1.5px solid var(--dsw-alias-label-tertiary);outline-offset:1px}
.td-lv0{background:var(--dsw-alias-fill-tertiary)}
.td-lv1{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent)}
.td-lv2{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 48%,transparent)}
.td-lv3{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 72%,transparent)}
.td-lv4{background:var(--dsw-alias-brand-primary)}
.td-heat-scale{display:flex;align-items:center;justify-content:flex-end;gap:4px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
.td-heat-scale .td-cell{width:11px;height:11px}
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
@media (max-width:760px){.td-stats{grid-template-columns:1fr 1fr}.td-stat:nth-child(3){border-left:0;border-top:1px solid var(--dsw-alias-border-l1)}.td-stat:nth-child(odd){border-left:0}}
`

    return {
      inject: ['slots', 'locale'],
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

        // `label` is called with no arguments; binding the namespace here keeps
        // the navigation label in the active language on every re-render.
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'token-dashboard',
          order: 25,
          label: () => t('nav'),
          locale: NS,
          // Heatmap month headers are data, not copy: `Intl` formats them for
          // the active UI language instead of the dictionary.
          inject: () => ({ uiLocale: ctx.locale.getSnapshot().active }),
        }, TokenDashboard))
      },
    }
  },
})
