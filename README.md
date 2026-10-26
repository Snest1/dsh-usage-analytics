# dsh-usage-analytics

> Personal Agent usage analytics & activity dashboard for the DeepSeek Harness (dsh) Web GUI.
> [中文文档](./README.zh.md) | 中文版

[![npm version](https://img.shields.io/npm/v/dsh-usage-analytics)](https://www.npmjs.com/package/dsh-usage-analytics)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-available-4f6ef7)](https://github.com/topics/dsh-plugin)

A **usage statistics / activity dashboard** for DeepSeek Harness. It adds a **Usage** entry at the bottom of the sidebar (next to Settings) that opens a full-screen dashboard aggregating your **real** Harness usage:

- **Token totals** (input / output / cache hits / reasoning), **session activity**, a GitHub-style **contribution heatmap**, a **token trend** chart, a **token mix** breakdown, a **model share** ranking, plus **insights** (streaks, peak day, most-used model/tool/skill, …).
- Data comes **only** from your local session event logs (`ctx.sessionPersistence`) — **no dsh core changes**, **no prompt content ever leaves your machine** (only event metadata and numeric usage are aggregated).

## Features

- **Full dashboard** — contribution heatmap, token trend (daily/weekly/hourly), token mix, model share, reasoning-effort / tool / skill / dynamic-plugin rankings, streaks and personal insights.
- **Period filtering** — every chart follows the selected range (`Today` / `24h` / `7d` / `30d` / `90d` / `All time`), so the headline and the charts always agree.
- **Model grouping by real name** — models served through several providers (e.g. `aaa/…`, `acme-gateway/…`) collapse into one row by their real model name; the provider list is kept as a hover tooltip, never shown inline.
- **Ghost-session detection** — forked sessions that were copied but never ran are excluded from every aggregate, so duplicated logs can never inflate your numbers.
- **Provider-console accounting** — the headline and heatmap use the raw convention (input incl. cache hits, matching what a billing console shows); the new-token figure is always available separately, so you can tell "new tokens" from "context re-reads".
- **Local & private** — loopback-only API, no telemetry, no uploads, no prompt content collected or persisted.
- **Incremental & instant** — per-session revision diffing + resumable folds; the dashboard serves the cached snapshot immediately and finishes scans in the background.

## Understanding the numbers (important)

DeepSeek-style APIs count **cache-hit prompt tokens as input** in their consoles. In long-running sessions with large contexts, every tool call re-sends the whole conversation, so **99%+ of "input" can be cache reads** — that is why a busy day can show *billions* of raw tokens while your actual **new** tokens are only tens of millions.

This plugin follows that convention deliberately (so the dashboard matches your provider console), but always separates the three numbers:

| Term | Meaning |
| --- | --- |
| **Input** | uncached (new) input tokens only |
| **Cache hits** | prompt tokens served from the provider cache (re-reads) |
| **Output** | generated tokens |

If the raw totals feel too large, look at the **new-token** figures (day cells, hour buckets, and the "Input" line) — that is the usage you intuitively "produced".

## Install

### From npm (recommended)

```bash
dsh plugin --profile <name> add dsh-usage-analytics
```

Then restart the web service (profile bundles load at startup).

### Manual / local development

1. Copy the package to `data/profiles/web/plugins/dsh-usage-analytics/` (pure JS, no build step).
2. Make it resolvable from the web profile's `node_modules/@local/dsh-usage-analytics` (a directory junction/symlink to step 1, or an actual copy — both work; note the two locations are **not** auto-synced, keep them in step).
3. Add `dsh-usage-analytics` to `dsh.profile.bundles` in `data/profiles/web/package.json` (plus a `file:` dependency if you use `pnpm install`).
4. Restart the web service.

After the restart:

- The sidebar footer shows a **Usage** entry → opens the full-screen dashboard;
- `GET /api/dsh-usage-analytics/stats` returns the aggregate JSON (`?force=1` triggers a full rescan);
- The browser bundle is served at `/plugins/@local/dsh-usage-analytics/client.js` (per the profile bundle roster).

## Usage

Click **Usage** in the sidebar footer. Use the period pills in the header to filter every chart (`Today`, `24h`, `7 days`, `30 days`, `90 days`, `All time`). Hover the heatmap cells for per-day details. The **刷新** button re-syncs from the session logs (first open after a cache-version bump rebuilds the aggregate in a few seconds).

## Data & privacy

| Guarantee | How |
| --- | --- |
| Local only | Reads session logs through `ctx.sessionPersistence`; never writes into sessions; loopback-only HTTP routes with a same-origin fence |
| Metadata only | Consumes event types and numeric `usage` fields only — no user-authored prompt content is collected, persisted, or served |
| Failure-isolated | Every fold/listener is try/catch-contained; a failing analytics never affects the agent loop or the GUI (worst case: a stale cache served with `stale: true`) |

## Architecture

```
Session events / sessions
   └─> lib/aggregate.js   pure-function aggregation core (foldEvent / mergeInto / computeInsights / streaks)
          └─> lib/store.js incremental cache: revision diffing + readFrom(fromSeq) single-source fold + JSON persistence
                 └─> lib/index.js host plugin: /api/dsh-usage-analytics/stats route + background catch-up folding
                        └─> lib/client.js browser bundle: sidebar.footer.action + shell.overlay official slots
```

- **Single-source fold (v3)** — tokens are folded only from the persisted log via `readFrom(fromSeq)`; the watermark advances only from persisted reads, so double counting is impossible.
- **Incremental** — `sessionPersistence.listSnapshots()` exposes per-session stat revisions (header-only reads); unchanged sessions are skipped entirely, changed ones re-fold only their tail.
- **Cache** — per-session fold results + revision watermarks are persisted to `<DSH_HOME>/usage-analytics/agg.json` (atomic write); `CACHE_VERSION` bumps rebuild the cache automatically.
- **Per-model per-day buckets (v9)** — each model records daily new/raw/output/call totals so the model-share chart can follow the period selector.
- **Ghost-fork detection (v6)** — a forked session whose whole usage predates its own creation is treated as a copied seed and excluded.

## Development

```bash
npm test                    # node --test: aggregation core + client bundle smoke (zero dependencies)
node scripts/verify-data.mjs   # print what the dashboard would show from real session data
node scripts/smoke-host.mjs    # end-to-end smoke: real persistence + plugin apply + route handler
```

Layout: `lib/` (host + client), `test/` (unit tests), `scripts/` (dev verification tools, not published).

## Known limitations

- **No cost estimates** — no local pricing table; a provider→price mapping extension point could be added later.
- **Skill-level token attribution** — only skill *call counts* are tracked; tokens cannot be attributed to a single skill.
- **Session duration** — approximated by the wall-clock span between the first and last event.
- **Deleting a session does not immediately shrink the stats** — the aggregate cache keeps folded results until a full rebuild (`CACHE_VERSION` bump or clearing `agg.json` + restart). The dashboard itself already excludes ghost forks at snapshot time.
- **Multi-window freshness** — host aggregation is in-process; concurrent writers to the cache file are safe (atomic rename) but last write wins.

## FAQ

**Why does a single day show billions of tokens?**
That is the provider-console raw convention: it includes cache-hit prompt tokens. In long sessions with ~100k–800k token contexts, every call re-reads most of the context. Your actual new tokens that day are usually two orders of magnitude smaller — see [Understanding the numbers](#understanding-the-numbers-important).

**Are the numbers fabricated?**
No — every figure is summed from `assistant/message.usage` events recorded in your own session logs, per API call. Nothing is estimated, extrapolated, or injected.

**Why don't deleted conversations reduce the totals?**
Deletion removes the log, but the analytics cache keeps the already-folded statistics until a full rebuild. This is a documented limitation (see above).

**What are "ghost sessions"?**
Session forks that were created but never ran — their entire log is a copied seed of a parent conversation. Counting them would double-count the parent's tokens, so they are excluded automatically.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

### Understanding the dashboard numbers

- **Period** (`Today`, `24h`, `7/30/90 days`, `All time`) applies to the headline, cache rate, token mix, model share, sessions, turns, steps, tool calls, skills and plugin calls. The last 7/30/90 days are **calendar days including today**; Today/24h use hourly buckets.
- **Activity heatmap** and **Personal insights (all time)** always cover the full recorded history and are explicitly marked as such.
- **Period tokens** = fresh input + output + cache-write tokens + cache-hit reads. **Model share** defaults to this same basis, with a toggle to exclude cached reads.
- **Token mix** uses the headline's total as its denominator: fresh input (including cache writes), output, and cache-hit reads. The separate cache-hit rate is the share of cached reads in all input tokens.
- **Model usage records** count assistant-message events with usage metadata, not guaranteed to be identical to the number of HTTP requests to the provider. **Plugin calls** include Cordis dynamic tools, the MCP dispatcher and namespaced MCP tools.
- Cache-hit tokens reflect *provider-reported* reuse; they do not directly measure MLX-Serve's internal KV-cache or GPU efficiency.
