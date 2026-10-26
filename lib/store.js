/**
 * Incremental analytics cache: per-session resumable folds + revision diffing
 * + a durable JSON snapshot.
 *
 * Design (v3 — single-source fold)
 * --------------------------------
 * The PERSISTED session log is the single source of truth. All token folding
 * happens only from `readFrom(id, fromSeq)` windows, and the fold watermark
 * advances only from what those reads returned. There is NO live-event folding
 * anymore: the previous design folded `session/event` notifications AND
 * advanced the shared watermark from them, which could race the persisted
 * reads (a session reload, a compaction, or a flush boundary could let the
 * watermark pass events whose usage was never folded). Once the watermark
 * passes an event, `readFrom` never returns it again — the missing usage was
 * permanently lost (observed: ~30-50% undercounts on live sessions).
 *
 * Freshness now comes from cheap catches-up instead:
 *   1. `session/flush` marks the session dirty and schedules a debounced
 *      refresh, so an active session's numbers trail the log by seconds.
 *   2. A periodic timer re-folds changed sessions (revision diffing keeps it
 *      incremental: unchanged sessions are skipped without any log parse).
 *   3. An API hit serves the cached snapshot immediately and starts a
 *      background refresh — the dashboard never blocks on a full scan.
 *
 * The watermark can no longer outpace the fold: it is always `max folded seq
 * + 1` from a persisted read. Double counting is impossible (each seq is
 * folded exactly once, from the file). Force mode resets watermarks to 0 for
 * a full re-fold, which is also how the v2→v3 cache invalidation repairs the
 * previously undercounted data.
 *
 * Failure isolation: every scan/fold error is contained per session (logged,
 * skipped). Analytics must never break the agent loop or the web server — the
 * worst case is a stale cache served with `stale: true`.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  aggregateFromSessions,
  computeInsights,
  createSessionStats,
  foldEvents,
} from './aggregate.js'

// Bump when the aggregation semantics change. v10: period activity and hourly model buckets. v9: per-model per-day buckets
// (models[].dayTokens/dayRaw/dayOutput/dayCalls) so the model-share chart can
// follow the period selector. v8: per-hour output/new-token buckets
// (hourlyOutput/hourlyNewTokens) so today/24h headlines split
// input/output/cache accurately. v7: per-day output tokens (dayOutput).
// v6: ghost-fork detection. v5: absolute-hour token buckets (hourlyTokens).
// v4: per-day raw token totals (incl. cache hits). v3: single-source persisted
// folding (the v2 live/persisted watermark race silently dropped events).
// A mismatched version discards the cache and rebuilds from the session logs
// on the next refresh.
const CACHE_VERSION = 10
/** Debounce for persisting live-folded state. */
const PERSIST_DEBOUNCE_MS = 5000
/** Debounce for a flush-triggered background refresh (lets the file catch up). */
const FLUSH_REFRESH_DEBOUNCE_MS = 15000
/** Concurrency cap for parallel per-session folds during a refresh. */
const FOLD_CONCURRENCY = 4

/** A no-op logger that matches the shape we need (injectable for tests). */
function defaultLogger() {
  const log = (level, message, ...args) => {
    try {
      // eslint-disable-next-line no-console
      console[level === 'error' ? 'error' : 'log'](`[dsh-usage-analytics] ${message}`, ...args)
    } catch { /* logging must never throw */ }
  }
  return { info: (m, ...a) => log('info', m, ...a), warn: (m, ...a) => log('warn', m, ...a), error: (m, ...a) => log('error', m, ...a) }
}

/** Fold one session's events in parallel with a small pool. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(run())
  await Promise.all(workers)
  return results
}

export class AnalyticsStore {
  /**
   * @param opts.persistence - the `ctx.sessionPersistence` service (listSnapshots/readFrom).
   * @param opts.dataDir - directory for the durable cache (created on demand).
   * @param opts.logger - optional {info,warn,error} logger.
   */
  constructor({ persistence, dataDir, logger }) {
    this.persistence = persistence
    this.dataDir = dataDir
    this.logger = logger ?? defaultLogger()
    /** Map of sessionId → per-session stats (the source of truth for the aggregate). */
    this.sessions = new Map()
    /** Map of sessionId → {rev, seq} fold watermark (seq = last folded seq + 1). */
    this.folds = new Map()
    this.dirty = false
    this.loaded = false
    /** True once at least one full refresh has completed (cache is meaningful). */
    this.built = false
    /** Result of the most recent completed refresh (folded/skipped/failed). */
    this.lastScan = undefined
    this.refreshPromise = undefined
    this.persistTimer = undefined
    this.refreshTimer = undefined
    this.disposed = false
  }

  // ------------------------------------------------------------ lifecycle

  /** Load the durable cache (best effort — a corrupt cache starts empty). */
  async load() {
    try {
      const text = await readFile(join(this.dataDir, 'agg.json'), 'utf8')
      const raw = JSON.parse(text)
      if (raw && raw.version === CACHE_VERSION && raw.sessions && raw.folds) {
        for (const [id, stats] of Object.entries(raw.sessions)) this.sessions.set(id, stats)
        for (const [id, fold] of Object.entries(raw.folds)) this.folds.set(id, fold)
        this.built = this.sessions.size > 0
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.warn('cache load failed, starting empty:', error?.message ?? error)
    } finally {
      this.loaded = true
    }
  }

  /** Persist the durable cache (atomic temp-write + rename, best effort). */
  async persist() {
    if (this.disposed) return
    try {
      await mkdir(this.dataDir, { recursive: true })
      const payload = JSON.stringify({
        version: CACHE_VERSION,
        savedAt: Date.now(),
        sessions: Object.fromEntries(this.sessions),
        folds: Object.fromEntries(this.folds),
      })
      const target = join(this.dataDir, 'agg.json')
      const tmp = `${target}.${process.pid}.tmp`
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, target)
      this.dirty = false
    } catch (error) {
      this.logger.warn('cache persist failed:', error?.message ?? error)
    }
  }

  /** Debounced persist — used when new events were folded. */
  schedulePersist() {
    this.dirty = true
    if (this.persistTimer !== undefined || this.disposed) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      this.persist().catch(() => {})
    }, PERSIST_DEBOUNCE_MS)
  }

  dispose() {
    this.disposed = true
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
  }

  // ------------------------------------------------------------ refresh

  /**
   * Diff snapshots against the fold watermarks and fold only the changed
   * tails. Concurrent callers share one in-flight refresh.
   * @param opts.force - rescan every session from seq 0 (full re-fold).
   */
  async refresh({ force = false } = {}) {
    if (this.refreshPromise !== undefined) return this.refreshPromise
    this.refreshPromise = this._refresh(force).finally(() => {
      this.refreshPromise = undefined
    })
    return this.refreshPromise
  }

  /** Kick off a background refresh without waiting for it. */
  refreshAsync({ force = false } = {}) {
    this.refresh({ force }).catch((error) => {
      this.logger.warn('background refresh failed:', error?.message ?? error)
    })
  }

  async _refresh(force) {
    let snapshots
    try {
      snapshots = await this.persistence.listSnapshots()
    } catch (error) {
      this.logger.error('listSnapshots failed:', error?.message ?? error)
      return { stale: true }
    }
    // Watermarks for sessions that vanished from disk are dropped so a later
    // reappearance re-folds cleanly.
    const seen = new Set()
    const work = []
    let skippedCount = 0
    for (const snapshot of snapshots) {
      const id = snapshot.header.id
      seen.add(id)
      const known = this.folds.get(id)
      if (!force && known !== undefined && known.rev === snapshot.revision) {
        skippedCount += 1
        continue
      }
      work.push({ id, header: snapshot.header, revision: snapshot.revision, known })
    }
    for (const id of [...this.folds.keys()]) {
      if (!seen.has(id)) this.folds.delete(id)
    }
    const results = await mapLimit(work, FOLD_CONCURRENCY, async (item) => {
      try {
        const reset = force || !this.sessions.has(item.id) || item.known === undefined
        const fromSeq = reset ? 0 : item.known.seq
        const { events } = await this.persistence.readFrom(item.id, fromSeq)
        // Force / first fold must replace the session stats: foldEvents ADDS,
        // so folding from 0 into an existing stats object would double count.
        let stats = this.sessions.get(item.id)
        if (reset) {
          stats = createSessionStats(item.header)
          this.sessions.set(item.id, stats)
        }
        const seq = foldEvents(stats, events)
        this.folds.set(item.id, { rev: item.revision, seq })
        return { folded: true }
      } catch (error) {
        this.logger.warn(`fold failed for session ${item.id}:`, error?.message ?? error)
        return { failed: true }
      }
    })
    let folded = 0
    let failed = 0
    for (const result of results) {
      if (result.folded) folded += 1
      else if (result.failed) failed += 1
    }
    if (folded > 0 || force) {
      this.built = true
      await this.persist()
    } else if (work.length === 0 && !this.built) {
      // Nothing changed and we still have no data — mark built so the API
      // stops awaiting refreshes on every first request of an empty install.
      this.built = true
    }
    const scan = { folded, skipped: skippedCount, failed, stale: false }
    this.lastScan = scan
    this.logger.info(`refresh: ${folded} folded, ${skippedCount} skipped, ${failed} failed`)
    return scan
  }

  // ------------------------------------------------------------ live hooks

  /**
   * A session flushed new events to its log — the file is catching up, so
   * mark the cache dirty and schedule a debounced catch-up refresh. No folding
   * happens here (single-source fold: only `_refresh` folds, only from the
   * file), so this can never race the watermark.
   */
  onLiveEvent(session, event) {
    this.scheduleRefreshSoon()
  }

  /** Debounced background refresh after live activity (keeps numbers fresh). */
  scheduleRefreshSoon() {
    if (this.disposed) return
    if (this.refreshTimer !== undefined) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      this.refreshAsync()
    }, FLUSH_REFRESH_DEBOUNCE_MS)
  }

  // ------------------------------------------------------------ snapshot

  /** Fresh aggregate snapshot + insights. Cheap: rebuilt from session stats. */
  snapshot() {
    const agg = aggregateFromSessions(this.sessions)
    agg.generatedAt = Date.now()
    return {
      generatedAt: agg.generatedAt,
      sessions: agg.sessions,
      subagentSessions: agg.subagentSessions,
      turns: agg.turns,
      steps: agg.steps,
      userMessages: agg.userMessages,
      toolCalls: agg.toolCalls,
      skillCalls: agg.skillCalls,
      pluginCalls: agg.pluginCalls,
      subagentToolCalls: agg.subagentToolCalls,
      tokens: agg.tokens,
      models: agg.models,
      reasoningEfforts: agg.reasoningEfforts,
      tools: agg.tools,
      skills: agg.skills,
      plugins: agg.plugins,
      presets: agg.presets,
      days: agg.days,
      weeks: agg.weeks,
      hours: agg.hours,
      hourly: agg.hourlyTokens,
      hourlyOutput: agg.hourlyOutput,
      hourlyNew: agg.hourlyNewTokens,
      hourlyActivity: agg.hourlyActivity,
      firstAt: agg.firstAt,
      lastAt: agg.lastAt,
      insights: computeInsights(agg, this.sessions),
      cache: { sessions: this.sessions.size, dirty: this.dirty, built: this.built },
    }
  }
}
