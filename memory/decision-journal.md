---
id: decision-journal
type: journal
status: active
created: 2025-01-15
updated: 2026-05-16
tags: [journal, reflections]
token_estimate: 250
---

# Decision Journal

> A personal record of why decisions were made, how they felt, and what was learned in the process.
> More introspective than ADRs. For the human, not the agent.

## 2025-01-15: Project Inception

**Decision:** Start the Life Quant Dashboard as a serious personal analytics project.

**Why now:** Been tracking behaviors informally for months. Data is fragmented. Need a unified system.

**Concerns:** Risk of overbuilding. Need to ship MVP in 2 weeks or the project will die.

**Hedge:** If the project stalls, the architecture document and memory system are reusable artifacts. Not wasted effort.

---

## 2025-05-14: MVP Implementation Complete

**Decision:** Built all MVP features in one go — DB, API, Heatmap, QuickLog, CLI, Telegram Bot.

**Reflection:** The memory system was invaluable. Being able to resume sessions without re-explaining context saved hours.

---

## 2025-06-13: Dashboard Expansion — Notion Design System + Theme Toggle

**Decision:** Overhaul the UI with a proper design system (Notion-inspired) and add dark/light theme toggle with smooth CSS transitions.

**What went well:**
- **Notion design system via CSS variables was the right call.** Components just use `bg-canvas`, `text-ink`, `border-hairline` and the theming happens automatically. Zero component changes needed for light mode.
- **@property for smooth theme transitions** — Works beautifully. The 350ms glide on `:root` + 150ms interactive on `*` is the right split. Hover feedback stays snappy, theme switch feels premium.
- **Didn't overthink architecture** — The `refreshKey` pattern (increment → all components re-fetch) scales fine for single-user. No need for Zustand yet.
- **Dashboard components are genuinely useful.** DomainCards with sparkline is the most satisfying piece — seeing per-domain trends at a glance feels like the real value of the project.
- **QuickLog external trigger** — Wiring DomainCards' "Log" button to QuickLog via `triggerDomainId` is a clean pattern. Feels integrated, not disjointed.

**What I'd do differently:**
- **Should have designed globals.css with light mode in mind from the start.** Adding `.light` overrides for 30+ variables after the fact was tedious. Next time, write both themes side by side from day one.
- **CSS variable transitions are verbose.** 37 `@property` registrations + listing them all in `:root { transition-property: ... }` is a lot of boilerplate. Worth it for the smooth result, but there's no shortcut in CSS for "transition all registered variables".
- **Should have extracted shared formatDomainValue() earlier.** Had to fix duplication after the review caught it. The helper is obvious in retrospect.
- **globals.css is getting long (~800 lines).** Fine for now but will need splitting at 1000+.

**Surprises:**
- **@property works exactly as documented.** Registered custom properties with `syntax: "<color>"` truly do animate smoothly. The `:root` transition trick propagates to all children via `inherits: true`.
- **`.light { --color-brand-navy: #f7f6f3 }` is all it takes** to theme the entire app. The CSS variable approach is powerful.
- **Browser devtools** — Chromium shows transitioning custom properties in the Elements panel with the interpolated value in real time. Satisfying to watch.
- **The DomainCards sparkline** — 80×24 SVG viewBox with a 2-point path. Minimal yet effective. SVG punches way above its weight class.

**Concerns:**
- **No tests.** 7 dashboard components + theme toggle + QuickLog with external trigger. Manual testing every time is getting risky.
- **globals.css at 800 lines.** One wrong edit could break the theme across the entire app.
- **@property browser support** — Fine for personal use (I control the browser), but would need fallbacks for wider distribution.
- **`page.tsx` orchestrates too much.** 3 state variables, 7 child components, 5 callbacks. Holding up but approaching the point where a layout component or context would help.

**Next:** Tests. The app is feature-complete for now. Lock it down with tests before adding more features.

---

## 2026-05-16: Frontend Removed — Back to Core

**Decision:** Stripped the entire Next.js/React frontend. The project now consists of only the Telegram Bot, CLI, and database layer.

**Why:**
- Accumulated bugs in the React/Next.js layer across 11 components, complex CSS theming (37 @property registrations, 800-line globals.css, two-tier transitions), and state management boilerplate
- The frontend was adding maintenance burden without proportional value — the most used interfaces were the Telegram Bot and CLI
- 243 packages of frontend dependencies removed, build simplified significantly

**What was learned:**
- The CSS design system (@property variables, Notion tokens, light/dark theme) was impressive engineering but fragile — a single misplaced `.light` specificity could break the entire theme
- React component complexity crept up fast: `page.tsx` orchestrated 7 children with 3 state variables and 5 callbacks
- For a single-user local tool, the Telegram Bot and CLI provide the best ROI — the frontend was "nice to have" but not essential

**Next:** Double down on bot features (/today, /stats), data export/import, and reliability (systemd/pm2 for bot).

---

*Write entries here after significant decisions. One entry per decision. Date-stamped.*
