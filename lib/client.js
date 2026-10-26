/**
 * dsh-usage-analytics — browser half. Runs inside the dsh web GUI.
 *
 * Mounts two slot surfaces (no DOM injection, no shell hacks):
 *   - `sidebar.footer.action`  — the "Usage" entry beside Settings (sized to
 *     match the Settings trigger row exactly);
 *   - `shell.overlay`          — the full-screen activity dashboard with two
 *     layouts: Main (heatmap + core stats) and More (trends, effort,
 *     presets, session facts), switched from the header's right side.
 *
 * Data flow: plain same-origin fetch to the host route family
 * (`/api/dsh-usage-analytics/stats`). The dashboard renders metadata and
 * numeric aggregates only — no prompt content ever leaves the host.
 *
 * Failure policy: all mounts are wrapped so a rendering/registration problem
 * degrades the dashboard, never the GUI (the web shell fails the whole boot
 * when a plugin apply throws).
 */
window.__ModuleLoader__.load({
	id: "@local/dsh-usage-analytics",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var React = require("react");
		var createElement = React.createElement;
		var useState = React.useState;
		var useEffect = React.useEffect;
		var useMemo = React.useMemo;
		var useCallback = React.useCallback;
		var useSyncExternalStore = React.useSyncExternalStore;

		/** Locale namespace this plugin owns. */
		var NS = "dsh-usage-analytics";

		/** API base for the host route family. */
		var API_STATS = "/api/dsh-usage-analytics/stats";

		// ------------------------------------------------------------------
		// i18n dictionaries (registered via ctx.locale; bound with ctx.locale.bind)
		// ------------------------------------------------------------------
		var STR = {
			zh: {
				"sidebar.label": "用量统计",
				"sidebar.tooltip": "打开 Agent 使用统计面板",
				"title": "Agent 使用统计",
				"subtitle": "基于本地会话事件实时聚合 · 数据不出本机",
				"period.7": "近 7 天",
				"period.30": "近 30 天",
				"period.90": "近 90 天",
				"period.all": "全部",
				"period.today": "今天",
				"period.24h": "24 小时",
				"refresh": "刷新",
				"refresh.busy": "刷新中…",
				"refresh.failed": "刷新失败，请稍后重试",
				"updated.at": "更新于",
				"close": "关闭",
				"view.main": "常用",
				"view.more": "更多",
				"stat.tokens": "累计 Token",
				"stat.tokensGrand": "累计 Token（含缓存命中）",
				"stat.tokensPeriod": "区间 Token（含缓存命中）",
				"stat.sessions": "会话数",
				"stat.turns": "消息轮次",
				"stat.toolCalls": "工具调用",
				"stat.cacheRate": "缓存命中率",
				"stat.activeDays": "活跃天数",
				"stat.currentStreak": "当前连续",
				"stat.longestStreak": "最长连续",
				"heat.title": "活动热力图",
				"heat.hint": "完整历史（不受时间筛选影响）· 悬停查看详情",
				"heat.legendLess": "少",
				"heat.legendMore": "多",
				"heat.dayTokens": "Token",
				"heat.dayTurns": "轮次",
				"heat.tipUsed": "使用",
				"heat.newTokens": "新Token",
				"trend.title": "Token 趋势",
				"trend.daily": "每日",
				"trend.weekly": "每周",
				"mix.title": "Token 构成",
				"mix.input": "未缓存输入",
				"mix.inputRaw": "总输入(含缓存)",
				"mix.output": "输出",
				"mix.cache": "缓存",
				"mix.cacheHit": "缓存命中",
				"mix.reasoning": "推理",
				"models.title": "模型分布",
				"models.calls": "条 usage 记录",
				"models.all": "所有 Token（含缓存）",
				"models.fresh": "不含缓存读取",
				"effort.title": "推理强度分布",
				"rank.empty": "暂无数据",
				"rank.times": "次",
				"insights.title": "个人使用洞察（所有时间）",
				"insight.peakDay": "最活跃的一天",
				"insight.longestStreak": "最长连续活跃",
				"insight.avgTokens": "平均每会话 Token",
				"insight.avgSteps": "平均每轮步数",
				"insight.topModel": "最常用模型",
				"insight.cacheShare": "缓存命中占比",
				"insight.reasoningShare": "推理 Token 占比",
				"insight.topTool": "最常用工具",
				"insight.topSkill": "最常用 Skill",
				"insight.pluginCalls": "动态插件调用",
				"insight.subagents": "Subagent 会话",
				"insight.busyHour": "最忙碌时段",
				"insight.longestSession": "最长会话",
				"insight.longestSession.min": "分钟",
				"insight.days": "天",
				"insight.steps": "步/轮",
				"insight.hour": "点",
				"loading": "正在聚合本地会话…",
				"loadingHint": "首次打开需扫描历史日志，之后为增量更新",
				"error.title": "加载失败",
				"error.desc": "聚合服务暂时不可用，请稍后重试。",
				"error.retry": "重试",
				"empty.title": "还没有使用记录",
				"empty.desc": "开始一次会话后，这里会展示你的 Agent 使用统计。",
				"footer.note": "数据来自本地会话事件日志 · 仅统计元数据与数值",
			},
			en: {
				"sidebar.label": "Usage",
				"sidebar.tooltip": "Open the Agent usage analytics dashboard",
				"title": "Agent Usage Analytics",
				"subtitle": "Aggregated live from your local session logs · stays on this machine",
				"period.7": "7 days",
				"period.30": "30 days",
				"period.90": "90 days",
				"period.all": "All time",
				"period.today": "Today",
				"period.24h": "24h",
				"refresh": "Refresh",
				"refresh.busy": "Refreshing…",
				"refresh.failed": "Refresh failed, please retry",
				"updated.at": "Updated at",
				"close": "Close",
				"view.main": "Main",
				"view.more": "More",
				"stat.tokens": "Total tokens",
				"stat.tokensGrand": "Total tokens (incl. cache)",
				"stat.tokensPeriod": "Period tokens (incl. cache)",
				"stat.sessions": "Sessions",
				"stat.turns": "Turns",
				"stat.toolCalls": "Tool calls",
				"stat.cacheRate": "Cache hit rate",
				"stat.activeDays": "Active days",
				"stat.currentStreak": "Current streak",
				"stat.longestStreak": "Longest streak",
				"heat.title": "Activity heatmap",
				"heat.hint": "Full history (not filtered) · hover a day for details",
				"heat.legendLess": "Less",
				"heat.legendMore": "More",
				"heat.dayTokens": "tokens",
				"heat.dayTurns": "turns",
				"heat.tipUsed": "used",
				"heat.newTokens": "new",
				"trend.title": "Token trend",
				"trend.daily": "Daily",
				"trend.weekly": "Weekly",
				"mix.title": "Token mix",
				"mix.input": "Fresh input",
				"mix.inputRaw": "Total input (incl. cache)",
				"mix.output": "Output",
				"mix.cache": "Cache",
				"mix.cacheHit": "Cache hits",
				"mix.reasoning": "Reasoning",
				"models.title": "Model share",
				"models.calls": "usage records",
				"models.all": "All tokens (incl. cache)",
				"models.fresh": "Without cache reads",
				"effort.title": "Reasoning effort",
				"rank.empty": "No data yet",
				"rank.times": "×",
				"insights.title": "Personal insights (all time)",
				"insight.peakDay": "Most active day",
				"insight.longestStreak": "Longest active streak",
				"insight.avgTokens": "Tokens per session",
				"insight.avgSteps": "Steps per turn",
				"insight.topModel": "Most used model",
				"insight.cacheShare": "Cache hit share",
				"insight.reasoningShare": "Reasoning token share",
				"insight.topTool": "Top tool",
				"insight.topSkill": "Top skill",
				"insight.pluginCalls": "Dynamic plugin calls",
				"insight.subagents": "Subagent sessions",
				"insight.busyHour": "Busiest hour",
				"insight.longestSession": "Longest session",
				"insight.longestSession.min": "min",
				"insight.days": "d",
				"insight.steps": "steps/turn",
				"insight.hour": ":00",
				"loading": "Aggregating your sessions…",
				"loadingHint": "First open scans your history; later opens are incremental",
				"error.title": "Could not load",
				"error.desc": "The analytics service is unavailable. Please retry.",
				"error.retry": "Retry",
				"empty.title": "No usage yet",
				"empty.desc": "Start a session and come back — your Agent activity will show up here.",
				"footer.note": "From local session event logs · metadata and numbers only",
			},
		};

		// ------------------------------------------------------------------
		// open/close state (module-level store shared by the entry + overlay)
		// ------------------------------------------------------------------
		var openState = { open: false, listeners: [] };
		function setOpen(open) {
			openState.open = open;
			for (var i = 0; i < openState.listeners.length; i++) openState.listeners[i]();
		}
		function subscribeOpen(fn) {
			openState.listeners.push(fn);
			return function () {
				var idx = openState.listeners.indexOf(fn);
				if (idx >= 0) openState.listeners.splice(idx, 1);
			};
		}
		function getOpen() {
			return openState.open;
		}

		// ------------------------------------------------------------------
		// tiny helpers
		// ------------------------------------------------------------------
		function fmtTokens(n) {
			if (!isFinite(n)) return "0";
			if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
			return String(Math.round(n));
		}
		function fmtInt(n) {
			if (n == null || !isFinite(n)) return "0";
			return Math.round(n).toLocaleString();
		}
		function fmtPct(n) {
			return (n == null ? 0 : Math.round(n)) + "%";
		}
		function dayOf(dayKey) {
			var parts = String(dayKey).split("-");
			return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
		}
		/** Epoch-ms cutoff for a period key ("all" → 0, inclusive filtering). */
		function periodCutoffMs(period) {
			if (period === "all") return 0;
			if (period === "today") {
				var d0 = new Date();
				d0.setHours(0, 0, 0, 0);
				return d0.getTime();
			}
			if (period === "24h") return Date.now() - 24 * 3600000;
			var start = new Date();
			start.setHours(0, 0, 0, 0);
			start.setDate(start.getDate() - Number(period) + 1);
			return start.getTime();
		}
		function fmtDay(dayKey, locale) {
			try {
				return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" }).format(dayOf(dayKey));
			} catch {
				return dayKey;
			}
		}
		function fmtDayShort(dayKey, locale) {
			try {
				return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric" }).format(dayOf(dayKey));
			} catch {
				return dayKey;
			}
		}
		/** Hour bucket key "YYYY-MM-DD-HH" → "MM-DD HH:00" (locales share digits). */
		function fmtHourKey(hk) {
			var parts = String(hk).split("-");
			if (parts.length !== 4) return hk;
			return parts[1] + "-" + parts[2] + " " + parts[3] + ":00";
		}
		function fmtDur(ms) {
			if (ms == null || !isFinite(ms)) return "—";
			var minutes = Math.round(ms / 60000);
			if (minutes < 60) return minutes + "m";
			var hours = Math.floor(minutes / 60);
			var rest = minutes % 60;
			return hours + "h" + (rest > 0 ? " " + rest + "m" : "");
		}
		function activeLocale() {
			try {
				var lang = (document.documentElement.lang || navigator.language || "en").toLowerCase();
				return lang.startsWith("zh") ? "zh" : "en";
			} catch {
				return "en";
			}
		}
		/** Short human model label: strip provider prefix for readability. */
		function shortModel(name) {
			var idx = String(name).lastIndexOf("/");
			return idx >= 0 ? String(name).slice(idx + 1) : String(name);
		}

		// ------------------------------------------------------------------
		// api client
		// ------------------------------------------------------------------
		function fetchStats(force) {
			var url = API_STATS + (force ? "?force=1" : "");
			return fetch(url, { headers: { accept: "application/json" }, credentials: "same-origin" })
				.then(function (res) {
					if (!res.ok) throw new Error("HTTP " + res.status);
					return res.json();
				});
		}

		// ------------------------------------------------------------------
		// CSS (injected once at apply; DSW design tokens, light/dark safe)
		// ------------------------------------------------------------------
		var CSS = [
			// Backdrop + centered modal (window width matches the heatmap row).
			".dshua-root{position:fixed;inset:0;z-index:60;pointer-events:auto;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}",
			".dshua-shell{width:820px;max-width:calc(100vw - 40px);max-height:calc(100vh - 48px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#0f1115);border:1px solid var(--dsw-alias-border-l2,#2c313a);border-radius:16px;box-shadow:var(--dsw-shadow-lv3,0 16px 48px rgba(0,0,0,.5));padding:14px 16px 10px;box-sizing:border-box;overflow:hidden}",
			".dshua-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1,#22262e)}",
			".dshua-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaed);letter-spacing:.2px}",
			".dshua-subtitle{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919e);margin-top:1px}",
			".dshua-updated{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a919e);margin-top:2px;font-variant-numeric:tabular-nums}",
			".dshua-btnBusy{opacity:.65}",
			".dshua-banner{border:1px solid var(--dsw-alias-state-warn-primary,#d9a13b);color:var(--dsw-alias-state-warn-primary,#d9a13b);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d9a13b) 10%,transparent);border-radius:8px;padding:6px 10px;font-size:12px;margin-bottom:10px}",
			".dshua-spacer{flex:1}",
			".dshua-pills{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2,#1a1d24);border:1px solid var(--dsw-alias-border-l1,#22262e);border-radius:8px;padding:2px}",
			".dshua-pill{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#b6bcc7);font-size:12px;line-height:22px;padding:0 10px;border-radius:6px;cursor:pointer;font-family:inherit}",
			".dshua-pill:hover{color:var(--dsw-alias-label-primary,#e8eaed)}",
			".dshua-pillOn{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 18%,transparent);color:var(--dsw-alias-label-primary,#e8eaed);font-weight:600;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 65%,transparent)}",
			".dshua-pillOn:hover{color:var(--dsw-alias-label-primary,#e8eaed)}",
			".dshua-btn{border:1px solid var(--dsw-alias-border-l2,#2c313a);background:var(--dsw-alias-bg-layer-2,#1a1d24);color:var(--dsw-alias-label-secondary,#b6bcc7);border-radius:8px;height:28px;padding:0 10px;font-size:12px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}",
			".dshua-btn:hover{color:var(--dsw-alias-label-primary,#e8eaed)}",
			".dshua-btn:disabled{opacity:.5;cursor:default}",
			".dshua-close{border-color:transparent;background:transparent;padding:0 4px}",
			".dshua-body{flex:1;min-height:0;overflow:auto;padding:12px 2px 6px;scrollbar-width:thin}",
			".dshua-body::-webkit-scrollbar{width:10px;height:10px}",
			".dshua-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#333944);border-radius:5px;border:2px solid transparent;background-clip:content-box}",
			".dshua-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(116px,1fr));gap:8px;margin-bottom:10px}",
			".dshua-card{background:var(--dsw-alias-bg-layer-1,#161a21);border:1px solid var(--dsw-alias-border-l1,#22262e);border-radius:10px;padding:10px 12px;box-sizing:border-box;min-width:0}",
			".dshua-stat .dshua-statLabel{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a919e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dshua-stat .dshua-statValue{font-size:18px;font-weight:650;color:var(--dsw-alias-label-primary,#e8eaed);margin-top:2px;font-variant-numeric:tabular-nums;letter-spacing:-.2px}",
			".dshua-stat .dshua-statSub{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a919e);margin-top:1px}",
			".dshua-statWide{grid-column:span 2}.dshua-statWide .dshua-statValue{font-size:24px;letter-spacing:-.4px}.dshua-statWide .dshua-statSub{font-size:11px}",
			".dshua-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:10px}",
			".dshua-gridWide{grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)}",
			".dshua-sectionTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaed);margin-bottom:8px;display:flex;align-items:center;gap:8px}",
			".dshua-sectionTitle .dshua-hint{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a919e)}",
			".dshua-margin{margin-bottom:10px}",
			// ---- heatmap: single row, fits the modal width exactly ----
			".dshua-heatwrap{overflow:visible;padding:2px 4px 0 0}",
			".dshua-heat{display:flex;gap:3px;width:max-content;min-width:100%}",
			".dshua-heatCol{display:flex;flex-direction:column;gap:3px}",
			".dshua-heatCell{width:11px;height:11px;box-sizing:border-box;border-radius:3px;background:var(--dsw-alias-bg-layer-2,#1a1d24);border:1px solid var(--dsw-alias-border-l1,#22262e);position:relative;cursor:pointer}",
			".dshua-heatL1{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fbf8a) 25%,var(--dsw-alias-bg-layer-2,#1a1d24));border-color:transparent}",
			".dshua-heatL2{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fbf8a) 48%,var(--dsw-alias-bg-layer-2,#1a1d24));border-color:transparent}",
			".dshua-heatL3{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fbf8a) 70%,var(--dsw-alias-bg-layer-2,#1a1d24));border-color:transparent}",
			".dshua-heatL4{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fbf8a) 92%,var(--dsw-alias-bg-layer-2,#1a1d24));border-color:transparent}",
			".dshua-heatToday{outline:1.5px solid var(--dsw-alias-brand-primary,#4f6ef7);outline-offset:1px}",
			".dshua-heatCell:hover{outline:1px solid var(--dsw-alias-label-primary,#e8eaed);outline-offset:1px}",
			// Floating day tooltip: fixed-position, follows the cursor, never clipped or covered.
			".dshua-heatTipFloat{position:fixed;z-index:9999;pointer-events:none;transform:translate(-50%,-135%);background:var(--dsw-specific-menu,#20242c);color:var(--dsw-alias-label-primary,#e8eaed);border:1px solid var(--dsw-alias-border-l2,#2c313a);border-radius:6px;padding:4px 9px;font-size:11px;line-height:1.5;white-space:nowrap;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.45))}",
			".dshua-heatMonths{display:flex;gap:3px;margin-bottom:4px;min-width:100%;height:14px;position:relative}",
			".dshua-heatMonth{position:absolute;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a919e);white-space:nowrap;top:0}",
			".dshua-heatLegend{display:flex;align-items:center;gap:4px;margin-top:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919e)}",
			".dshua-heatLegend .dshua-heatCell{display:inline-block;width:10px;height:10px;margin:0 2px}",
			// ---- trend bars ----
			".dshua-bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding-top:8px}",
			".dshua-bar{flex:1;min-width:2px;background:linear-gradient(180deg,var(--dsw-alias-brand-primary,#4f6ef7),color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 55%,transparent));border-radius:2px 2px 0 0;opacity:.85;position:relative}",
			".dshua-barHour{flex:1 1 14px;max-width:26px;min-width:3px}",
			".dshua-bar:hover{opacity:1}",
			".dshua-barTip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--dsw-specific-menu,#20242c);border:1px solid var(--dsw-alias-border-l2,#2c313a);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--dsw-alias-label-primary,#e8eaed);white-space:nowrap;z-index:5;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.35))}",
			".dshua-bar:hover .dshua-barTip{display:block}",
			".dshua-barAxis{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a919e);margin-top:4px}",
			// ---- mix / models / ranks / insights ----
			".dshua-mixRow{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#1a1d24);margin-bottom:10px}",
			".dshua-mixSeg{height:100%}",
			".dshua-legend{display:flex;flex-direction:column;gap:6px}",
			".dshua-legendRow{display:flex;align-items:center;gap:8px;font-size:12px;min-width:0;color:var(--dsw-alias-label-secondary,#b6bcc7)}",
			".dshua-dot{width:8px;height:8px;border-radius:2.5px;flex:none}",
			".dshua-legendName{flex:0 1 auto;min-width:64px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dshua-legendVal{flex:1 1 auto;min-width:92px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e8eaed)}",
			".dshua-legendPct{flex:none;width:42px;text-align:right;color:var(--dsw-alias-label-tertiary,#8a919e);font-variant-numeric:tabular-nums}",
			".dshua-rankList{display:flex;flex-direction:column;gap:8px}",
			".dshua-rankRow{display:flex;align-items:center;gap:8px;font-size:12px}",
			".dshua-rankName{width:38%;min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#b6bcc7)}",
			".dshua-rankTrack{flex:1;height:10px;background:var(--dsw-alias-bg-layer-2,#1a1d24);border-radius:5px;overflow:hidden}",
			".dshua-rankFill{height:100%;border-radius:5px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary,#4f6ef7),color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 65%,#3fbf8a))}",
			".dshua-rankCount{width:56px;text-align:right;color:var(--dsw-alias-label-tertiary,#8a919e);font-variant-numeric:tabular-nums}",
			".dshua-rankEmpty{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a919e);padding:8px 0}",
			".dshua-insights{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-bottom:10px}",
			".dshua-insight{padding:8px 10px}",
			".dshua-insightLabel{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a919e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dshua-insightValue{font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary,#e8eaed);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".dshua-insightSub{font-size:10px;color:var(--dsw-alias-label-secondary,#b6bcc7);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dshua-loading{display:flex;flex-direction:column;align-items:center;gap:10px;padding:80px 0;color:var(--dsw-alias-label-secondary,#b6bcc7)}",
			".dshua-spinner{width:26px;height:26px;border-radius:50%;border:2.5px solid var(--dsw-alias-bg-layer-2,#1a1d24);border-top-color:var(--dsw-alias-brand-primary,#4f6ef7);animation:dshuaSpin .8s linear infinite}",
			".dshua-loadingHint{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a919e)}",
			".dshua-center{display:flex;flex-direction:column;align-items:center;gap:8px;padding:80px 0;text-align:center}",
			".dshua-emptyTitle{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaed)}",
			".dshua-emptyDesc{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a919e);max-width:340px}",
			".dshua-footer{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919e);padding:6px 2px 2px;border-top:1px solid var(--dsw-alias-border-l1,#22262e)}",
			// ---- sidebar entry: matched to the Settings trigger row ----
			".dshua-entry{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#b6bcc7);padding:6px 2px 6px 10px;border-radius:0;cursor:pointer;font-family:inherit;font-size:14px;line-height:22px;min-height:34px;box-sizing:border-box}",
			".dshua-entry:hover,.dshua-entryOn{color:var(--dsw-alias-label-primary,#e8eaed);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#1a1d24) 60%,transparent)}",
			".dshua-entryIcon{flex:none;display:inline-flex;color:inherit}",
			".dshua-entryLabel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			"@keyframes dshuaSpin{to{transform:rotate(360deg)}}",
			"@media (max-width:900px){.dshua-grid,.dshua-gridWide{grid-template-columns:1fr}.dshua-shell{padding:12px 12px 8px}.dshua-heatCell{width:8px;height:8px}.dshua-heatCol{gap:2px}.dshua-heat{gap:2px}}",
		].join("\n");

		var CSS_TAG_ID = NS + "/dash.css";

		// ------------------------------------------------------------------
		// shared sub-components
		// ------------------------------------------------------------------
		function StatCard(props) {
			return createElement("div", { className: "dshua-card dshua-stat" + (props.wide ? " dshua-statWide" : "") },
				createElement("div", { className: "dshua-statLabel" }, props.label),
				createElement("div", { className: "dshua-statValue" }, props.value),
				props.sub ? createElement("div", { className: "dshua-statSub" }, props.sub) : null,
			);
		}

		function Section(props) {
			return createElement("div", { className: "dshua-card" + (props.margin ? " dshua-margin" : "") },
				createElement("div", { className: "dshua-sectionTitle" },
					props.title,
					props.hint ? createElement("span", { className: "dshua-hint" }, props.hint) : null,
				),
				props.children,
			);
		}

		function LegendRow(props) {
			return createElement("div", { className: "dshua-legendRow" },
				createElement("span", { className: "dshua-dot", style: { background: props.color } }),
				createElement("span", { className: "dshua-legendName", title: props.nameTitle || props.name }, props.name),
				createElement("span", { className: "dshua-legendPct" }, fmtPct(props.pct)),
				createElement("span", { className: "dshua-legendVal", title: props.value }, props.value),
			);
		}

		/** Contribution-graph heatmap over a day map — one full row, fits the modal width. */
		function Heatmap(props) {
			var days = props.days;
			var t = props.t;
			var locale = props.locale;
			var [hover, setHover] = useState(null);

			var cells = useMemo(function () {
				var entries = Object.keys(days).map(function (k) {
					var cell = days[k] || {};
					// Intensity rides the provider-console total (incl. cache hits);
					// the new-token figure stays available for the tooltip.
					var raw = cell.tokensRaw || cell.tokens || 0;
					return { key: k, tokens: raw, newTokens: cell.tokens || 0, turns: cell.turns || 0 };
				}).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
				var nonzero = entries.filter(function (e) { return e.tokens > 0; }).map(function (e) { return e.tokens; }).sort(function (a, b) { return a - b; });
				var thresholds = [];
				var len = nonzero.length;
				if (len > 0) {
					var q = function (p) { return nonzero[Math.min(len - 1, Math.floor(p * len))]; };
					thresholds = [q(0.3), q(0.55), q(0.75), q(1)];
				}
				var byKey = {};
				for (var i = 0; i < entries.length; i++) {
					var e = entries[i];
					var level = 0;
					if (e.tokens > 0) {
						for (var k = 0; k < thresholds.length; k++) if (e.tokens >= thresholds[k]) level = k + 1;
					}
					byKey[e.key] = { level: level, tokens: e.tokens, newTokens: e.newTokens, turns: e.turns };
				}
				return byKey;
			}, [days]);

			var grid = useMemo(function () {
				var today = new Date();
				today.setHours(0, 0, 0, 0);
				var end = today.getTime();
				var start = end - 52 * 7 * 86400000;
				var keys = Object.keys(days).sort();
				if (keys.length > 0) {
					var first = dayOf(keys[0]);
					if (!isNaN(first.getTime()) && first.getTime() < start) start = first.getTime();
				}
				var cols = [];
				var cur = new Date(start);
				var todayKey = dayKeyOf(today);
				while (cur.getTime() <= end) {
					var weekStart = cur.getTime() - cur.getDay() * 86400000;
					var col = [];
					for (var d = 0; d < 7; d++) {
						var cellDate = new Date(weekStart + d * 86400000);
						var key = dayKeyOf(cellDate);
						col.push({ key: key, info: cells[key], today: key === todayKey, future: cellDate.getTime() > end });
					}
					cols.push(col);
					cur = new Date(weekStart + 7 * 86400000);
					if (cur.getTime() <= start) break; // safety
				}
				return cols;
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [cells]);

			var monthLabels = useMemo(function () {
				var labels = [];
				var lastMonth = -1;
				for (var ci = 0; ci < grid.length; ci++) {
					var cell = grid[ci][0];
					var d = dayOf(cell.key);
					if (isNaN(d.getTime())) continue;
					if (d.getMonth() !== lastMonth && d.getDate() <= 7) {
						labels.push({ index: ci, label: new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "short" }).format(d) });
						lastMonth = d.getMonth();
					}
				}
				return labels;
			}, [grid, locale]);

			function dayKeyOf(d) {
				var y = d.getFullYear();
				var m = String(d.getMonth() + 1).padStart(2, "0");
				var day = String(d.getDate()).padStart(2, "0");
				return y + "-" + m + "-" + day;
			}

			var weekdays = ["S", "M", "T", "W", "T", "F", "S"];
			var cols = grid.map(function (col, i) {
				var cellsEl = col.map(function (cell) {
					var info = cell.info;
					var level = info ? info.level : 0;
					var tip = fmtDay(cell.key, locale) + " " + t("heat.tipUsed") + " " + fmtTokens(info ? info.tokens : 0) + " " + t("heat.dayTokens");
					var cls = "dshua-heatCell";
					if (level > 0) cls += " dshua-heatL" + level;
					if (cell.today) cls += " dshua-heatToday";
					return createElement("div", {
						className: cls,
						key: cell.key,
						title: tip,
						onMouseEnter: function (e) { setHover({ text: tip, x: e.clientX, y: e.clientY }); },
						onMouseMove: function (e) { setHover({ text: tip, x: e.clientX, y: e.clientY }); },
						onMouseLeave: function () { setHover(null); },
					});
				});
				return createElement("div", { className: "dshua-heatCol", key: "col" + i }, cellsEl);
			});
			var monthsRow = createElement("div", { className: "dshua-heatMonths" },
				monthLabels.map(function (m) {
					return createElement("span", {
						className: "dshua-heatMonth",
						key: m.index,
						style: { left: 14 + m.index * 14 + "px" },
					}, m.label);
				}),
			);

			return createElement("div", null,
				createElement("div", { className: "dshua-heatwrap" },
					monthsRow,
					createElement("div", { className: "dshua-heat" },
						createElement("div", { className: "dshua-heatCol", key: "wd" },
							weekdays.map(function (w, i) {
								return createElement("div", { key: i, style: { width: 11, height: 11, fontSize: 8, lineHeight: "11px", textAlign: "center", color: "var(--dsw-alias-label-tertiary,#8a919e)" } }, w);
							}),
						),
						cols,
					),
				),
				createElement("div", { className: "dshua-heatLegend" },
					t("heat.legendLess"),
					createElement("span", { className: "dshua-heatCell" }),
					createElement("span", { className: "dshua-heatCell dshua-heatL1" }),
					createElement("span", { className: "dshua-heatCell dshua-heatL2" }),
					createElement("span", { className: "dshua-heatCell dshua-heatL3" }),
					createElement("span", { className: "dshua-heatCell dshua-heatL4" }),
					t("heat.legendMore"),
				),
				// Floating day tooltip — fixed-position, above everything, never clipped.
				hover ? createElement("div", { className: "dshua-heatTipFloat", style: { left: hover.x + "px", top: hover.y + "px" } }, hover.text) : null,
			);
		}

		/** Mix helper: interpolate between two rgb triplets. */
		function mixRgb(a, b, t) {
			return [
				Math.round(a[0] + (b[0] - a[0]) * t),
				Math.round(a[1] + (b[1] - a[1]) * t),
				Math.round(a[2] + (b[2] - a[2]) * t),
			];
		}

		/**
		 * Trend bar color by value ratio — blue → teal → amber, so neighbouring
		 * bars stay visually distinct and the highest days read warm.
		 */
		function trendColor(ratio) {
			var low = [79, 110, 247];   // #4f6ef7 blue
			var mid = [46, 196, 182];   // #2ec4b6 teal
			var high = [240, 160, 80];  // #f0a050 amber
			var c = ratio < 0.5 ? mixRgb(low, mid, ratio * 2) : mixRgb(mid, high, (ratio - 0.5) * 2);
			return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
		}

		/** Daily/weekly token bars for a period. */
		function TrendBars(props) {
			var days = props.days;
			var mode = props.mode;
			var hours = props.hours;
			var t = props.t;
			var locale = props.locale;

			var data = useMemo(function () {
				if (hours) {
					// Hourly mode ("today" / "24h"): absolute hour buckets.
					return Object.keys(hours).sort().map(function (hk) { return { key: hk, value: hours[hk] || 0 }; });
				}
				var dayVal = function (k) { return (days[k] && (days[k].tokensRaw || days[k].tokens)) || 0; };
				if (mode === "weekly") {
					var weeks = {};
					Object.keys(days).forEach(function (k) {
						var d = dayOf(k);
						var weekStart = new Date(d.getTime() - d.getDay() * 86400000);
						var wk = weekStart.getFullYear() + "-" + String(weekStart.getMonth() + 1).padStart(2, "0") + "-" + String(weekStart.getDate()).padStart(2, "0");
						weeks[wk] = (weeks[wk] || 0) + dayVal(k);
					});
					return Object.keys(weeks).sort().map(function (k) { return { key: k, value: weeks[k] }; });
				}
				return Object.keys(days).sort().map(function (k) { return { key: k, value: dayVal(k) }; });
			}, [days, mode, hours]);

			if (data.length === 0) return createElement("div", { className: "dshua-rankEmpty" }, t("rank.empty"));
			var max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;

			var bars = data.map(function (d) {
				var ratio = max > 0 ? d.value / max : 0;
				var h = Math.max(2, Math.round(ratio * 100));
				var color = trendColor(Math.min(1, ratio));
				var tip = fmtTokens(d.value) + " · " + (hours ? fmtHourKey(d.key) : fmtDayShort(d.key, locale));
				return createElement("div", {
					className: "dshua-bar" + (hours ? " dshua-barHour" : ""),
					key: d.key,
					style: {
						height: h + "%",
						background: "linear-gradient(180deg," + color + ",color-mix(in srgb," + color + " 45%,transparent))",
					},
				},
					createElement("span", { className: "dshua-barTip" }, tip),
				);
			});

			var first = data[0].key;
			var last = data[data.length - 1].key;
			return createElement("div", null,
				createElement("div", { className: "dshua-bars" }, bars),
				createElement("div", { className: "dshua-barAxis" },
					createElement("span", null, hours ? fmtHourKey(first) : fmtDayShort(first, locale)),
					createElement("span", null, hours ? fmtHourKey(last) : fmtDayShort(last, locale)),
				),
			);
		}

		/** Stacked model share bar + legend. */
		function ModelShare(props) {
			var models = props.models;
			var t = props.t;
			// Group by model name: the same model served through several
			// providers (e.g. aaa/… and acme-gateway/…) must collapse into one
			// row, with the provider list noted when there is more than one.
			var groups = {};
			Object.keys(models || {}).forEach(function (k) {
				var key = String(k);
				var slash = key.lastIndexOf("/");
				var model = slash >= 0 ? key.slice(slash + 1) : key;
				var provider = slash >= 0 ? key.slice(0, slash) : key;
				var bucket = groups[model] || (groups[model] = { name: model, tokens: 0, calls: 0, providers: [] });
				bucket.tokens += (models[k].tokens.total || 0) + (props.tokenMode === "all" ? (models[k].tokens.cacheRead || 0) : 0);
				bucket.calls += models[k].calls || 0;
				if (bucket.providers.indexOf(provider) < 0) bucket.providers.push(provider);
			});
			var entries = Object.keys(groups).map(function (k) { return groups[k]; })
				.sort(function (a, b) { return b.tokens - a.tokens; });
			var total = 0;
			for (var i = 0; i < entries.length; i++) total += entries[i].tokens;
			if (entries.length === 0 || total === 0) return createElement("div", { className: "dshua-rankEmpty" }, t("rank.empty"));
			var top = entries.slice(0, 6);
			var palette = ["#4f6ef7", "#3fbf8a", "#e8a04f", "#c46bd8", "#5aa8e8", "#7a8698"];
			var segs = top.map(function (e, i) {
				var pct = (e.tokens / total) * 100;
				return createElement("div", {
					key: e.name, className: "dshua-mixSeg",
					style: { width: pct + "%", background: palette[i % palette.length] },
					title: e.name + " · " + fmtPct(pct) + " · " + fmtTokens(e.tokens),
				});
			});
			var rows = top.map(function (e, i) {
				// Grouped by real model name (everything after the last "/"); the
				// provider list is kept for hover only, never shown inline.
				var prov = e.providers.length > 1 ? e.providers.join("+") : (e.providers[0] || "");
				return createElement(LegendRow, {
					key: e.name, name: e.name, nameTitle: prov ? e.name + " · " + prov : e.name, color: palette[i % palette.length],
					pct: (e.tokens / total) * 100, value: fmtTokens(e.tokens) + " · " + fmtInt(e.calls) + " " + t("models.calls"),
				});
			});
			if (entries.length > top.length) {
				var rest = entries.slice(top.length).reduce(function (a, b) { return a + b.tokens; }, 0);
				rows.push(createElement(LegendRow, { key: "rest", name: "…", color: palette[6], pct: (rest / total) * 100, value: fmtTokens(rest) }));
			}
			return createElement("div", null,
				createElement("div", { className: "dshua-mixRow" }, segs),
				createElement("div", { className: "dshua-legend" }, rows),
			);
		}

		/**
		 * Token mix — new-token convention: the stacked bar shows input +
		 * output (+ cache writes), while cache-hit reads are reported as a
		 * separate legend line (they dominate raw sums in long sessions).
		 */
		function TokenMix(props) {
			var tokens = props.tokens;
			var t = props.t;
			var freshInput = (tokens.input || 0) + (tokens.cacheWrite || 0);
			var output = tokens.output || 0;
			var cacheRead = tokens.cacheRead || 0;
			var reasoning = tokens.reasoning || 0;
			// All percentages use the same denominator as the headline.
			var total = freshInput + output + cacheRead || 1;
			var billedInput = freshInput + cacheRead;
			var segs = [
				{ name: t("mix.input"), color: "#4f6ef7", value: freshInput },
				{ name: t("mix.output"), color: "#e8a04f", value: output },
				{ name: t("mix.cacheHit"), color: "#5f7d7a", value: cacheRead },
			].filter(function (e) { return e.value > 0; });
			if (segs.length === 0) return createElement("div", { className: "dshua-rankEmpty" }, t("rank.empty"));
			var bar = segs.map(function (e) {
				return createElement("div", {
					key: e.name, className: "dshua-mixSeg",
					style: { width: (e.value / total) * 100 + "%", background: e.color },
					title: e.name + " · " + fmtTokens(e.value),
				});
			});
			var rows = segs.map(function (e) {
				return createElement(LegendRow, {
					key: e.name, name: e.name, color: e.color,
					pct: (e.value / total) * 100,
					value: fmtTokens(e.value),
				});
			});
			if (cacheRead > 0) rows.push(createElement("div", {
				key: "cache-input-note", className: "dshua-hint",
			}, t("stat.cacheRate") + ": " + fmtPct(billedInput > 0 ? 100 * cacheRead / billedInput : 0) + " " + t("mix.inputRaw")));
			if (reasoning > 0) rows.push(createElement(LegendRow, {
				key: "reasoning", name: t("mix.reasoning"), color: "#c46bd8",
				pct: output > 0 ? (reasoning / output) * 100 : 0,
				value: fmtTokens(reasoning) + " (" + fmtPct(output > 0 ? (reasoning / output) * 100 : 0) + " " + t("mix.output") + ")",
			}));
			return createElement("div", null,
				createElement("div", { className: "dshua-mixRow" }, bar),
				createElement("div", { className: "dshua-legend" }, rows),
			);
		}

		/** Insight card grid. */
		function Insights(props) {
			var ins = props.insights;
			var t = props.t;
			var locale = props.locale;

			function card(label, value, sub) {
				return createElement("div", { className: "dshua-card dshua-insight", key: label },
					createElement("div", { className: "dshua-insightLabel" }, label),
					createElement("div", { className: "dshua-insightValue", title: value }, value),
					sub ? createElement("div", { className: "dshua-insightSub", title: sub }, sub) : null,
				);
			}

			var cards = [];
			if (ins.peakDay) cards.push(card(t("insight.peakDay"), fmtDay(ins.peakDay.day, locale), fmtTokens(ins.peakDay.tokens) + " " + t("heat.dayTokens") + " · " + fmtInt(ins.peakDay.turns) + " " + t("heat.dayTurns")));
			if (ins.longestStreakDays > 0) cards.push(card(t("insight.longestStreak"), fmtInt(ins.longestStreakDays) + " " + t("insight.days"), ins.longestStreakStart + " → " + ins.longestStreakEnd));
			cards.push(card(t("insight.avgTokens"), fmtTokens(ins.avgTokensPerSession), t("stat.sessions") + " " + fmtInt(ins.sessionsCount ?? 0)));
			cards.push(card(t("insight.avgSteps"), (ins.avgStepsPerTurn || 0).toFixed(2), t("insight.steps")));
			if (ins.topModel) cards.push(card(t("insight.topModel"), shortModel(ins.topModel.name), fmtTokens(ins.topModel.tokens)));
			cards.push(card(t("insight.cacheShare"), fmtPct(ins.cacheShareOfInput), t("mix.input")));
			cards.push(card(t("insight.reasoningShare"), fmtPct(ins.reasoningShare), t("mix.output")));
			if (ins.topTool) cards.push(card(t("insight.topTool"), ins.topTool.name, fmtInt(ins.topTool.count) + " " + t("rank.times")));
			if (ins.topSkill) cards.push(card(t("insight.topSkill"), ins.topSkill.name, fmtInt(ins.topSkill.count) + " " + t("rank.times")));
			cards.push(card(t("insight.pluginCalls"), fmtInt(ins.pluginCalls ?? 0), ""));
			cards.push(card(t("insight.subagents"), fmtInt(ins.subagentSessions ?? 0), ""));
			if (ins.busyHour) cards.push(card(t("insight.busyHour"), String(ins.busyHour.name) + t("insight.hour"), ""));
			if (ins.longestSession) cards.push(card(t("insight.longestSession"), fmtDur(ins.longestSession.ms), fmtTokens(ins.longestSession.tokens) + " " + t("heat.dayTokens")));

			return createElement("div", { className: "dshua-insights" }, cards);
		}

		/** Single fused dashboard layout: stats + heatmap + trend + mix + insights. */
		function DashboardBody(props) {
			var data = props.data;
			var t = props.t;
			var locale = props.locale;
			var period = props.period;
			var trendMode = props.trendMode;
			var setTrendMode = props.setTrendMode;
			var tokenMode = props.tokenMode;
			var setTokenMode = props.setTokenMode;

			var periodDays = useMemo(function () {
				if (period === "all") return data.days || {};
				var cutoff;
				if (period === "today") {
					var d0 = new Date();
					d0.setHours(0, 0, 0, 0);
					cutoff = d0.getTime();
				} else if (period === "24h") {
					cutoff = Date.now() - 24 * 3600000;
				} else {
					cutoff = periodCutoffMs(period);
				}
				var out = {};
				Object.keys(data.days || {}).forEach(function (k) {
					if (dayOf(k).getTime() >= cutoff) out[k] = data.days[k];
				});
				return out;
			}, [data.days, period]);

			var ins = data.insights || {};
			var tokens = data.tokens || {};
			var grandTotal = ins.grandTotal || tokens.total || 0;
			var rawInput = ins.rawInput || tokens.input || 0;
			// "today" / "24h" show the trend AND headline by absolute HOUR (raw
			// tokens incl. cache hits). "24h" = the rolling last 24 hours
			// (e.g. now 17:00 → yesterday 17:00); "today" = local midnight → now.
			var isHourly = period === "today" || period === "24h";
			var hourlyCutoff = useMemo(function () {
				if (!isHourly) return 0;
				if (period === "today") {
					var d0 = new Date();
					d0.setHours(0, 0, 0, 0);
					return d0.getTime();
				}
				return Date.now() - 24 * 3600000;
			}, [period, isHourly]);
			var hourlyData = useMemo(function () {
				if (!isHourly) return null;
				var out = {};
				Object.keys(data.hourly || {}).forEach(function (hk) {
					var t0 = Date.parse(hk.replace(/-(\d{2})$/, "T$1:00:00"));
					if (!isNaN(t0) && t0 >= hourlyCutoff) out[hk] = data.hourly[hk];
				});
				return out;
			}, [data.hourly, period, isHourly, hourlyCutoff]);
			var hourlySplit = useMemo(function () {
				if (!isHourly) return null;
				var outMap = data.hourlyOutput || {}, newMap = data.hourlyNew || {};
				var out = { raw: 0, out: 0, newT: 0 };
				Object.keys(hourlyData || {}).forEach(function (hk) {
					out.raw += hourlyData[hk] || 0;
					out.out += outMap[hk] || 0;
					out.newT += newMap[hk] || 0;
				});
				return out;
			}, [hourlyData, data.hourlyOutput, data.hourlyNew, isHourly]);
			// Period-filtered token totals so the headline follows the selected
			// range ("all" keeps the all-time figures from insights/tokens).
			var periodTokens = useMemo(function () {
				if (period === "all") return null;
				if (isHourly) {
					var h = hourlySplit || { raw: 0, out: 0, newT: 0 };
					return { grandTotal: h.raw, rawInput: h.raw - h.out, output: h.out, cacheRead: h.raw - h.newT };
				}
				var grand = 0, newT = 0, out = 0;
				Object.keys(periodDays || {}).forEach(function (k) {
					var c = periodDays[k] || {};
					grand += c.tokensRaw || c.tokens || 0;
					newT += c.tokens || 0;
					out += c.output || 0;
				});
				return { grandTotal: grand, rawInput: grand - out, output: out, cacheRead: grand - newT };
			}, [period, isHourly, hourlySplit, periodDays]);
			// Period-filtered token mix for the "Token 构成" chart ("all" keeps
			// the all-time figures). Reasoning is only tracked all-time, so it
			// shows for "all" only; hour views derive input/output/cacheRead
			// from the absolute-hour buckets, day views from the day cells.
			var mixTokens = useMemo(function () {
				if (period === "all") return tokens;
				if (isHourly) {
					var h = hourlySplit || { raw: 0, out: 0, newT: 0 };
					return { input: h.newT - h.out, output: h.out, cacheRead: h.raw - h.newT, cacheWrite: 0, reasoning: 0, total: h.newT };
				}
				var t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
				Object.keys(periodDays || {}).forEach(function (k) {
					var c = periodDays[k] || {};
					var newT = c.tokens || 0;
					t.total += newT;
					t.output += c.output || 0;
					t.cacheRead += (c.tokensRaw || c.tokens || 0) - newT;
				});
				t.input = t.total - t.output;
				return t;
			}, [period, isHourly, hourlySplit, periodDays, tokens]);
			// Filter the counter cards by the same day/hour window as tokens.
			var periodActivity = useMemo(function () {
				if (period === "all") return {
					sessions: data.sessions || 0, subagentSessions: data.subagentSessions || 0,
					turns: data.turns || 0, steps: data.steps || 0, toolCalls: data.toolCalls || 0,
					skillCalls: data.skillCalls || 0, pluginCalls: data.pluginCalls || 0,
				};
				var out = { sessions: 0, subagentSessions: 0, turns: 0, steps: 0,
					toolCalls: 0, skillCalls: 0, pluginCalls: 0 };
				var cells = isHourly ? data.hourlyActivity || {} : periodDays;
				Object.keys(cells || {}).forEach(function (key) {
					if (isHourly && Date.parse(key.replace(/-(\d{2})$/, "T$1:00:00")) < hourlyCutoff) return;
					var cell = cells[key] || {};
					Object.keys(out).forEach(function (field) { out[field] += cell[field] || 0; });
				});
				return out;
			}, [period, data, periodDays, isHourly, hourlyCutoff]);

			// Period-filtered per-model totals for the "模型分布" chart: the host
			// records per-model per-day buckets, summed here over the range.
			// Falls back to the all-time list while the running host still lacks
			// the day buckets (pre-restart), so the chart never shows empty.
			var periodModels = useMemo(function () {
				var models = data.models || {};
				if (period === "all") return models;
				var cutoff = periodCutoffMs(period);
				var out = {};
				Object.keys(models).forEach(function (mk) {
					var m = models[mk], newT = 0, raw = 0, output = 0, calls = 0;
					if (isHourly) {
						Object.keys(m.hourlyTokens || {}).forEach(function (hk) {
							if (!Object.prototype.hasOwnProperty.call(hourlyData || {}, hk)) return;
							var cell = m.hourlyTokens[hk];
							newT += cell.newT || 0; raw += cell.raw || 0;
							output += cell.output || 0; calls += cell.calls || 0;
						});
					} else {
						Object.keys(m.dayTokens || {}).forEach(function (dk) {
							if (dayOf(dk).getTime() < cutoff) return;
							newT += m.dayTokens[dk] || 0;
							raw += (m.dayRaw || {})[dk] || 0;
							output += (m.dayOutput || {})[dk] || 0;
							calls += (m.dayCalls || {})[dk] || 0;
						});
					}
					if (newT <= 0 && raw <= 0) return;
					out[mk] = {
						calls: calls,
						tokens: { input: newT - output, output: output,
							cacheRead: raw - newT, cacheWrite: 0, reasoning: 0, total: newT },
					};
				});
				return out;
			}, [data.models, period, isHourly, hourlyData]);

			var cardTokens = periodTokens || { grandTotal: grandTotal, rawInput: rawInput, output: tokens.output, cacheRead: tokens.cacheRead || 0 };
			var topCards = [
				createElement(StatCard, { key: "tokens", wide: true, label: period === "all" ? t("stat.tokensGrand") : t("stat.tokensPeriod"), value: fmtTokens(cardTokens.grandTotal), sub: t("mix.input") + " " + fmtTokens(cardTokens.rawInput - cardTokens.cacheRead) + " / " + t("mix.output") + " " + fmtTokens(cardTokens.output) + " · " + t("mix.cacheHit") + " " + fmtTokens(cardTokens.cacheRead) }),
				createElement(StatCard, { key: "cacheRate", label: t("stat.cacheRate"), value: fmtPct(cardTokens.rawInput > 0 ? (cardTokens.cacheRead / cardTokens.rawInput) * 100 : 0), sub: t("mix.cacheHit") + " " + fmtTokens(cardTokens.cacheRead) }),
				createElement(StatCard, { key: "sessions", label: t("stat.sessions"), value: fmtInt(periodActivity.sessions), sub: periodActivity.subagentSessions > 0 ? "subagent " + fmtInt(periodActivity.subagentSessions) : undefined }),
				createElement(StatCard, { key: "turns", label: t("stat.turns"), value: fmtInt(periodActivity.turns), sub: fmtInt(periodActivity.steps) + " steps" }),
				createElement(StatCard, { key: "calls", label: t("stat.toolCalls"), value: fmtInt(periodActivity.toolCalls), sub: "skills " + fmtInt(periodActivity.skillCalls) + " · plugins " + fmtInt(periodActivity.pluginCalls) }),
			];

			return createElement("div", null,
				createElement("div", { className: "dshua-strip" }, topCards),
				// Heatmap alone on its own full row — no scrollbar.
				createElement(Section, { title: t("heat.title"), hint: t("heat.hint"), margin: true },
					createElement(Heatmap, { days: data.days || {}, t: t, locale: locale }),
				),
				createElement(Section, { title: t("trend.title"), margin: true },
					isHourly
						? createElement(TrendBars, { hours: hourlyData || {}, t: t, locale: locale })
						: createElement("div", null,
							createElement("div", { className: "dshua-pills", style: { marginBottom: 10 } },
								createElement("button", { className: "dshua-pill" + (trendMode === "daily" ? " dshua-pillOn" : ""), onClick: function () { setTrendMode("daily"); } }, t("trend.daily")),
								createElement("button", { className: "dshua-pill" + (trendMode === "weekly" ? " dshua-pillOn" : ""), onClick: function () { setTrendMode("weekly"); } }, t("trend.weekly")),
							),
							createElement(TrendBars, { days: periodDays, mode: trendMode, t: t, locale: locale }),
						),
				),
				createElement("div", { className: "dshua-grid" },
					createElement(Section, { title: t("mix.title") }, createElement(TokenMix, { tokens: mixTokens, t: t })),
					createElement(Section, { title: t("models.title") },
					createElement("div", { className: "dshua-pills", style: { marginBottom: 10 } },
						["all", "fresh"].map(function (mode) {
							return createElement("button", {
								key: mode, className: "dshua-pill" + (tokenMode === mode ? " dshua-pillOn" : ""),
								onClick: function () { setTokenMode(mode); },
							}, t("models." + mode));
						}),
					),
					createElement(ModelShare, { models: periodModels, tokenMode: tokenMode, t: t }),
				),
				),
				createElement(Section, { title: t("insights.title") },
					createElement(Insights, { insights: Object.assign({ sessionsCount: data.sessions }, ins), t: t, locale: locale }),
				),
			);
		}

		/** Root overlay: null when closed, full-screen dashboard when open. */
		function Overlay() {
			var open = useSyncExternalStore(subscribeOpen, getOpen);
			var t = useMemo(function () { return bindT(); }, []);
			var locale = activeLocale();

			var [data, setData] = useState(null);
			var [error, setError] = useState(null);
			var [errorBanner, setErrorBanner] = useState(null);
			var [loading, setLoading] = useState(false);
			var [refreshing, setRefreshing] = useState(false);
			var [updatedAt, setUpdatedAt] = useState(null);
			// User-picked period / trend mode, persisted locally so the last
			// selection is restored on the next open.
			var [period, setPeriodRaw] = useState(function () {
				try { var v = localStorage.getItem("dshua.period.v1"); if (v !== null) return v; } catch (e) { /* storage unavailable */ }
				return 30;
			});
			var [tokenMode, setTokenModeRaw] = useState(function () {
				try { return localStorage.getItem("dshua.modelTokenMode.v1") === "fresh" ? "fresh" : "all"; }
				catch (e) { return "all"; }
			});
			function setTokenMode(mode) {
				setTokenModeRaw(mode);
				try { localStorage.setItem("dshua.modelTokenMode.v1", mode); } catch (e) { /* unavailable */ }
			}
			var [trendMode, setTrendModeRaw] = useState(function () {
				try { var v = localStorage.getItem("dshua.trendMode.v1"); if (v === "daily" || v === "weekly") return v; } catch (e) { /* storage unavailable */ }
				return "daily";
			});
			function setPeriod(p) {
				setPeriodRaw(p);
				try { localStorage.setItem("dshua.period.v1", String(p)); } catch (e) { /* storage unavailable */ }
			}
			function setTrendMode(m) {
				setTrendModeRaw(m);
				try { localStorage.setItem("dshua.trendMode.v1", m); } catch (e) { /* storage unavailable */ }
			}
			var [nonce, setNonce] = useState(0);

			/**
			 * Fetch stats. `silent` = manual refresh with existing data: failures
			 * surface as a transient banner instead of replacing the dashboard.
			 * `force` = full rescan on the host (default incremental).
			 */
			var load = useCallback(function (force, silent) {
				setLoading(true);
				fetchStats(force).then(function (payload) {
					setData(payload);
					setUpdatedAt(payload.generatedAt || Date.now());
					setLoading(false);
					setRefreshing(false);
					// The host serves the cached snapshot instantly and finishes
					// the scan in the background — re-poll while a scan is still
					// pending so the first-open dashboard fills itself in.
					if (!force && payload.scan && payload.scan.pending) {
						setTimeout(function () { setRefreshing(true); load(false, true); }, 4000);
					}
				}).catch(function (err) {
					setLoading(false);
					setRefreshing(false);
					if (silent) {
						setErrorBanner(String((err && err.message) || err));
						setTimeout(function () { setErrorBanner(null); }, 4000);
					} else {
						setError(err);
					}
				});
			}, []);

			useEffect(function () {
				if (open && data === null && error === null) load(false, false);
			}, [open, data, error, load, nonce]);

			useEffect(function () {
				if (!open) return undefined;
				function onKey(e) {
					if (e.key === "Escape") setOpen(false);
				}
				window.addEventListener("keydown", onKey);
				return function () { window.removeEventListener("keydown", onKey); };
			}, [open]);

			if (!open) return null;

			var header = createElement("div", { className: "dshua-head" },
				createElement("div", null,
					createElement("div", { className: "dshua-title" }, t("title")),
					createElement("div", { className: "dshua-subtitle" }, t("subtitle")),
					createElement("div", { className: "dshua-updated" },
						t("updated.at") + " " + (updatedAt ? new Date(updatedAt).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour12: false }) : "—"),
					),
				),
				createElement("div", { className: "dshua-spacer" }),
				createElement("div", { className: "dshua-pills" },
					["today", "24h", 7, 30, 90, "all"].map(function (p) {
						var key = String(p);
						return createElement("button", {
							key: key,
							className: "dshua-pill" + (String(period) === key ? " dshua-pillOn" : ""),
							onClick: function () { setPeriod(p); },
						}, t("period." + key));
					}),
				),
				createElement("button", {
					className: "dshua-btn" + (refreshing ? " dshua-btnBusy" : ""),
					disabled: refreshing || (loading && data === null),
					onClick: function () {
						if (refreshing) return;
						setRefreshing(true);
						setErrorBanner(null);
						load(false, true);
					},
					title: t("refresh"),
				}, refreshing ? t("refresh.busy") : t("refresh")),
				createElement("button", { className: "dshua-btn dshua-close", onClick: function () { setOpen(false); }, "aria-label": t("close") },
					createElement("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" },
						createElement("path", { d: "M4 4l8 8M12 4l-8 8" }),
					),
				),
			);

			var body;
			if (loading && data === null) {
				// Transient only — the host serves the cached snapshot instantly,
				// so this flash lasts one network round trip.
				body = createElement("div", { className: "dshua-loading" },
					createElement("div", { className: "dshua-spinner" }),
					createElement("div", null, t("loading")),
				);
			} else if (error && data === null) {
				body = createElement("div", { className: "dshua-center" },
					createElement("div", { className: "dshua-emptyTitle" }, t("error.title")),
					createElement("div", { className: "dshua-emptyDesc" }, t("error.desc")),
					createElement("button", { className: "dshua-btn", onClick: function () { load(false); } }, t("error.retry")),
				);
			} else if (data && data.sessions === 0 && (!data.cache || data.cache.built)) {
				body = createElement("div", { className: "dshua-center" },
					createElement("div", { className: "dshua-emptyTitle" }, t("empty.title")),
					createElement("div", { className: "dshua-emptyDesc" }, t("empty.desc")),
				);
			} else if (data) {
				body = createElement("div", null,
					errorBanner ? createElement("div", { className: "dshua-banner" }, t("refresh.failed")) : null,
					createElement(DashboardBody, { data: data, t: t, locale: locale, period: period, trendMode: trendMode, setTrendMode: setTrendMode,
					tokenMode: tokenMode, setTokenMode: setTokenMode }),
					createElement("div", { className: "dshua-footer" }, t("footer.note")),
				);
			}

			return createElement("div", { className: "dshua-root", onClick: function () { setOpen(false); } },
				createElement("div", {
					className: "dshua-shell",
					onClick: function (e) { e.stopPropagation(); },
				},
					header,
					createElement("div", { className: "dshua-body" }, body),
				),
			);
		}

		/** Sidebar footer action entry (beside Settings) — sized to match Settings. */
		function SidebarEntry(props) {
			var open = useSyncExternalStore(subscribeOpen, getOpen);
			var t = useMemo(function () { return bindT(); }, []);
			var icon = createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" },
				createElement("rect", { x: 2, y: 2.5, width: 12, height: 11, rx: 2 }),
				createElement("path", { d: "M2.5 6h11" }),
				createElement("path", { d: "M4.5 9h3M4.5 11h2" }),
			);
			return createElement("button", {
				className: "dshua-entry" + (open ? " dshua-entryOn" : ""),
				type: "button",
				onClick: function () { setOpen(!open); },
				title: t("sidebar.tooltip"),
				"aria-label": t("sidebar.label"),
			},
				createElement("span", { className: "dshua-entryIcon" }, icon),
				props.wide ? createElement("span", { className: "dshua-entryLabel" }, t("sidebar.label")) : null,
			);
		}

		// ------------------------------------------------------------------
		// translate binding (assigned in apply; stable per namespace)
		// ------------------------------------------------------------------
		var boundT = function (key) {
			var dict = STR[activeLocale()] || STR.en;
			return dict[key] || key;
		};
		function bindT() {
			return boundT;
		}

		// ------------------------------------------------------------------
		// plugin contract
		// ------------------------------------------------------------------
		exports.inject = ["slots", "locale"];

		exports.apply = function (ctx) {
			// CSS (claimed by the module loader for HMR bookkeeping). Guarded:
			// a CSS hiccup must never prevent the slot registrations.
			try {
				if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null) {
					var tag = document.createElement("style");
					tag.dataset.plugin = "@local/dsh-usage-analytics";
					tag.dataset.pluginCss = CSS_TAG_ID;
					tag.textContent = CSS;
					document.head.appendChild(tag);
				}
			} catch (error) {
				console.warn("[dsh-usage-analytics] css inject failed:", error);
			}

			try {
				ctx.locale.register(NS, STR);
				if (typeof ctx.locale.bind === "function") boundT = ctx.locale.bind(NS);
			} catch (error) {
				console.warn("[dsh-usage-analytics] locale register failed:", error);
			}

			// Each seat registers independently — one failure must not drop the
			// other (the footer entry and the overlay both matter).
			try {
				ctx.slots.inject("sidebar.footer.action", function () {
					return ctx.slots.register(
						{ name: "sidebar.footer.action", id: "usage-analytics", order: 200, label: function () { return boundT("sidebar.label"); } },
						SidebarEntry,
					);
				});
			} catch (error) {
				console.warn("[dsh-usage-analytics] footer entry failed:", error);
			}
			try {
				ctx.slots.inject("shell.overlay", function () {
					return ctx.slots.register(
						{ name: "shell.overlay", id: "usage-analytics-overlay", order: 200, label: function () { return boundT("sidebar.label"); } },
						Overlay,
					);
				});
			} catch (error) {
				console.warn("[dsh-usage-analytics] overlay entry failed:", error);
			}
		};

		return module.exports;
	},
});
