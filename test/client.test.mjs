/**
 * Smoke tests for the browser half: verify the bundle registers the two slot
 * surfaces with the right ids/orders, injects the locale namespace, injects
 * its stylesheet, and keeps its translate fallback working. Components are
 * not rendered here (that is the shell's job, verified live).
 * Run with: node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundleSource = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** Evaluate the bundle in a fake window and capture its exports. */
function loadBundle() {
  const fakeWindow = {
    __ModuleLoader__: {
      load(handoff) {
        assert.equal(typeof handoff.id, 'string')
        assert.equal(typeof handoff.factory, 'function')
        // Materialize the factory with a require stub that answers 'react'.
        const result = handoff.factory(function require(spec) {
          if (spec === 'react') {
            // A minimal React stand-in: components only need createElement and
            // the hook names at import time (they are destructured, not called).
            return {
              createElement: (...args) => ({ __el: true, args }),
              useState: () => [],
              useEffect: () => undefined,
              useMemo: (fn) => fn(),
              useCallback: (fn) => fn,
              useSyncExternalStore: () => false,
            }
          }
          throw new Error('unexpected require: ' + spec)
        })
        fakeWindow.__bundle = result
      },
    },
  }
  const fn = new Function('window', bundleSource)
  fn(fakeWindow)
  return fakeWindow.__bundle
}

test('bundle declares inject and apply', () => {
  const bundle = loadBundle()
  assert.deepEqual(bundle.inject, ['slots', 'locale'])
  assert.equal(typeof bundle.apply, 'function')
})

test('apply registers sidebar entry + overlay with right ids, injects locale + css', () => {
  const bundle = loadBundle()
  const registered = []
  const injected = []
  const styles = []
  let registeredLocale = null
  let bound = null

  const fakeCtx = {
    locale: {
      register(ns, dicts) {
        registeredLocale = { ns, dicts }
      },
      bind(ns) {
        bound = ns
        return (key) => (registeredLocale.dicts.zh[key] ?? key)
      },
    },
    slots: {
      inject(key, cb) {
        injected.push(key)
        // Simulate declarations already live: run the callback now.
        const disposer = cb()
        assert.equal(typeof disposer, 'function')
      },
      register(opts, component) {
        registered.push({ opts, component })
        return () => {}
      },
    },
  }

  // Fake DOM enough for the style injection branch.
  const originalDocument = globalThis.document
  globalThis.document = {
    head: { appendChild() {} },
    querySelector() { return null },
    createElement() {
      return {
        set dataset(v) { this._d = v },
        get dataset() { return this._d ?? (this._d = {}) },
        set textContent(v) { this._t = v },
        get textContent() { return this._t },
      }
    },
  }
  try {
    bundle.apply(fakeCtx)
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }

  assert.equal(registeredLocale.ns, 'dsh-usage-analytics')
  assert.equal(bound, 'dsh-usage-analytics')
  assert.ok(registeredLocale.dicts.zh['sidebar.label'])
  assert.ok(registeredLocale.dicts.en['sidebar.label'])

  assert.deepEqual(injected, ['sidebar.footer.action', 'shell.overlay'])
  assert.equal(registered.length, 2)

  const entry = registered.find((r) => r.opts.id === 'usage-analytics')
  const overlay = registered.find((r) => r.opts.id === 'usage-analytics-overlay')
  assert.ok(entry)
  assert.equal(entry.opts.name, 'sidebar.footer.action')
  assert.equal(entry.opts.order, 200)
  assert.equal(typeof entry.opts.label, 'function')
  assert.ok(overlay)
  assert.equal(overlay.opts.name, 'shell.overlay')
  assert.equal(typeof entry.component, 'function')
  assert.equal(typeof overlay.component, 'function')
})

/** Compile a real function/expression from the self-contained client bundle. */
function compiled(source, start, end, args, result) {
  const i = source.indexOf(start), j = source.indexOf(end, i)
  assert.ok(i >= 0 && j > i, start)
  return new Function(...args, source.slice(i, j) + '\nreturn ' + result)
}

test('time window filters activity cards and model usage consistently', () => {
  const periodActivity = compiled(bundleSource,
    'var periodActivity = useMemo(function () {',
    '// Period-filtered per-model totals', [
      'data', 'period', 'periodDays', 'isHourly', 'hourlyCutoff', 'useMemo',
    ], 'periodActivity')
  const periodModels = compiled(bundleSource,
    'var periodModels = useMemo(function () {',
    'var cardTokens =', [
      'data', 'period', 'isHourly', 'hourlyData', 'useMemo', 'periodCutoffMs', 'dayOf',
    ], 'periodModels')
  const useMemo = (fn) => fn()
  const dayOf = (key) => new Date(key + 'T00:00:00')
  const data = {
    sessions: 100, turns: 20, steps: 33, toolCalls: 42, skillCalls: 4,
    pluginCalls: 2, subagentSessions: 8,
    hourlyActivity: {
      '2026-10-26-09': { turns: 1, toolCalls: 2, sessions: 1, pluginCalls: 1 },
      '2026-10-26-10': { turns: 2, steps: 4, sessions: 2, toolCalls: 3, skillCalls: 2 },
      '2026-10-26-11': { turns: 4, sessions: 1, toolCalls: 6, pluginCalls: 1 },
    },
    models: {
      'qwen/m1': {
        tokens: { total: 150, cacheRead: 900 },
        dayTokens: { '2026-10-25': 50, '2026-10-26': 100 },
        dayRaw: { '2026-10-25': 500, '2026-10-26': 550 },
        dayOutput: { '2026-10-25': 10, '2026-10-26': 20 },
        dayCalls: { '2026-10-25': 1, '2026-10-26': 2 },
        hourlyTokens: {
          '2026-10-26-09': { newT: 30, raw: 130, output: 5, calls: 1 },
          '2026-10-26-10': { newT: 40, raw: 240, output: 8, calls: 1 },
          '2026-10-26-11': { newT: 30, raw: 180, output: 7, calls: 1 },
        },
      },
    },
  }
  const days = { '2026-10-25': { sessions: 1, turns: 3 }, '2026-10-26': { sessions: 3, turns: 4, steps: 5, pluginCalls: 2 } }
  const activity = (period, isHourly, cutoff, cells = days) => periodActivity(data, period, cells, isHourly, cutoff, useMemo)
  assert.equal(activity('all', false, 0).sessions, 100)
  assert.deepEqual([activity(30, false, 0).sessions, activity(30, false, 0).turns], [4, 7])
  const cutoff = Date.parse('2026-10-26T10:00:00')
  assert.deepEqual([activity('24h', true, cutoff).sessions, activity('24h', true, cutoff).turns,
    activity('24h', true, cutoff).toolCalls, activity('24h', true, cutoff).pluginCalls], [3, 6, 9, 1])
  const hourlyData = { '2026-10-26-10': 240, '2026-10-26-11': 180 }
  const models24h = periodModels(data, '24h', true, hourlyData, useMemo, () => cutoff, dayOf)
  assert.equal(models24h['qwen/m1'].tokens.total, 70)
  assert.equal(models24h['qwen/m1'].tokens.cacheRead, 350)
  assert.equal(models24h['qwen/m1'].calls, 2)
  const modelDay = periodModels(data, 30, false, null, useMemo,
    () => Date.parse('2026-10-26T00:00:00'), dayOf)
  assert.equal(modelDay['qwen/m1'].tokens.total, 100)
  assert.equal(modelDay['qwen/m1'].tokens.cacheRead, 450)
})

test('model mix modes and token mix percentages use their stated denominator', () => {
  const element = (type, props, ...children) => ({ type, props, children })
  const share = compiled(bundleSource, 'function ModelShare(props) {', '/**\n\t\t * Token mix', [
    'createElement', 'LegendRow', 'fmtTokens', 'fmtInt', 'fmtPct',
  ], 'ModelShare')(element, () => {}, String, String, String)
  const models = {
    'p/a': { calls: 2, tokens: { total: 20, cacheRead: 80 } },
    'p/b': { calls: 3, tokens: { total: 80, cacheRead: 0 } },
  }
  const percentages = (mode) => share({ models, tokenMode: mode, t: (k) => k })
    .children[1].children[0].map((x) => x.props.pct)
  assert.deepEqual(percentages('fresh'), [80, 20])
  assert.ok(Math.abs(percentages('all')[0] - 100 / 180 * 100) < 0.0001)
  assert.ok(Math.abs(percentages('all')[1] - 80 / 180 * 100) < 0.0001)
  const mix = compiled(bundleSource, 'function TokenMix(props) {', '/** Insight card grid. */', [
    'createElement', 'LegendRow', 'fmtTokens', 'fmtPct',
  ], 'TokenMix')(element, () => {}, String, String)
  const tree = mix({ tokens: { input: 10, output: 5, cacheRead: 85 }, t: (k) => k })
  assert.deepEqual(tree.children[0].children[0].map((e) => e.props.style.width), ['10%', '5%', '85%'])
})
