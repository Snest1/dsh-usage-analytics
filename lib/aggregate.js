/**
 * Usage-analytics aggregation core — pure functions over session event logs.
 *
 * No node or harness imports on purpose: this module is unit-tested in
 * isolation (`node --test test/`) and shared between the host plugin
 * (lib/index.js) and the data-verification script (scripts/verify-data.mjs).
 *
 * Design notes
 * ------------
 * - The event log is the single source of truth (see @deepseek-ai/dsh-session
 *   SessionEventMap). Only a small FOLD_TYPES subset is consumed; every other
 *   type (assistant/chunk, compaction/*, plugin-merged rows, …) is ignored.
 * - Token accounting follows the harness TokenUsage convention: counts are
 *   DISJOINT (input = uncached input; cached input is cacheRead/cacheWrite;
 *   output is uncached output; reasoningTokens is a subset of outputTokens —
 *   the DeepSeek adapter reports completion_tokens_details.reasoning_tokens,
 *   so reasoning is never added to the total).
 * - Session stats are a resumable fold: folding a session twice with disjoint
 *   event tails (live events, then persisted events) never double counts,
 *   because each fold advances the caller's seq watermark past the events it
 *   saw.
 */

/** Event types whose data the analytics care about (everything else is noise). */
export const FOLD_TYPES = new Set([
  'turn/start',
  'step/start',
  'user/message',
  'assistant/message',
  'tool/call',
  'request/header',
  'request/context',
])

/** Model route key when no request/context or request/header was seen yet. */
export const UNKNOWN_MODEL = '(unknown)'

/** Is this event type relevant to the analytics fold? */
export function isFoldType(type) {
  return FOLD_TYPES.has(type)
}

/** Local calendar day key (YYYY-MM-DD) for an epoch-ms timestamp. */
export function dayKey(ms) {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** ISO week key (YYYY-Www) for an epoch-ms timestamp. */
export function hourKey(ms) {
  return dayKey(ms) + '-' + String(new Date(ms).getHours()).padStart(2, '0')
}

/** Cordis, the MCP dispatcher and namespaced MCP tools are plugin calls. */
export function isPluginTool(name) {
  return name === 'mcp' || name.startsWith('cordis_') || name.includes('__')
}

export function weekKey(ms) {
  const d = new Date(ms)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** New empty token counters. */
export function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }
}

/** New empty per-session stats for one session header. */
export function createSessionStats(header) {
  return {
    id: header.id,
    createdAt: header.createdAt,
    cwd: header.cwd,
    agentPreset: header.agentPreset,
    origin: header.origin,
    delegationDepth: header.delegationDepth ?? 0,
    parentSession: header.parentSession,
    firstAt: undefined,
    lastAt: undefined,
    /** Time of the last assistant/message that carried usage (undefined = none). */
    lastUsageAt: undefined,
    turns: 0,
    steps: 0,
    userMessages: 0,
    toolCalls: 0,
    tokens: emptyTokens(),
    tools: {},
    skills: {},
    plugins: {},
    subagentToolCalls: 0,
    models: {},
    reasoningEfforts: {},
    dayTokens: {},
    dayTokensRaw: {},
    dayOutput: {},
    dayTurns: {},
    daySteps: {},
    dayToolCalls: {},
    daySkillCalls: {},
    dayPluginCalls: {},
    dayUserMessages: {},
    hourlyActivity: {},
    hourTokens: {},
    /** Absolute hour buckets "YYYY-MM-DD-HH" → raw tokens (incl. cache hits). */
    hourlyTokens: {},
    /** Absolute hour buckets → output tokens. */
    hourlyOutput: {},
    /** Absolute hour buckets → new tokens (input + output + cache write). */
    hourlyNewTokens: {},
    currentModel: UNKNOWN_MODEL,
    currentEffort: undefined,
  }
}

/**
 * Accumulate `usage` into a token counter.
 *
 * `total` uses the NEW-token accounting convention: uncached input + output +
 * cache write. Cache-read hits (repeated reads of already-seen context) are
 * kept in their own field and excluded from `total` — they dominate raw sums
 * in long sessions yet cost ~1/10 and match neither the user's intuition of
 * "how many tokens did I use" nor the generated volume. cacheWrite is rare
 * (adapters that report it bill it as fresh input) so it stays in the total.
 * reasoning is a subset of output — never added twice.
 */
export function addUsage(target, usage) {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const reasoning = usage.reasoningTokens ?? 0
  target.input += input
  target.output += output
  target.cacheRead += cacheRead
  target.cacheWrite += cacheWrite
  target.reasoning += reasoning
  target.total += input + output + cacheWrite
}

/** Increment a string→number counter map. */
function bump(map, key, by = 1) {
  map[key] = (map[key] ?? 0) + by
}

/** Increment a day/hours counter map keyed by the event's timestamp. */
function bumpDay(map, ms, by = 1) {
  bump(map, dayKey(ms), by)
}

function bumpActivity(stats, ms, field) {
  const key = hourKey(ms)
  const cell = stats.hourlyActivity[key] ?? (stats.hourlyActivity[key] = {})
  cell[field] = (cell[field] ?? 0) + 1
}

/** Fold ONE event into session stats. Returns the event's seq (or undefined). */
export function foldEvent(stats, event) {
  const time = typeof event.time === 'number' ? event.time : undefined
  if (time !== undefined) {
    if (stats.firstAt === undefined || time < stats.firstAt) stats.firstAt = time
    if (stats.lastAt === undefined || time > stats.lastAt) stats.lastAt = time
  }
  const type = event.type
  if (!FOLD_TYPES.has(type)) return event.seq
  const data = event.data
  switch (type) {
    case 'turn/start': {
      stats.turns += 1
      if (time !== undefined) {
        bumpDay(stats.dayTurns, time)
        bumpActivity(stats, time, 'turns')
      }
      break
    }
    case 'step/start': {
      stats.steps += 1
      if (time !== undefined) {
        bumpDay(stats.daySteps, time)
        bumpActivity(stats, time, 'steps')
      }
      break
    }
    case 'user/message': {
      stats.userMessages += 1
      if (time !== undefined) {
        bumpDay(stats.dayUserMessages, time)
        bumpActivity(stats, time, 'userMessages')
      }
      break
    }
    case 'request/context': {
      if (data && typeof data.provider === 'string' && typeof data.model === 'string') {
        stats.currentModel = `${data.provider}/${data.model}`
      }
      break
    }
    case 'request/header': {
      const config = data && data.header ? data.header.config : undefined
      if (config) {
        if (typeof config.provider === 'string' && typeof config.model === 'string') {
          stats.currentModel = `${config.provider}/${config.model}`
        }
        if (typeof config.reasoningEffort === 'string') stats.currentEffort = config.reasoningEffort
      }
      break
    }
    case 'assistant/message': {
      if (data && data.usage) {
        const usage = data.usage
        addUsage(stats.tokens, usage)
        const model = stats.currentModel
        let bucket = stats.models[model]
        if (!bucket) {
          bucket = { calls: 0, tokens: emptyTokens(), dayTokens: {}, dayRaw: {}, dayOutput: {}, dayCalls: {}, hourlyTokens: {} }
          stats.models[model] = bucket
        }
        bucket.calls += 1
        addUsage(bucket.tokens, usage)
        if (time !== undefined) {
          // Per-model per-day buckets (mirror the session-level day convention):
          // new-token total, provider-console raw total (incl. cache hits),
          // output and call count — so the dashboard can break a model's share
          // down over any selected period.
          const newTokens = usage.inputTokens + usage.outputTokens + (usage.cacheWriteTokens ?? 0)
          const rawTokens = newTokens + (usage.cacheReadTokens ?? 0)
          const dk = dayKey(time)
          bump(bucket.dayTokens, dk, newTokens)
          bump(bucket.dayRaw, dk, rawTokens)
          bump(bucket.dayOutput, dk, usage.outputTokens)
          bump(bucket.dayCalls, dk, 1)
          const hk = hourKey(time)
          const hour = bucket.hourlyTokens[hk] ?? (bucket.hourlyTokens[hk] = { newT: 0, raw: 0, output: 0, calls: 0 })
          hour.newT += newTokens
          hour.raw += rawTokens
          hour.output += usage.outputTokens ?? 0
          hour.calls += 1
        }
        if (time !== undefined && (stats.lastUsageAt === undefined || time > stats.lastUsageAt)) stats.lastUsageAt = time
        if (stats.currentEffort !== undefined) bump(stats.reasoningEfforts, stats.currentEffort)
        if (time !== undefined) {
          // Day buckets: `dayTokens` uses the new-token convention (excludes
          // cache hits); `dayTokensRaw` is the provider-console total (includes
          // cache hits) so the heatmap/trend can match the headline and the
          // relay dashboard.
          const newTokens = usage.inputTokens + usage.outputTokens + (usage.cacheWriteTokens ?? 0)
          const rawTokens = newTokens + (usage.cacheReadTokens ?? 0)
          bumpDay(stats.dayTokens, time, newTokens)
          bumpDay(stats.dayTokensRaw, time, rawTokens)
          bumpDay(stats.dayOutput, time, usage.outputTokens)
          bump(stats.hourTokens, new Date(time).getHours(), usage.outputTokens)
          const hk = dayKey(time) + '-' + String(new Date(time).getHours()).padStart(2, '0')
          bump(stats.hourlyTokens, hk, rawTokens)
          bump(stats.hourlyOutput, hk, usage.outputTokens)
          bump(stats.hourlyNewTokens, hk, newTokens)
        }
      }
      break
    }
    case 'tool/call': {
      if (data && typeof data.name === 'string') {
        const name = data.name
        stats.toolCalls += 1
        bump(stats.tools, name)
        if (time !== undefined) {
          bumpDay(stats.dayToolCalls, time)
          bumpActivity(stats, time, 'toolCalls')
        }
        if (name === 'skill') {
          if (time !== undefined) {
            bumpDay(stats.daySkillCalls, time)
            bumpActivity(stats, time, 'skillCalls')
          }
          // The skill tool call's raw arguments carry the skill name.
          let skillName = name
          if (typeof data.arguments === 'string' && data.arguments !== '') {
            try {
              const args = JSON.parse(data.arguments)
              if (args && typeof args.name === 'string' && args.name !== '') skillName = args.name
            } catch { /* unparsable arguments → fall back to the tool name */ }
          }
          bump(stats.skills, skillName)
        } else if (isPluginTool(name)) {
          bump(stats.plugins, name)
          if (time !== undefined) {
            bumpDay(stats.dayPluginCalls, time)
            bumpActivity(stats, time, 'pluginCalls')
          }
        } else if (name === 'subagent' || name.startsWith('subagent')) {
          stats.subagentToolCalls += 1
        }
      }
      break
    }
    default:
      break
  }
  return event.seq
}

/** Fold a batch of events into stats. Returns the seq watermark (last seq + 1). */
export function foldEvents(stats, events) {
  let lastSeq = stats.foldedSeq ?? 0
  for (const event of events) {
    const seq = foldEvent(stats, event)
    if (typeof seq === 'number' && seq >= lastSeq) lastSeq = seq + 1
  }
  stats.foldedSeq = lastSeq
  return lastSeq
}

/** Aggregate a whole session (create stats from its header, fold every event). */
export function aggregateSession(header, events) {
  const stats = createSessionStats(header)
  foldEvents(stats, events)
  return stats
}

/** New empty global aggregate. */
export function emptyAggregate() {
  return {
    generatedAt: 0,
    sessions: 0,
    subagentSessions: 0,
    turns: 0,
    steps: 0,
    userMessages: 0,
    toolCalls: 0,
    skillCalls: 0,
    pluginCalls: 0,
    subagentToolCalls: 0,
    tokens: emptyTokens(),
    models: {},
    reasoningEfforts: {},
    tools: {},
    skills: {},
    plugins: {},
    presets: {},
    days: {},
    weeks: {},
    hours: {},
    /** Absolute hour buckets "YYYY-MM-DD-HH" → raw tokens (incl. cache hits). */
    hourlyTokens: {},
    /** Absolute hour buckets → output tokens. */
    hourlyOutput: {},
    /** Absolute hour buckets → new tokens (input + output + cache write). */
    hourlyNewTokens: {},
    hourlyActivity: {},
    firstAt: undefined,
    lastAt: undefined,
  }
}

/** Merge ONE session's stats into the global aggregate (mutates `agg`). */
export function mergeInto(agg, stats) {
  agg.sessions += 1
  if (stats.origin === 'subagent') agg.subagentSessions += 1
  agg.turns += stats.turns
  agg.steps += stats.steps
  agg.userMessages += stats.userMessages
  agg.toolCalls += stats.toolCalls
  agg.skillCalls += Object.values(stats.skills).reduce((a, b) => a + b, 0)
  agg.pluginCalls += Object.values(stats.plugins).reduce((a, b) => a + b, 0)
  agg.subagentToolCalls += stats.subagentToolCalls
  for (const key of Object.keys(stats.tokens)) agg.tokens[key] += stats.tokens[key]

  for (const [model, bucket] of Object.entries(stats.models)) {
    let target = agg.models[model]
    if (!target) {
      target = { calls: 0, tokens: emptyTokens(), sessions: 0, dayTokens: {}, dayRaw: {}, dayOutput: {}, dayCalls: {}, hourlyTokens: {} }
      agg.models[model] = target
    }
    target.calls += bucket.calls
    target.sessions += 1
    for (const key of Object.keys(bucket.tokens)) target.tokens[key] += bucket.tokens[key]
    for (const [dk, n] of Object.entries(bucket.dayTokens ?? {})) target.dayTokens[dk] = (target.dayTokens[dk] ?? 0) + n
    for (const [dk, n] of Object.entries(bucket.dayRaw ?? {})) target.dayRaw[dk] = (target.dayRaw[dk] ?? 0) + n
    for (const [dk, n] of Object.entries(bucket.dayOutput ?? {})) target.dayOutput[dk] = (target.dayOutput[dk] ?? 0) + n
    for (const [dk, n] of Object.entries(bucket.dayCalls ?? {})) target.dayCalls[dk] = (target.dayCalls[dk] ?? 0) + n
    for (const [hk, cell] of Object.entries(bucket.hourlyTokens ?? {})) {
      const out = target.hourlyTokens[hk] ?? (target.hourlyTokens[hk] = { newT: 0, raw: 0, output: 0, calls: 0 })
      for (const field of ['newT', 'raw', 'output', 'calls']) out[field] += cell[field] ?? 0
    }
  }
  for (const [effort, count] of Object.entries(stats.reasoningEfforts)) bump(agg.reasoningEfforts, effort, count)
  for (const [name, count] of Object.entries(stats.tools)) bump(agg.tools, name, count)
  for (const [name, count] of Object.entries(stats.skills)) bump(agg.skills, name, count)
  for (const [name, count] of Object.entries(stats.plugins)) bump(agg.plugins, name, count)
  if (stats.agentPreset) bump(agg.presets, stats.agentPreset)

  const sessionDay = dayKey(stats.createdAt)
  // Count sessions even if they never produced usage tokens.
  const created = agg.days[sessionDay] ?? (agg.days[sessionDay] = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 })
  created.sessions += 1
  if (stats.origin === 'subagent') created.subagentSessions = (created.subagentSessions ?? 0) + 1
  const createdHour = hourKey(stats.createdAt)
  const creation = agg.hourlyActivity[createdHour] ?? (agg.hourlyActivity[createdHour] = {})
  creation.sessions = (creation.sessions ?? 0) + 1
  if (stats.origin === 'subagent') creation.subagentSessions = (creation.subagentSessions ?? 0) + 1

  for (const [day, tokens] of Object.entries(stats.dayTokens)) {
    let cell = agg.days[day]
    if (!cell) {
      cell = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 }
      agg.days[day] = cell
    }
    cell.tokens += tokens
    cell.tokensRaw += stats.dayTokensRaw[day] ?? tokens
    cell.output += stats.dayOutput[day] ?? 0
  }
  // Non-token day counters use their own maps (a day with turns but no tokens
  // must still count as active).
  for (const [day, n] of Object.entries(stats.dayTurns)) {
    const cell = agg.days[day] ?? (agg.days[day] = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 })
    cell.turns += n
  }
  for (const [day, n] of Object.entries(stats.daySteps)) {
    const cell = agg.days[day] ?? (agg.days[day] = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 })
    cell.steps += n
  }
  for (const [day, n] of Object.entries(stats.dayToolCalls)) {
    const cell = agg.days[day] ?? (agg.days[day] = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 })
    cell.toolCalls += n
  }
  for (const [day, n] of Object.entries(stats.daySkillCalls ?? {})) {
    const cell = agg.days[day] ?? (agg.days[day] = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 })
    cell.skillCalls = (cell.skillCalls ?? 0) + n
  }
  for (const [day, n] of Object.entries(stats.dayPluginCalls ?? {})) {
    const cell = agg.days[day] ?? (agg.days[day] = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 })
    cell.pluginCalls = (cell.pluginCalls ?? 0) + n
  }
  for (const [day, n] of Object.entries(stats.dayUserMessages)) {
    const cell = agg.days[day] ?? (agg.days[day] = { tokens: 0, tokensRaw: 0, output: 0, turns: 0, steps: 0, toolCalls: 0, userMessages: 0, sessions: 0 })
    cell.userMessages += n
  }

  for (const [hk, cell] of Object.entries(stats.hourlyActivity ?? {})) {
    const target = agg.hourlyActivity[hk] ?? (agg.hourlyActivity[hk] = {})
    for (const [field, n] of Object.entries(cell)) target[field] = (target[field] ?? 0) + n
  }
  for (const [hour, tokens] of Object.entries(stats.hourTokens)) bump(agg.hours, hour, tokens)
  for (const [hk, tokens] of Object.entries(stats.hourlyTokens)) bump(agg.hourlyTokens, hk, tokens)
  for (const [hk, tokens] of Object.entries(stats.hourlyOutput)) bump(agg.hourlyOutput, hk, tokens)
  for (const [hk, tokens] of Object.entries(stats.hourlyNewTokens)) bump(agg.hourlyNewTokens, hk, tokens)

  if (stats.firstAt !== undefined && (agg.firstAt === undefined || stats.firstAt < agg.firstAt)) agg.firstAt = stats.firstAt
  if (stats.lastAt !== undefined && (agg.lastAt === undefined || stats.lastAt > agg.lastAt)) agg.lastAt = stats.lastAt

  // Weekly rollup: add THIS session's own day contributions exactly once.
  // (Using the accumulated `agg.days[day]` cells here would re-add every prior
  // session's tokens on each merge — a day shared by N sessions would count
  // N× in the week cell.)
  const weekCell = (day) => {
    const week = weekKey(new Date(day + 'T00:00:00').getTime())
    return agg.weeks[week] ?? (agg.weeks[week] = { tokens: 0, tokensRaw: 0, turns: 0, steps: 0, toolCalls: 0, sessions: 0 })
  }
  for (const [day, tokens] of Object.entries(stats.dayTokens)) {
    weekCell(day).tokens += tokens
    weekCell(day).tokensRaw += stats.dayTokensRaw[day] ?? tokens
  }
  for (const [day, n] of Object.entries(stats.dayTurns)) weekCell(day).turns += n
  for (const [day, n] of Object.entries(stats.daySteps)) weekCell(day).steps += n
  for (const [day, n] of Object.entries(stats.dayToolCalls)) weekCell(day).toolCalls += n
  const sessionWeek = weekKey(new Date(sessionDay + 'T00:00:00').getTime())
  agg.weeks[sessionWeek] ?? (agg.weeks[sessionWeek] = { tokens: 0, tokensRaw: 0, turns: 0, steps: 0, toolCalls: 0, sessions: 0 })
  agg.weeks[sessionWeek].sessions += 1
}

/** Iterate a session-stats container: a Map of id → stats, or a plain object. */
function sessionStatsValues(container) {
  return container instanceof Map ? container.values() : Object.values(container)
}

/**
 * A forked session that never ran: its whole log is a copied seed (every usage
 * event predates the session's own creation, e.g. a branch created then
 * abandoned). Counting it would double-count the parent's tokens, so it is
 * excluded from every aggregate surface.
 */
export function isGhostSession(stats) {
  return stats.lastUsageAt !== undefined
    && typeof stats.createdAt === 'number'
    && stats.lastUsageAt <= stats.createdAt
}

/** Rebuild the global aggregate from a map of session stats. */
export function aggregateFromSessions(sessionMap) {
  const agg = emptyAggregate()
  for (const stats of sessionStatsValues(sessionMap)) {
    if (isGhostSession(stats)) continue
    mergeInto(agg, stats)
  }
  return agg
}

/** Days with any recorded activity (tokens, turns, steps, tool calls, or messages). */
export function activeDaySet(agg) {
  const set = new Set()
  for (const [day, cell] of Object.entries(agg.days)) {
    if (cell.tokens > 0 || cell.turns > 0 || cell.steps > 0 || cell.toolCalls > 0 || cell.userMessages > 0) set.add(day)
  }
  return set
}

/** Consecutive-day streak length ending at `endDay` (inclusive, backwards). */
export function streakEndingAt(active, endDay) {
  let days = 0
  let cursor = new Date(endDay + 'T00:00:00')
  while (active.has(dayKey(cursor.getTime()))) {
    days += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return days
}

/**
 * Streak facts: current streak (ending today, or yesterday while today is
 * still in progress) and the longest streak with its date range.
 */
export function computeStreaks(active, now = Date.now()) {
  const today = dayKey(now)
  let current = streakEndingAt(active, today)
  if (current === 0) {
    const yesterday = new Date(now - 86400000)
    current = streakEndingAt(active, dayKey(yesterday.getTime()))
  }
  let longest = 0
  let longestStart
  let longestEnd
  const days = [...active].sort()
  let runStart = days[0]
  let prev
  for (const day of days) {
    if (prev !== undefined) {
      const gap = (new Date(day + 'T00:00:00').getTime() - new Date(prev + 'T00:00:00').getTime()) / 86400000
      if (gap > 1) {
        const len = Math.round((new Date(prev + 'T00:00:00').getTime() - new Date(runStart + 'T00:00:00').getTime()) / 86400000) + 1
        if (len > longest) {
          longest = len
          longestStart = runStart
          longestEnd = prev
        }
        runStart = day
      }
    }
    prev = day
  }
  if (days.length > 0) {
    const len = Math.round((new Date(prev + 'T00:00:00').getTime() - new Date(runStart + 'T00:00:00').getTime()) / 86400000) + 1
    if (len > longest) {
      longest = len
      longestStart = runStart
      longestEnd = prev
    }
  }
  return { current, longest, longestStart, longestEnd }
}

/** Top-N entries of a count map as [{name, count}] sorted descending. */
export function topN(map, n = 5) {
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
    .slice(0, n)
}

/** Structured insight facts for the dashboard cards. Pure — the client formats. */
export function computeInsights(agg, sessionMap = {}, now = Date.now()) {
  const active = activeDaySet(agg)
  const streaks = computeStreaks(active, now)
  const days = Object.keys(agg.days).sort()
  const dayCells = days.map((day) => ({ day, ...agg.days[day] }))
  // Peak day ranks by the provider-console total (incl. cache hits), matching
  // the headline and heatmap.
  const peakDay = [...dayCells].sort((a, b) => (b.tokensRaw ?? b.tokens) - (a.tokensRaw ?? a.tokens) || b.turns - a.turns)[0]
  const topModels = topN(
    Object.fromEntries(Object.entries(agg.models).map(([key, v]) => [key, v.tokens.total])),
    5,
  )
  const topModel = topModels[0]
  const topTool = topN(agg.tools, 1)[0]
  const topSkill = topN(agg.skills, 1)[0]
  const topPlugin = topN(agg.plugins, 1)[0]
  const topEffort = topN(agg.reasoningEfforts, 1)[0]

  const billedInput = agg.tokens.input + agg.tokens.cacheRead + agg.tokens.cacheWrite
  // Provider-dashboard convention: prompt tokens INCLUDE cache hits, so the
  // raw input total (uncached + cache read + cache write) and the grand total
  // (raw input + output) are what a billing console's counter shows.
  const rawInput = agg.tokens.input + agg.tokens.cacheRead + agg.tokens.cacheWrite
  const grandTotal = rawInput + agg.tokens.output
  // Percentages against the NEW-token total (excludes cache hits), so they
  // never overflow 100%.
  const inputPct = agg.tokens.total > 0 ? Math.round((agg.tokens.input / agg.tokens.total) * 100) : 0
  const outputPct = agg.tokens.total > 0 ? Math.round((agg.tokens.output / agg.tokens.total) * 100) : 0
  const cacheWritePct = agg.tokens.total > 0 ? Math.round((agg.tokens.cacheWrite / agg.tokens.total) * 100) : 0
  const cacheShareOfInput = billedInput > 0 ? Math.round(((agg.tokens.cacheRead + agg.tokens.cacheWrite) / billedInput) * 100) : 0
  const reasoningShare = agg.tokens.output > 0 ? Math.round((agg.tokens.reasoning / agg.tokens.output) * 100) : 0

  let longestSession
  let peakSession
  for (const stats of sessionStatsValues(sessionMap)) {
    if (isGhostSession(stats)) continue
    const ms = stats.firstAt !== undefined && stats.lastAt !== undefined ? stats.lastAt - stats.firstAt : 0
    if (longestSession === undefined || ms > longestSession.ms) {
      longestSession = { id: stats.id, ms, tokens: stats.tokens.total, day: dayKey(stats.createdAt) }
    }
    if (peakSession === undefined || stats.tokens.total > peakSession.tokens) {
      peakSession = { id: stats.id, tokens: stats.tokens.total, day: dayKey(stats.createdAt) }
    }
  }

  const busyHour = topN(Object.fromEntries(Object.entries(agg.hours).map(([h, n]) => [h, n])), 1)[0]

  return {
    activeDays: active.size,
    firstDay: days[0],
    lastDay: days[days.length - 1],
    spanDays: days.length > 0 ? Math.max(1, Math.round((new Date(days[days.length - 1] + 'T00:00:00').getTime() - new Date(days[0] + 'T00:00:00').getTime()) / 86400000) + 1) : 0,
    avgTokensPerSession: agg.sessions > 0 ? Math.round(agg.tokens.total / agg.sessions) : 0,
    avgStepsPerTurn: agg.turns > 0 ? agg.steps / agg.turns : 0,
    avgSessionMs: agg.sessions > 0 && agg.tokens.total > 0 ? Math.round((agg.lastAt - agg.firstAt) / agg.sessions) : 0,
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    longestStreakStart: streaks.longestStart,
    longestStreakEnd: streaks.longestEnd,
    peakDay: peakDay ? { day: peakDay.day, tokens: peakDay.tokensRaw ?? peakDay.tokens, turns: peakDay.turns } : undefined,
    // Provider-console-compatible totals (cache hits included).
    rawInput,
    grandTotal,
    topModel: topModel ? { name: topModel.name, tokens: topModel.count } : undefined,
    topTool,
    topSkill,
    topPlugin,
    topEffort,
    inputPct,
    outputPct,
    cacheWritePct,
    cacheShareOfInput,
    reasoningShare,
    subagentSessions: agg.subagentSessions,
    subagentToolCalls: agg.subagentToolCalls,
    skillCalls: agg.skillCalls,
    pluginCalls: agg.pluginCalls,
    toolCalls: agg.toolCalls,
    longestSession,
    peakSession,
    busyHour,
  }
}
