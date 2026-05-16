---
id: current-focus
type: priorities
status: active
created: 2025-01-15
updated: 2026-05-16
tags: [priorities, focus]
token_estimate: 200
---

# Current Focus

> Project is in a stable, feature-complete state. See completed items below.

## Completed ✅

### P0 — Infrastructure & Data
- ✅ `/stats` command — weekly trend per domain with 8-week avg
- ✅ `/today` command — daily summary with grouped events
- ✅ Systemd service — installed, running, auto-restart on crash, linger enabled
- ✅ Data export (JSON) — CLI + Telegram `/export`
- ✅ Data import (JSON) — CLI with conflict handling and dry-run

### P1 — Analytics Engine
- ✅ Weekly snapshot generation — `generateSnapshots()` stores per-domain weekly consistency scores
- ✅ Cross-domain correlation (Pearson r) — CLI `correlate` + Telegram `/correlate`
- ✅ LLM weekly review — OpenAI-compatible, configurable model/base URL

### P2 — Polish & Tooling
- ✅ CSV export — events, domains, snapshots via CLI + Telegram `/csv`
- ✅ CSV import — events from CSV with domain validation
- ✅ Session analytics — time-of-day + day-of-week patterns via CLI + `/sessions`
- ✅ `/delete` command — undo last event by ID
- ✅ Inline keyboards — domain selection on bare `/log`
- ✅ 73 tests across 7 test files (up from 42)
- ✅ Package.json scripts — `data`, `seed`, `migrate`, `migrate:generate`
- ✅ Bot restarted and running under systemd with all features

### Frontend Removed (2026-05-16)
- ✅ Entire Next.js/React frontend stripped — all components, pages, API routes, styles, config removed
- ✅ Build stripped from 323 → 280 packages, ~80MB saved
- ✅ Stack simplified to TypeScript + SQLite + Telegram Bot + CLI

### Foundation
- ✅ SQLite + Drizzle ORM setup
- ✅ Database schema (events, domains) + seed script
- ✅ CLI Logger (`npx tsx src/cli/log.ts`)
- ✅ Telegram Bot (`@life_quant_logger_bot`)
- ✅ Memory system scaffolding
