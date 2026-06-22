# Next.js Frontend — Full Mirror Design

**Date:** 2026-06-18
**Status:** Approved (pending user review of this spec)
**Scope:** Build a Next.js web frontend that mirrors all backend analytics features, while keeping CLI and Telegram bot as alternative interfaces.

---

## 1. Goal

Transform the project from a backend-only toolkit (CLI + Telegram bot + SQLite) into a multi-interface personal analytics platform by adding a Next.js web frontend. The web UI achieves **feature parity** with the existing bot and CLI — every analytics function, every report, every data operation accessible from the browser.

**Multi-interface value:** User can log from the phone (Telegram bot), analyze from the laptop (web UI), and script from the terminal (CLI), all hitting the same Turso database.

---

## 2. Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Vercel (frontend) + Turso (DB, free tier 9GB) | $0 cost, accessible from any device. Turso is SQLite-compatible so Drizzle schema is unchanged. |
| Scope | Full Mirror — all 7 backend analytics modules in web UI | Maximum completeness. Backend already built; frontend is mostly wiring + UI. |
| Layout | Single Page + 7 flat tabs | Header with tabs, more content space than sidebar layout. |
| Theme | Tokyo Night (dark) + Catppuccin Latte (light), toggleable | User preference. Heatmap colors follow theme accent. |
| Data layer | Next.js Server Actions | Zero boilerplate, native to Next.js, no separate API layer needed. |
| State | React built-in (useState + URL params + Server Components) | Zero dependencies. Data is always fresh from server. |
| Charts | Custom SVG heatmap + Recharts for time-series/correlations | Heatmap is simple enough for raw SVG (per design doc). Analytics charts use a library. |
| Bot/CLI | Unchanged in features, but DB driver swapped to connect Turso | Must share the same DB as the frontend. |

---

## 3. Architecture

```
┌─ Vercel (serverless) ────────────────────────────┐
│  Next.js App Router                               │
│  ├── Server Components (data fetching)            │
│  ├── Server Actions (mutations)                   │
│  ├── Client Components (interactivity)            │
│  └── Static assets (SVG heatmap, Tailwind CSS)    │
└────────────────┬──────────────────────────────────┘
                 │ libSQL client (HTTP)
                 ▼
┌─ Turso (SQLite hosting, free tier 9GB) ───────────┐
│  Same Drizzle schema as current better-sqlite3    │
│  Driver swap only — query code unchanged          │
└───────────────────────────────────────────────────┘

┌─ VPS / Laptop (always-on) ────────────────────────┐
│  Telegram bot (telegraf)  ──► Turso (same DB)     │
│  CLI (tsx)                ──► Turso (same DB)     │
│  Both swap driver from better-sqlite3 to libSQL   │
└───────────────────────────────────────────────────┘
```

**Key migration:** Replace `better-sqlite3` with `@libsql/client` across the codebase. Drizzle ORM supports both drivers — schema is identical, query syntax is identical, only the connection initialization and the sync→async nature differ. All `.all()` / `.get()` / `.run()` calls become `await ...all()` etc.

---

## 4. Page Structure & Routing

**7 flat tabs** as Next.js App Router routes:

```
/                  → redirect to /overview
/overview          → stat cards + QuickLog + mini heatmap + mini trends + recent events
/heatmap           → full heatmap per domain (domain selector; default view = last 90 days, with a toggle for full-year view)
/analytics         → time-series chart + burnout gauge + session patterns
/correlations      → cross-domain correlation matrix + significance indicators
/anomalies         → z-score outliers + low-effort streaks + day-of-week deviations
/review            → AI weekly review (LLM-generated) + snapshot cards per domain
/data              → import (upload JSON/CSV) + export (download JSON/CSV)
```

### Header bar (persistent across all pages)

```
[Life Quant] [Overview][Heatmap][Analytics][Correlations][Anomalies][Review][Data] [☀/🌙] [Domain: ▾]
```

- **Tab navigation** — links to the 7 routes, active tab highlighted.
- **Theme toggle** — sun/moon icon, switches Tokyo Night ↔ Catppuccin Latte.
- **Domain dropdown** — global filter. Selecting "Sleep" makes every tab show Sleep data. Default: "All domains" — meaning the analytics run per-domain and results are displayed side-by-side or summed as appropriate (e.g., Overview stat cards show aggregate event count; Heatmap shows the selected domain only since a multi-domain heatmap is not meaningful; Anomalies lists per-domain results stacked). When "All domains" is active, the Heatmap tab prompts the user to pick a specific domain.

### Overview tab (landing page)

Landing after redirect from `/`. Highest-density page:

- **4 stat cards:** Consistency score, Burnout risk, Anomaly count (last 30d), Events today.
- **QuickLog widget:** Domain selector + value input + optional note + submit button.
- **Mini heatmap:** Last 7 days, active domain.
- **Mini trend chart:** Last 30 days line chart, active domain.
- **Recent events list:** 5 most recent events with delete buttons.

### QuickLog access

QuickLog appears in two places:
1. As a widget on the Overview tab.
2. As a **floating action button (FAB)** in the bottom-right corner of every tab — opens a modal form. So the user can log from anywhere without leaving the current view.

---

## 5. Components & Dependencies

### New dependencies

| Package | Purpose |
|---|---|
| `next` | Framework (App Router, Server Components, Server Actions) |
| `react`, `react-dom` | UI runtime |
| `@libsql/client` | Turso DB driver (replaces `better-sqlite3`) |
| `tailwindcss` v4 | Styling |
| `recharts` | Time-series charts, correlation matrix, session patterns |
| `next-themes` | Theme switcher (dark/light + system preference + persistence) |

### Explicitly NOT added (YAGNI)

- ~~Zustand~~ — React built-in state is sufficient.
- ~~tRPC~~ — Server Actions cover RPC needs.
- ~~Vercel AI SDK~~ — LLM calls stay as raw `fetch()` per existing `review.ts` pattern.
- ~~Commander.js~~ — CLI already runs via `tsx` directly.

### Removals

- `better-sqlite3` — replaced by `@libsql/client` (Turso is not filesystem-based).

### Component hierarchy

```
app/layout.tsx (root)
├── ThemeProvider (next-themes wrapper)
├── Header (tabs + domain dropdown + theme toggle)  [client]
├── QuickLogFab (floating action button, all pages)  [client]
└── {children} (per-tab Server Component)

app/(tabs)/overview/page.tsx       [server]
app/(tabs)/heatmap/page.tsx        [server]
app/(tabs)/analytics/page.tsx      [server]
app/(tabs)/correlations/page.tsx   [server]
app/(tabs)/anomalies/page.tsx      [server]
app/(tabs)/review/page.tsx         [server]
app/(tabs)/data/page.tsx           [server]

components/
├── StatCard.tsx           — metric + label + trend indicator  [client]
├── HeatmapGrid.tsx        — SVG rects, hover tooltip, day-of-week labels  [client]
├── TrendChart.tsx         — recharts LineChart, 30/90 day range  [client]
├── CorrelationMatrix.tsx  — recharts heatmap + legend  [client]
├── AnomalyList.tsx        — grouped by type, severity badges  [client]
├── BurnoutGauge.tsx       — risk level with color-coded badge  [client]
├── QuickLogForm.tsx       — domain selector + value input + note + submit  [client]
├── EventTable.tsx         — recent events with delete action  [client]
└── ImportExport.tsx       — upload form + download buttons  [client]

app/(actions)/
├── events.ts          — logEvent, deleteEvent, getRecentEvents
├── domains.ts         — listDomains, getActiveDomain
├── analytics.ts       — wrappers around existing analytics functions
└── import-export.ts   — exportAll, importFromFile, CSV variants
```

### Theme implementation

- CSS custom properties in `app/globals.css` under `:root` (light = Catppuccin Latte) and `[data-theme="dark"]` (dark = Tokyo Night).
- `next-themes` handles toggle, persists to `localStorage`, respects `prefers-color-scheme` on first visit.
- Tailwind v4 `@theme` directive maps semantic color names to the CSS variables.
- Heatmap colors are theme-aware: Tokyo Night uses teal/blue ramp (#1e2030 → #41a6b5), Catppuccin Latte uses blue/green ramp (#bcc0cc → #179299). Both ramps have 5 intensity levels.

---

## 6. DB Migration & API Layer

### Driver swap (better-sqlite3 → @libsql/client)

Files affected:

- `src/lib/db/index.ts` — connection initialization (file path → Turso URL + auth token).
- `src/lib/db/schema.ts` — **unchanged** (Drizzle schema is driver-agnostic).
- All files calling `.all()`, `.get()`, `.run()` — add `await` (sync → async).
- `src/bot/index.ts` — all handlers become async (most already are).
- `src/cli/log.ts`, `src/cli/data.ts` — wrapper functions become async.
- Analytics modules — DB-calling functions become async (most already are: `generateSnapshots`, `computeAllCorrelations`, `detectAnomalies`, `computeBurnoutRisk`).
- Test files using a real SQLite connection — switch to in-memory libSQL or mock the DB layer.

### Turso setup steps

1. Create Turso database (free tier — 9GB, 1 billion row reads/month).
2. Configure `TURSO_URL` and `TURSO_AUTH_TOKEN` in `.env` (update `.env.example`).
3. Push schema via `drizzle-kit push`.
4. Migrate existing data: export from local SQLite (existing `exportToFile`) → import to Turso (modified `importFromFile` that targets the Turso connection).

### Server Actions pattern

```typescript
// app/(actions)/events.ts
"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";

export async function logEvent(domainId: string, value: number, note?: string) {
  await db.insert(schema.events).values({
    id: crypto.randomUUID(),
    domainId,
    value,
    note,
    timestamp: new Date().toISOString(),
    source: "web",
  });
  revalidatePath("/"); // refresh Server Component cache
  return { success: true };
}

export async function getRecentEvents(limit = 10) {
  return db.select()
    .from(schema.events)
    .orderBy(desc(schema.events.timestamp))
    .limit(limit)
    .all();
}
```

Actions are grouped by domain: `events.ts`, `domains.ts`, `analytics.ts`, `import-export.ts`.

**Error handling:** Actions return `{ success: true, data }` or `{ success: false, error: string }`. Client components manage loading and error states.

---

## 7. Implementation Phases

Phased execution — each phase ends in a working, demonstrable state. Total estimated effort: ~10-12 days.

| Phase | Scope | Definition of done |
|---|---|---|
| **0. Foundation** | Install Next.js + Tailwind v4 + recharts + next-themes. Turso driver swap. Theme system (Tokyo Night + Catppuccin Latte). Empty layout with header + theme toggle. | `npm run dev` runs, blank themed page renders, DB connects to Turso, all 130 existing tests still pass. |
| **1. Core CRUD** | Layout + Header (7 tabs) + Overview tab + QuickLog (widget + FAB) + recent events list + stat cards. | User can log an event from web and see it appear. Stat cards show real data. |
| **2. Heatmap + Trends** | Heatmap tab (custom SVG grid) + Analytics tab (recharts time-series, BurnoutGauge). | Primary visualizations work. Hover tooltip on heatmap. Burnout risk displayed per domain. |
| **3. Analytics Advanced** | Correlations matrix + Anomalies report + Sessions patterns. | All 7 backend analytics modules now have a web UI equivalent. |
| **4. Review + Data** | AI weekly review page (LLM-generated) + Import/Export UI (JSON + CSV upload/download). | Feature parity with bot + CLI achieved. Full Mirror complete. |

---

## 8. Testing Strategy

- **Existing analytics tests (130)** — must continue to pass after the driver swap. Logic is unchanged; only the DB driver differs. Tests that instantiate a real SQLite connection must switch to in-memory libSQL.
- **Server Actions** — unit test happy path + error path per action. Mock the DB layer or use a test Turso database.
- **Components** — Vitest + Testing Library for key components: `HeatmapGrid` (cell rendering, tooltip), `QuickLogForm` (validation, submit), `BurnoutGauge` (risk classification).
- **Manual smoke test** at the end of each phase: load page, log event, verify it appears.

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Turso free tier rate limits | Medium | Medium | Server Component caching + minimal `revalidatePath` calls. Free tier is generous (1B row reads/month) for personal use. |
| Bot cannot run on Vercel (long-polling) | Certain | Low | Bot stays on VPS/laptop, connects to Turso. Already acknowledged in architecture. |
| libSQL async refactor breaks existing code | Medium | High | TypeScript strict mode + ESLint `require-await` rule. Run full test suite after driver swap before touching UI. |
| Heatmap performance (365+ cells) | Low | Low | SVG with React memoization on cell color computation. Virtualize if needed (per design doc). |
| LLM review requires API key | Low | Low | UI shows clear "Configure LLM_API_KEY" message if missing. Falls back to snapshot-only review. |

---

## 10. Out of Scope

- Authentication / multi-user support (single-user personal dashboard).
- Real-time updates (WebSocket / SSE). Data refreshes on navigation or after mutation via `revalidatePath`.
- Mobile native app (PWA is sufficient).
- Public sharing / social features (explicitly anti-feature per design doc).
- Streak counters, badges, gamification (explicitly anti-feature).

---

## 11. Success Criteria

- [ ] Web UI accessible from any device via Vercel URL.
- [ ] All 7 backend analytics modules have a web UI equivalent (Full Mirror).
- [ ] Data logged from web appears in bot `/today` and CLI `log --list` within seconds.
- [ ] Data logged from bot/CLI appears in web UI on next page load.
- [ ] Theme toggle persists across sessions.
- [ ] All 130+ existing tests pass after driver swap.
- [ ] New component tests for HeatmapGrid, QuickLogForm, BurnoutGauge.
- [ ] Cold start < 1 second on Vercel.
- [ ] Zero data loss when migrating from local SQLite to Turso.
