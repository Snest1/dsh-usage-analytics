/**
 * Unit tests for the analytics aggregation core (pure functions, no harness).
 * Run with: node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateSession,
  aggregateFromSessions,
  computeInsights,
  computeStreaks,
  dayKey,
  foldEvents,
  createSessionStats,
  emptyAggregate,
  isFoldType,
  mergeInto,
  topN,
  weekKey,
  hourKey,
  isPluginTool,
} from '../lib/aggregate.js'

/** Build a session header. */
function header(overrides = {}) {
  return {
    id: 'session-1',
    version: 0,
    createdAt: Date.parse('2026-08-01T10:00:00'),
    cwd: 'E:/work',
    ...overrides,
  }
}

/** Build one event. */
function ev(type, data, time, seq) {
  return { type, data, time, seq }
}

test('foldEvents sums disjoint token usage without double counting reasoning', () => {
  const stats = createSessionStats(header())
  foldEvents(stats, [
    ev('request/context', { provider: 'aaa', model: 'm1' }, 1000, 0),
    ev('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, reasoningTokens: 10 } }, 1100, 1),
    ev('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, usage: { inputTokens: 30, outputTokens: 40, cacheWriteTokens: 5 } }, 1200, 2),
  ])
  // reasoningTokens (10) is a subset of outputTokens (50) — never added twice.
  // total uses the new-token convention: cache-read hits (20) are excluded.
  assert.deepEqual(stats.tokens, { input: 130, output: 90, cacheRead: 20, cacheWrite: 5, reasoning: 10, total: 225 })
  assert.equal(stats.steps, 0) // assistant/message is not a step
  const bucket = stats.models['aaa/m1']
  assert.equal(bucket.calls, 2)
  assert.equal(bucket.tokens.total, 225)
})

test('step/turn/user/tool counters and day bucketing', () => {
  const stats = createSessionStats(header({ createdAt: Date.parse('2026-08-01T09:00:00') }))
  const day = dayKey(Date.parse('2026-08-01T09:00:00'))
  foldEvents(stats, [
    ev('turn/start', { turn: 0 }, Date.parse('2026-08-01T09:00:00'), 0),
    ev('user/message', { role: 'user', content: [{ type: 'text', text: 'x' }] }, Date.parse('2026-08-01T09:00:01'), 1),
    ev('step/start', { turn: 0, step: 0 }, Date.parse('2026-08-01T09:00:02'), 2),
    ev('tool/call', { callId: 'c1', name: 'read', arguments: '{}' }, Date.parse('2026-08-01T09:00:03'), 3),
    ev('tool/call', { callId: 'c2', name: 'skill', arguments: JSON.stringify({ name: 'ui-ux-pro-max' }) }, Date.parse('2026-08-01T09:00:04'), 4),
    ev('tool/call', { callId: 'c3', name: 'cordis_define', arguments: '{}' }, Date.parse('2026-08-01T09:00:05'), 5),
    ev('tool/call', { callId: 'c4', name: 'subagent', arguments: '{}' }, Date.parse('2026-08-01T09:00:06'), 6),
    ev('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'y' }] }, usage: { inputTokens: 10, outputTokens: 5 } }, Date.parse('2026-08-01T09:00:07'), 7),
  ])
  assert.equal(stats.turns, 1)
  assert.equal(stats.steps, 1)
  assert.equal(stats.userMessages, 1)
  assert.equal(stats.toolCalls, 4)
  assert.equal(stats.skills['ui-ux-pro-max'], 1)
  assert.equal(stats.plugins['cordis_define'], 1)
  assert.equal(stats.subagentToolCalls, 1)
  assert.equal(stats.dayTurns[day], 1)
  assert.equal(stats.dayTokens[day], 15)
  assert.equal(stats.hourTokens['9'], 5)
})

test('skill call with unparsable arguments falls back to the tool name', () => {
  const stats = createSessionStats(header())
  foldEvents(stats, [ev('tool/call', { callId: 'c1', name: 'skill', arguments: '{broken' }, 1000, 0)])
  assert.equal(stats.skills['skill'], 1)
})

test('isFoldType ignores noise events (chunks, compaction, plugin rows)', () => {
  assert.equal(isFoldType('assistant/chunk'), false)
  assert.equal(isFoldType('compaction/start'), false)
  assert.equal(isFoldType('permission/preset'), false)
  assert.equal(isFoldType('agent/inbox/spliced'), false)
  assert.equal(isFoldType('tool/call'), true)
  assert.equal(isFoldType('assistant/message'), true)
})

test('mergeInto folds a session into the global aggregate with day/week/hours', () => {
  const agg = emptyAggregate()
  // Aug 3–5 2026 all fall in the same ISO week (Mon–Wed).
  const stats = aggregateSession(header({ id: 's1', createdAt: Date.parse('2026-08-03T09:00:00') }), [
    ev('turn/start', { turn: 0 }, Date.parse('2026-08-03T09:00:00'), 0),
    ev('assistant/message', { message: {}, usage: { inputTokens: 100, outputTokens: 50 } }, Date.parse('2026-08-03T09:00:01'), 1),
    ev('assistant/message', { message: {}, usage: { inputTokens: 100, outputTokens: 50 } }, Date.parse('2026-08-05T09:00:01'), 2),
  ])
  const stats2 = aggregateSession(header({ id: 's2', createdAt: Date.parse('2026-08-04T09:00:00'), origin: 'subagent' }), [
    ev('assistant/message', { message: {}, usage: { inputTokens: 10, outputTokens: 5 } }, Date.parse('2026-08-04T09:00:01'), 0),
  ])
  mergeInto(agg, stats)
  mergeInto(agg, stats2)

  assert.equal(agg.sessions, 2)
  assert.equal(agg.subagentSessions, 1)
  assert.equal(agg.tokens.total, 315)
  const day1 = agg.days['2026-08-03']
  const day2 = agg.days['2026-08-04']
  const day3 = agg.days['2026-08-05']
  assert.equal(day1.tokens, 150)
  assert.equal(day2.tokens, 15)
  assert.equal(day3.tokens, 150)
  assert.equal(day2.sessions, 1) // session counted on its creation day
  assert.equal(day1.sessions, 1)
  assert.equal(Object.keys(agg.weeks).length, 1) // all in the same ISO week
  assert.equal(agg.hours['9'], 105)
})

test('streaks: current (with today grace) and longest', () => {
  const now = Date.parse('2026-08-05T12:00:00')
  // Active: Aug 1-3 and Aug 4-5 (longest 3 Aug1-3? no — Aug 1,2,3 = 3; then Aug 4,5 = 2)
  const active = new Set(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'])
  const s1 = computeStreaks(active, now)
  assert.equal(s1.current, 5)
  assert.equal(s1.longest, 5)

  // Gap: longest = 3 (Aug 1-3), current = 2 (Aug 4-5)
  const active2 = new Set(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-05'])
  const s2 = computeStreaks(active2, now)
  assert.equal(s2.current, 1)
  assert.equal(s2.longest, 3)
  assert.equal(s2.longestStart, '2026-08-01')
  assert.equal(s2.longestEnd, '2026-08-03')

  // Today inactive but yesterday active → current streak still counts (grace).
  const active3 = new Set(['2026-08-04', '2026-08-05'])
  const s3 = computeStreaks(active3, Date.parse('2026-08-06T12:00:00'))
  assert.equal(s3.current, 2)

  // No activity at all.
  const s4 = computeStreaks(new Set(), now)
  assert.equal(s4.current, 0)
  assert.equal(s4.longest, 0)
})

test('weekKey groups days into ISO weeks', () => {
  const monday = weekKey(Date.parse('2026-08-03T00:00:00'))
  const sunday = weekKey(Date.parse('2026-08-09T23:59:59'))
  assert.equal(monday, sunday)
})

test('computeInsights derives the expected facts', () => {
  const sessionMap = new Map()
  const s1 = aggregateSession(header({ id: 's1', createdAt: Date.parse('2026-08-01T09:00:00') }), [
    ev('turn/start', { turn: 0 }, Date.parse('2026-08-01T09:00:00'), 0),
    ev('request/header', { header: { config: { provider: 'aaa', model: 'm1', reasoningEffort: 'max' } }, reason: 'initial' }, Date.parse('2026-08-01T09:00:00'), 1),
    ev('assistant/message', { message: {}, usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 50 } }, Date.parse('2026-08-01T09:00:01'), 2),
    ev('assistant/message', { message: {}, usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 50 } }, Date.parse('2026-08-01T09:00:02'), 3),
    ev('tool/call', { callId: 'c1', name: 'read', arguments: '{}' }, Date.parse('2026-08-01T09:00:03'), 4),
    ev('step/start', { turn: 0, step: 0 }, Date.parse('2026-08-01T09:00:00'), 5),
  ])
  const s2 = aggregateSession(header({ id: 's2', createdAt: Date.parse('2026-08-03T09:00:00'), origin: 'subagent' }), [
    ev('assistant/message', { message: {}, usage: { inputTokens: 10, outputTokens: 5 } }, Date.parse('2026-08-03T09:00:01'), 0),
  ])
  sessionMap.set('s1', s1)
  sessionMap.set('s2', s2)
  const agg = aggregateFromSessions(sessionMap)
  const insights = computeInsights(agg, sessionMap)

  assert.equal(insights.activeDays, 2)
  assert.equal(insights.avgTokensPerSession, 308) // (600 + 15) / 2 — new-token total
  assert.equal(insights.topModel.name, 'aaa/m1')
  assert.equal(insights.topModel.tokens, 600)
  assert.equal(insights.topTool.name, 'read')
  assert.equal(insights.topTool.count, 1)
  assert.equal(insights.topEffort.name, 'max')
  assert.equal(insights.subagentSessions, 1)
  assert.equal(insights.skillCalls, 0)
  assert.equal(insights.pluginCalls, 0)
  assert.equal(insights.toolCalls, 1)
  assert.equal(insights.peakDay.day, '2026-08-01')
  // cache share: cacheRead 100 of billed input (100 + 700*? ) → compute: billedInput = 450 + 450 + 10 = 910? no.
  // s1 billed input = 200+200+50+50 = 500; s2 = 10; total billed = 510; cache = 100 → 19.6% → 20
  assert.equal(insights.cacheShareOfInput, 20)
  assert.equal(insights.longestStreakDays, 1) // Aug 1 and Aug 3 are not consecutive... active days 2 but gapped
  assert.equal(insights.longestSession.id, 's1')
  assert.equal(insights.peakSession.id, 's1')
})

test('topN sorts descending and caps', () => {
  assert.deepEqual(topN({ b: 2, a: 5, c: 1 }, 2), [{ name: 'a', count: 5 }, { name: 'b', count: 2 }])
  assert.deepEqual(topN({}, 5), [])
})

test('fold watermark: folding a tail never double counts', () => {
  const stats = createSessionStats(header())
  const events1 = [
    ev('request/context', { provider: 'aaa', model: 'm1' }, 1000, 0),
    ev('assistant/message', { message: {}, usage: { inputTokens: 100, outputTokens: 50 } }, 1100, 1),
  ]
  const w1 = foldEvents(stats, events1)
  assert.equal(w1, 2)
  // Tail that duplicates nothing (fresh seqs past the watermark).
  const w2 = foldEvents(stats, [
    ev('assistant/message', { message: {}, usage: { inputTokens: 10, outputTokens: 5 } }, 1200, 2),
  ])
  assert.equal(w2, 3)
  assert.equal(stats.tokens.total, 165)
})

test('plugin calls include namespaced MCP tools while ordinary tools stay separate', () => {
  for (const name of ['mcp', 'cordis_memory', 'docmost__search_pages', 'google_drive__lookup']) {
    assert.equal(isPluginTool(name), true)
  }
  for (const name of ['bash', 'read', 'skill', 'subagent']) assert.equal(isPluginTool(name), false)
  const at = Date.parse('2026-10-26T10:15:00')
  const stats = aggregateSession(header({ createdAt: at }), [
    ev('tool/call', { name: 'docmost__search_pages' }, at, 0),
    ev('tool/call', { name: 'mcp' }, at + 100, 1),
    ev('tool/call', { name: 'skill', arguments: '{"name":"some-skill"}' }, at + 200, 2),
    ev('tool/call', { name: 'read' }, at + 300, 3),
  ])
  const agg = aggregateFromSessions({ x: stats })
  assert.equal(agg.pluginCalls, 2)
  assert.equal(agg.skillCalls, 1)
  assert.equal(agg.toolCalls, 4)
  assert.equal(agg.days[dayKey(at)].pluginCalls, 2)
  assert.equal(agg.days[dayKey(at)].skillCalls, 1)
  assert.equal(agg.hourlyActivity[hourKey(at)].toolCalls, 4)
  assert.equal(agg.hourlyActivity[hourKey(at)].pluginCalls, 2)
  assert.equal(agg.hourlyActivity[hourKey(at)].skillCalls, 1)
})

test('activity includes no-token sessions and subagents on creation day/hour', () => {
  const at = Date.parse('2026-10-25T10:00:00')
  const later = Date.parse('2026-10-26T11:00:00')
  const idle = aggregateSession(header({ createdAt: at, id: 'idle' }), [])
  const sub = aggregateSession(header({ createdAt: later, id: 'sub', origin: 'subagent' }), [
    ev('turn/start', {}, later + 1000, 0),
    ev('step/start', {}, later + 2000, 1),
    ev('tool/call', { name: 'read' }, later + 3000, 2),
  ])
  const agg = aggregateFromSessions({ idle, sub })
  assert.equal(agg.sessions, 2)
  assert.equal(agg.subagentSessions, 1)
  assert.equal(agg.days[dayKey(at)].sessions, 1)
  assert.equal(agg.days[dayKey(later)].sessions, 1)
  assert.equal(agg.days[dayKey(later)].subagentSessions, 1)
  assert.equal(agg.days[dayKey(later)].turns, 1)
  assert.equal(agg.hourlyActivity[hourKey(at)].sessions, 1)
  assert.equal(agg.hourlyActivity[hourKey(later)].subagentSessions, 1)
  assert.equal(agg.hourlyActivity[hourKey(later)].steps, 1)
})

test('model hourly buckets match per-model daily and global raw/new totals', () => {
  const at = Date.parse('2026-10-26T10:00:00')
  const later = Date.parse('2026-10-26T11:00:00')
  const stats = aggregateSession(header({ createdAt: at }), [
    ev('request/context', { provider: 'test', model: 'm' }, at, 0),
    ev('assistant/message', { usage: { inputTokens: 11, cacheReadTokens: 90, outputTokens: 4 } }, at + 1000, 1),
    ev('assistant/message', { usage: { inputTokens: 12, cacheReadTokens: 120, outputTokens: 5 } }, later, 2),
  ])
  const agg = aggregateFromSessions({ test: stats })
  const model = agg.models['test/m']
  assert.deepEqual(model.hourlyTokens[hourKey(at)], { newT: 15, raw: 105, output: 4, calls: 1 })
  assert.deepEqual(model.hourlyTokens[hourKey(later)], { newT: 17, raw: 137, output: 5, calls: 1 })
  assert.equal(model.dayTokens[dayKey(at)], 32)
  assert.equal(model.dayRaw[dayKey(at)], 242)
  assert.equal(agg.tokens.total, 32)
  assert.equal(agg.tokens.cacheRead, 210)
  assert.equal(agg.hourlyTokens[hourKey(at)] + agg.hourlyTokens[hourKey(later)], 242)
})
