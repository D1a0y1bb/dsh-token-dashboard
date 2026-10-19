/**
 * Model pricing for the token dashboard.
 *
 * Prices are USD per one million tokens, at list API rates. They exist to turn
 * a token count into a comparable figure, not to reproduce an invoice: a
 * provider reached through a subscription account bills a flat fee, so the
 * number is the value consumed rather than money owed.
 *
 * Resolution order, first match wins:
 *   1. an exact `provider/model` entry in the row's `prices` config;
 *   2. an exact `provider/model` entry in `EXACT`;
 *   3. the first `PATTERNS` entry whose provider and model patterns match;
 *   4. `FALLBACK`.
 *
 * Patterns are matched against the full model id, so a new model in a known
 * family is priced without a code change. Add a pattern rather than an exact
 * entry when a whole family shares a rate.
 *
 * @module dsh-token-dashboard/pricing
 */

/**
 * Providers reached through a subscription or free-tier account rather than
 * per-token API billing. Their cost is a value estimate, not a bill.
 */
export const SUBSCRIPTION_PROVIDERS = new Set([
  'deepseek-account',
  'buddy',
  'workbuddy',
  'opencode-go',
  'commandcode',
  'qoder',
  'qodercn',
  'zcode',
  'codearts',
  'trae',
  'lobsterai',
  'loomy',
  'raccoon',
  'cline',
  'vpsairbot',
  'cloversec',
  'our-free-model',
])

/**
 * Rates per million tokens. `cacheWrite` defaults to `input` when omitted,
 * which is what providers that bill a cache miss at the input rate charge.
 *
 * @typedef {{ input: number, output: number, cacheRead?: number, cacheWrite?: number }} Rate
 */

/** Exact `provider/model` rates that a pattern cannot express. */
export const EXACT = {
  'deepseek-official/deepseek-flash': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'deepseek-official/deepseek-v4-pro': { input: 0.66, output: 1.98, cacheRead: 0.0132 },
  'deepseek/deepseek-v4-flash': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'deepseek/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'deepseek/deepseek-v4-pro': { input: 0.66, output: 1.98, cacheRead: 0.0132 },
  'api/deepseek-v4-flash-0731': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'apiapikeyfan/deepseek-flash': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'gemini/gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075 },
  'apiapikeyfan/claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'opendesign/claude-haiku-5.5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'opencode-go/kimi-k2.7-code': { input: 0.95, output: 4, cacheRead: 0.19 },
  'opencode-go/qwen3.8-flash': { input: 0.1, output: 0.4, cacheRead: 0.01 },
  'opencode-go/gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.02 },
  'buddy/space-bunny': { input: 0.5, output: 0.5, cacheRead: 0.05 },
  'workbuddy/hy3': { input: 0.14, output: 0.58, cacheRead: 0.014 },
  'cloversec/Qwen3.8-27B-FP8': { input: 0.3, output: 1.2, cacheRead: 0.03 },
}

/**
 * Family rates. `provider` is an optional pattern; a `null` provider matches
 * every provider, so a model keeps its family rate wherever it is served.
 * Order matters: the first match wins, so put specific families first.
 *
 * @type {Array<{ provider: RegExp|null, model: RegExp, rate: Rate, note: string }>}
 */
export const PATTERNS = [
  // Free models. These are free at every host that serves them. The suffix is
  // spelled `-free`, `:free`, or `-free` after a version, so match any of them.
  { provider: null, model: /(?:^|[/-])ling-[\d.]+-flash(?:[-:]free)?$/i, rate: { input: 0, output: 0, cacheRead: 0 }, note: 'inclusionAI Ling Flash, free' },
  { provider: null, model: /[-:]free$/i, rate: { input: 0, output: 0, cacheRead: 0 }, note: 'free tier model' },
  { provider: null, model: /contributor-free$/i, rate: { input: 0, output: 0, cacheRead: 0 }, note: 'contributor free model' },

  // DeepSeek. Off-peak list rates; peak hours bill double. The flash family
  // keeps its rate across version bumps, so match any `v<N>[.<N>]-flash`.
  { provider: null, model: /deepseek-v[\d.]+-pro/i, rate: { input: 0.66, output: 1.98, cacheRead: 0.0132 }, note: 'DeepSeek V4 Pro off-peak' },
  { provider: null, model: /deepseek-v[\d.]+-flash|deepseek-flash/i, rate: { input: 0.15, output: 0.6, cacheRead: 0.003 }, note: 'DeepSeek V4.1 Flash off-peak' },
  { provider: null, model: /deepseek-v3\.2|deepseek-chat|deepseek-reasoner/i, rate: { input: 0.28, output: 0.42, cacheRead: 0.028 }, note: 'DeepSeek V3.2' },
  { provider: null, model: /deepseek/i, rate: { input: 0.28, output: 0.42, cacheRead: 0.028 }, note: 'DeepSeek, generic' },

  // Anthropic.
  { provider: null, model: /claude-opus-5(?:[.-]5)?/i, rate: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, note: 'Claude Opus 5.5' },
  { provider: null, model: /claude-sonnet-5/i, rate: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, note: 'Claude Sonnet 5' },
  { provider: null, model: /claude-haiku-5/i, rate: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, note: 'Claude Haiku 5' },
  { provider: null, model: /claude-haiku-4/i, rate: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, note: 'Claude Haiku 4.5' },
  { provider: null, model: /claude/i, rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, note: 'Claude, generic' },

  // Google.
  { provider: null, model: /gemini-[\d.]+-flash-lite/i, rate: { input: 0.3, output: 2.5, cacheRead: 0.03 }, note: 'Gemini Flash-Lite' },
  { provider: null, model: /gemini-[\d.]+-flash/i, rate: { input: 0.75, output: 3.75, cacheRead: 0.075 }, note: 'Gemini Flash' },
  { provider: null, model: /gemini-[\d.]+-pro/i, rate: { input: 2, output: 12, cacheRead: 0.2 }, note: 'Gemini Pro' },
  { provider: null, model: /gemini/i, rate: { input: 0.75, output: 3.75, cacheRead: 0.075 }, note: 'Gemini, generic' },

  // Zhipu / Z.ai.
  { provider: null, model: /glm-[\d.]+-flashx?$/i, rate: { input: 0.04, output: 0.5, cacheRead: 0.004 }, note: 'GLM Flash' },
  { provider: null, model: /glm-[\d.]+(?:-air)?$/i, rate: { input: 0.6, output: 2.2, cacheRead: 0.06 }, note: 'GLM flagship' },
  { provider: null, model: /glm/i, rate: { input: 0.6, output: 2.2, cacheRead: 0.06 }, note: 'GLM, generic' },

  // Moonshot.
  { provider: null, model: /kimi-k[\d.]+-code/i, rate: { input: 0.95, output: 4, cacheRead: 0.19 }, note: 'Kimi K2 Code' },
  { provider: null, model: /kimi|moonshot/i, rate: { input: 0.6, output: 2.5, cacheRead: 0.12 }, note: 'Kimi, generic' },

  // Alibaba.
  { provider: null, model: /qwen[\d.]*-flash/i, rate: { input: 0.1, output: 0.4, cacheRead: 0.01 }, note: 'Qwen Flash' },
  { provider: null, model: /qwen[\d.]*-plus/i, rate: { input: 0.4, output: 2.4, cacheRead: 0.04 }, note: 'Qwen Plus' },
  { provider: null, model: /qwen[\d.]*-max/i, rate: { input: 1.2, output: 6, cacheRead: 0.12 }, note: 'Qwen Max' },
  { provider: null, model: /qwen/i, rate: { input: 0.3, output: 1.2, cacheRead: 0.03 }, note: 'Qwen, generic' },

  // Others.
  { provider: null, model: /minimax-m2/i, rate: { input: 0.255, output: 1.02, cacheRead: 0.0255 }, note: 'MiniMax M2' },
  { provider: null, model: /minimax/i, rate: { input: 0.3, output: 1.2, cacheRead: 0.03 }, note: 'MiniMax, generic' },
  { provider: null, model: /gpt-5\.6-luna/i, rate: { input: 0.2, output: 1.2, cacheRead: 0.02 }, note: 'GPT-5.6 Luna' },
  { provider: null, model: /gpt-[\d.]+/i, rate: { input: 1.25, output: 10, cacheRead: 0.125 }, note: 'GPT, generic' },
  { provider: null, model: /space-?bunny/i, rate: { input: 0.5, output: 0.5, cacheRead: 0.05 }, note: 'Space Bunny' },
  { provider: null, model: /grok-[\d.]+/i, rate: { input: 2, output: 6, cacheRead: 1.1 }, note: 'xAI Grok' },
  { provider: null, model: /\bhy[\d.]+/i, rate: { input: 0.14, output: 0.58, cacheRead: 0.014 }, note: 'Tencent Hunyuan' },
  { provider: null, model: /mimo/i, rate: { input: 0.1, output: 0.3, cacheRead: 0.01 }, note: 'MiMo' },
  { provider: null, model: /nemotron/i, rate: { input: 0.1, output: 0.4, cacheRead: 0.01 }, note: 'Nemotron' },
  { provider: null, model: /muse-spark/i, rate: { input: 0.1, output: 0.4, cacheRead: 0.01 }, note: 'Muse Spark' },
  { provider: null, model: /step-[\d.]/i, rate: { input: 0.1, output: 0.4, cacheRead: 0.01 }, note: 'Step' },
  { provider: null, model: /longcat/i, rate: { input: 0.1, output: 0.4, cacheRead: 0.01 }, note: 'LongCat' },
  { provider: null, model: /ling-[\d.]+/i, rate: { input: 0.1, output: 0.4, cacheRead: 0.01 }, note: 'inclusionAI Ling' },
  { provider: null, model: /qfmodel|qoder/i, rate: { input: 0.1, output: 0.4, cacheRead: 0.01 }, note: 'Qoder' },
]

/**
 * Used when nothing matches. Deliberately low: an unknown model is more often
 * a small or free one, and a wrong high estimate is worse than a low one.
 */
export const FALLBACK = { input: 0.2, output: 0.8, cacheRead: 0.02 }

/**
 * DeepSeek's direct API publishes a time-of-day price. The discount window is
 * 16:30–00:30 UTC; every other hour bills at twice the discount rate, and the
 * table rates above are that discount rate. A reseller or a subscription plan
 * does not follow this schedule, so the multiplier applies only to the routes
 * that bill per token from DeepSeek's own price list.
 */
const DEEPSEEK_PEAK = {
  /** Providers that bill DeepSeek's own price list per token. */
  providers: new Set(['deepseek-official', 'deepseek']),
  /** Start of the discount window, in UTC minutes from midnight. */
  offPeakStartMinute: 16 * 60 + 30,
  /** End of the discount window, exclusive, in UTC minutes from midnight. */
  offPeakEndMinute: 30,
  /** What every hour outside the window costs, relative to a discounted hour. */
  peakMultiplier: 2,
}

/**
 * Whether an instant falls inside DeepSeek's discount window.
 *
 * The window wraps midnight UTC, so it is two intervals, not one.
 *
 * @param time - epoch milliseconds.
 * @returns true when the discounted rate applies.
 */
export function isDeepseekOffPeak(time) {
  const at = new Date(time)
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes()
  return minute >= DEEPSEEK_PEAK.offPeakStartMinute || minute < DEEPSEEK_PEAK.offPeakEndMinute
}

/**
 * The time-of-day multiplier for one route at one instant.
 *
 * @param provider - the provider id.
 * @param time - epoch milliseconds; a non-finite time is priced as off-peak.
 * @returns 1 for every route that has no schedule, else 1 or the peak factor.
 */
export function timeMultiplier(provider, time) {
  if (!DEEPSEEK_PEAK.providers.has(provider)) return 1
  if (!Number.isFinite(time)) return 1
  return isDeepseekOffPeak(time) ? 1 : DEEPSEEK_PEAK.peakMultiplier
}

/**
 * Price one model route.
 *
 * @param provider - the provider id, for example `deepseek-official`.
 * @param model - the model id, for example `deepseek-flash`.
 * @param overrides - exact `provider/model` rates from the row's config.
 * @returns the rate and where it came from.
 */
export function resolvePrice(provider, model, overrides = {}) {
  const route = `${provider}/${model}`
  const exactOverride = overrides[route]
  if (exactOverride !== undefined) {
    return { rate: normalize(exactOverride), source: 'config', route }
  }
  const exact = EXACT[route]
  if (exact !== undefined) {
    return { rate: normalize(exact), source: 'exact', route }
  }
  for (const entry of PATTERNS) {
    if (entry.provider !== null && !entry.provider.test(provider)) continue
    if (!entry.model.test(model)) continue
    return { rate: normalize(entry.rate), source: 'pattern', route, note: entry.note }
  }
  return { rate: normalize(FALLBACK), source: 'fallback', route }
}

/** Fill in the defaults a rate may omit. */
function normalize(rate) {
  const input = Number(rate.input) || 0
  return {
    input,
    output: Number(rate.output) || 0,
    cacheRead: rate.cacheRead === undefined ? input : Number(rate.cacheRead) || 0,
    cacheWrite: rate.cacheWrite === undefined ? input : Number(rate.cacheWrite) || 0,
  }
}

/**
 * The USD cost of one aggregated group.
 *
 * A group that spans several hours is priced hour by hour, because a
 * time-of-day schedule makes two hours of the same group cost different
 * amounts. `group.slots` carries those splits; a group without it is priced as
 * one instant.
 *
 * @param group - `{ provider, model, input, cacheRead, cacheWrite, output }`,
 *   plus an optional `slots` array of `{ time, input, cacheRead, cacheWrite, output }`.
 * @param overrides - exact `provider/model` rates from the row's config.
 * @returns the cost in USD, the rate that produced it, and whether a
 *   time-of-day multiplier was applied.
 */
export function costOf(group, overrides = {}) {
  const { rate, source, note } = resolvePrice(group.provider, group.model, overrides)
  const priceOf = tokens =>
    (tokens.input / 1e6) * rate.input
    + (tokens.output / 1e6) * rate.output
    + (tokens.cacheRead / 1e6) * rate.cacheRead
    + (tokens.cacheWrite / 1e6) * rate.cacheWrite
  let cost = 0
  let timed = false
  if (Array.isArray(group.slots) && group.slots.length > 0) {
    for (const slot of group.slots) {
      const multiplier = timeMultiplier(group.provider, slot.time)
      if (multiplier !== 1) timed = true
      cost += priceOf(slot) * multiplier
    }
  } else {
    const multiplier = timeMultiplier(group.provider, group.time)
    if (multiplier !== 1) timed = true
    cost = priceOf(group) * multiplier
  }
  return { cost, rate, source, note, timed }
}
