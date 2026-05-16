---
id: adr-index
type: index
status: active
created: 2025-01-15
updated: 2026-05-16
tags: [architecture, index]
token_estimate: 60
---

# Architecture Decision Records

## Active ADRs

| ID | Date | Title | Status |
|---|---|---|---|
| ADR-001 | 2025-01-15 | Event-Sourced Data Model | Active |
| ADR-002 | 2025-01-15 | Local-First with SQLite | Active |
| ADR-003 | 2025-01-15 | Consistency Score Over Streaks | Active |
| ADR-004 | 2025-01-15 | SVG-Based Heatmap | **Superseded** |
| ADR-005 | 2025-01-15 | Zustand for State Management | **Superseded** |
| ADR-006 | 2025-05-14 | tsx for CLI Script Execution | Active |
| ADR-007 | 2025-05-14 | Telegram Bot with Long-Polling | Active |

---

---

id: adr-001
type: adr
status: active
created: 2025-01-15
updated: 2026-05-16
tags: [architecture, database, events]
token_estimate: 200

---

## ADR-001: Event-Sourced Data Model

**Context:** Need to store behavioral data in a way that supports retroactive analytics, time-travel queries, and flexible metric computation.

**Decision:** Events are stored as an append-only log. Each event has a domain, timestamp, value, and note. No UPDATEs. DELETE only for undo.

**Rationale:**
- Enables recomputing any metric at any point in time from raw data
- Sync-friendly: merging two databases is UNION ALL + dedup
- Audit trail: every data point has a source and timestamp
- Schema-flexible: adding new metrics doesn't require backfilling

**Alternatives Considered:**
1. [Rejected] State-based (update current value) — loses history, can't compute trends
2. [Rejected] Hybrid (events + materialized views) — too complex for MVP

**Tradeoffs:**
- Storage grows linearly with events (mitigation: SQLite handles millions of rows easily)
- Querying requires aggregation (mitigation: cached weekly snapshots)

---

---

id: adr-002
type: adr
status: active
created: 2025-01-15
updated: 2026-05-16
tags: [architecture, database, infrastructure]
token_estimate: 200

---

## ADR-002: Local-First with SQLite

**Context:** Single developer, single user. Need minimal infrastructure, zero latency, offline capability.

**Decision:** Use SQLite via `better-sqlite3` with Drizzle ORM. No PostgreSQL for MVP.

**Rationale:**
- Zero infrastructure: `npm install` and a file
- Instant backups: `cp data.db backup.db`
- Offline by default
- $0 hosting cost
- Easy migration path to PostgreSQL later (dump/restore)

**Alternatives Considered:**
1. [Rejected] PostgreSQL — requires server, Docker, or cloud. Overkill for single user.
2. [Rejected] IndexedDB in browser — limited query capability, harder to back up

**Tradeoffs:**
- Single-device only (mitigation: file sync via Dropbox or git)
- Native dependency (`better-sqlite3` requires build tools)

---

---

id: adr-003
type: adr
status: active
created: 2025-01-15
updated: 2026-05-16
tags: [architecture, analytics, scoring]
token_estimate: 200

---

## ADR-003: Consistency Score Over Streaks

**Context:** Streak-based gamification rewards showing up over doing quality work. Need a metric that captures both frequency AND intensity.

**Decision:** Primary metric is `consistency = (active_days / total_days) * (avg_value / max_value)`. Range [0, 1].

**Rationale:**
- Penalizes absence (missed days lower the score)
- Penalizes low effort (showing up but doing minimal work)
- Normalized across domains (compare sleep consistency to work consistency)
- Computable in O(n) from raw events

**Alternatives Considered:**
1. [Rejected] Simple streak count — rewards showing up, not quality
2. [Rejected] Binary on/off — loses intensity signal
3. [Rejected] Exponential decay — too complex, hard to explain

**Tradeoffs:**
- Does not weight recent days more heavily (mitigation: add recentWeight param in Phase 2)
- Requires domain max_value to be configured correctly

---

---

id: adr-004
type: adr
status: superseded
created: 2025-01-15
updated: 2026-05-16
tags: [architecture, ui, visualization]
token_estimate: 150

---

## ADR-004: SVG-Based Heatmap (Superseded)

**Context:** Needed a GitHub-style contribution heatmap for the web frontend.

**Decision:** SVG `<rect>` elements for heatmap cells. Not Canvas. Not a third-party chart library.

**Reason for Superseding:** The entire web frontend (including the SVG heatmap) was removed in 2026-05-16 due to bugs in the React/Next.js layer. The project now operates via Telegram Bot and CLI only.

---

---

id: adr-005
type: adr
status: superseded
created: 2025-01-15
updated: 2026-05-16
tags: [architecture, state, frontend]
token_estimate: 150

---

## ADR-005: Zustand for State Management (Superseded)

**Context:** Needed client-side state management for the web frontend.

**Decision:** Use Zustand. Not Redux. Not React Context.

**Reason for Superseding:** The web frontend was removed in 2026-05-16. No client-side state management is needed — all interactions go through the Telegram Bot and CLI.

---

---

id: adr-006
type: adr
status: active
created: 2025-05-14
updated: 2026-05-16
tags: [architecture, cli, tooling]
token_estimate: 150

---

## ADR-006: tsx for CLI Script Execution

**Context:** Need a CLI tool for quick event logging from terminal. Should work without a build/compile step.

**Decision:** Run CLI scripts directly with `npx tsx src/cli/log.ts`. No separate build step. No compiled binary.

**Rationale:**
- Zero build configuration — just write TypeScript and run
- `tsx` startup time is fast enough (< 1s) for a logging command
- Same TypeScript codebase — share types and DB access with other modules
- No dual-compilation (no CJS/ESM issues since tsx handles transpilation)

**Alternatives Considered:**
1. [Rejected] Compiled binary (pkg, esbuild) — adds build step, complicates development
2. [Rejected] Pure Node.js (no TypeScript) — lose type safety
3. [Rejected] Separate package — unnecessary complexity for a single-user tool

**Tradeoffs:**
- Requires `tsx` as a dependency
- Slightly slower than compiled binary (~300ms startup overhead)

---

---

id: adr-007
type: adr
status: active
created: 2025-05-14
updated: 2026-05-16
tags: [architecture, telegram, bot]
token_estimate: 150

---

## ADR-007: Telegram Bot with Long-Polling

**Context:** Need a mobile-friendly way to log events without a web browser. Telegram is the preferred chat platform.

**Decision:** Use `node-telegram-bot-api` with long-polling. Not webhook mode.

**Rationale:**
- No public URL / HTTPS certificate required
- Works behind NAT, firewall, VPN
- Single process, no reverse proxy needed
- `node-telegram-bot-api` is the most mature Node.js Telegram library

**Alternatives Considered:**
1. [Rejected] Webhook — requires public HTTPS URL (not available for local dev)
2. [Rejected] telegraf.js — newer but more complex for simple command handling
3. [Rejected] Raw Telegram API — too low-level, would miss polling logic

**Tradeoffs:**
- Polling adds ~1-2s latency (mitigation: acceptable for a logging tool)
- Must ensure only one bot instance runs (409 Conflict otherwise)
- No auto-restart on crash (mitigation: add systemd service or pm2)
