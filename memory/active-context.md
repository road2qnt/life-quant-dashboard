---
id: active-context
type: context
status: active
created: 2025-01-15
updated: 2026-05-16
tags: [context, active]
token_estimate: 350
---

# Active Context

> **Project:** Life Quant Dashboard
> **Phase:** Backend Complete — All P0/P1/P2 Done
> **Current Focus:** Maintenance

## Project State

- **Repository:** `git@github.com:road2qnt/Project-001-Life-Quant-Dashboard.git`
- **Stack:** TypeScript 5, SQLite (better-sqlite3), Drizzle ORM, Zod, date-fns
- **Entry points:**
  - `npm run bot` — Telegram bot (long-polling, 12 commands)
  - `npm run cli` — CLI logger (positional args + interactive mode)
  - `npm run data` — Data & analytics CLI (export, import, snapshots, correlate, review, sessions, CSV)
  - `npm run seed` — Database seed script
  - `npm run migrate` — Drizzle push migrations
  - `npm test` — Vitest (73 tests)

### What Exists

- ✅ Database schema (domains, events, weekly_snapshots, correlations, agent_memory, config) + migrations + seed
- ✅ Telegram Bot (`@life_quant_logger_bot`) — 12 commands: `/log`, `/today`, `/stats`, `/snapshots`, `/correlate`, `/review`, `/sessions`, `/domains`, `/export`, `/csv`, `/delete`, `/help`, `/start`
- ✅ Inline keyboard for domain selection on bare `/log`
- ✅ CLI Logger (`src/cli/log.ts`) — positional args, interactive mode, --list, --date, --time
- ✅ Analytics engine (`src/lib/analytics/`) — consistency scoring, weekly trends, cognitive drift, cross-domain correlations (Pearson r), weekly snapshots, session analytics, LLM weekly review
- ✅ Data export/import (JSON) — `src/lib/export.ts`, `src/lib/import.ts`, `src/cli/data.ts`
- ✅ Data export/import (CSV) — `src/lib/export-csv.ts`, `src/lib/import-csv.ts`
- ✅ Systemd service — installed as user service, auto-start on boot, auto-restart on crash
- ✅ 73 tests — 7 test files across all modules
- ✅ Memory system scaffolding — updated with every milestone

## Active Decisions

- Events are append-only (immutable log)
- Local-first with SQLite
- Consistency scoring replaces streak counting
- CLI built with tsx (no build step needed)
- Telegram bot uses long-polling (no webhook needed)
- No frontend — all interaction via Telegram Bot and CLI
- Weekly snapshots use upsert (onConflictDoUpdate)
- Correlations computed on-demand, stored in DB
- Inline keyboards reduce friction for mobile logging
- LLM review uses OpenAI-compatible API (configurable via .env)

## Current Priorities

See [current-focus.md](./current-focus.md)

## Risks

- `better-sqlite3` is native — needs build tools on deployment
- LLM review requires LLM_API_KEY in .env (not set by default)
- No backup automation — data export is manual
