---
id: failures-index
type: index
status: active
created: 2025-01-15
updated: 2025-05-14
tags: [failures, index]
token_estimate: 50
---

# Failures & Lessons

> Every mistake is a permanent record. Never deleted. Never redacted.
> Learn once, avoid forever.

| # | Date | Problem | Category | Severity |
|---|---|---|---|---|
| 1 | 2025-05-14 | Telegram bot 409 Conflict — multiple instances polling | Deployment | Medium |
| 2 | 2025-05-14 | Top-level await in CJS module | Build | Low |
| 3 | 2025-05-14 | Unnecessary type cast `false as unknown as boolean` | TypeScript | Low |
| 4 | 2025-05-14 | Toast timer leak (missing cleanup on unmount) | React | Low |
| 5 | 2025-05-14 | Operator precedence bug in midpoint calculation | Logic | Low |
| 6 | 2025-06-13 | Global 350ms transition slowed ALL hover/focus interactions | CSS | Medium |
| 7 | 2025-06-13 | `buildAreaPath` duplicating `buildLinePath` in SVG chart | Code Quality | Low |
| 8 | 2025-06-13 | Unused `weekly` field in DomainCards mapped object | Code Quality | Low |
| 9 | 2025-06-13 | QuickLog domain list not refreshing after domain creation | React | Low |
| 10 | 2025-06-13 | Duplicate `formatValue` in TodaySummary + RecentActivity | Code Quality | Low |
| 11 | 2025-05-16 | CreateDomainModal — no overflow scroll on small screens causes form to be cut off ("crash") | CSS/UX | Medium |
| 12 | 2025-05-16 | Light theme CSS `.light` selector has same specificity as `@layer properties :root`, risking cascade override | CSS | Medium |
| 13 | 2025-05-16 | Hardcoded hex colors in SVG elements (HeatmapCell tooltip, Heatmap labels) bypass theme system | CSS/Theming | High |
| 14 | 2025-05-16 | Missing viewport meta tag — mobile layout scaled down and unusable | Responsive | Critical |
| 15 | 2025-05-16 | Global `transition: transform` on `*` conflicts with CSS animations | CSS/Performance | Medium |
| 16 | 2025-05-16 | Typography and spacing in `px` ignores user browser zoom | Accessibility | Medium |
| 17 | 2025-05-16 | Z-index conflicts between QuickLog toast/panel and CreateDomainModal | CSS/Stacking | Medium |
| 18 | 2025-05-16 | `bg-black/xx` opacity variants don't adapt to light theme | CSS/Theming | Medium |
| 19 | 2026-05-16 | Accumulated frontend bugs led to full UI removal | Meta | High |

---

---

id: fail-011
type: failure
created: 2025-05-16
tags: [css, modal, ux, overflow]
related_decision: []
severity: medium
resolved: true

## Failure: CreateDomainModal UI "Crash" — Missing Overflow Scroll

**What happened:** Clicking "New Domain" made the modal form appear, but on small viewports the bottom of the form (especially the action buttons) was cut off and unreachable. This appeared as a "UI crash" since the user couldn't complete the form.

**Root cause:** The modal container used `flex items-center justify-center` without `overflow-y-auto`. If the form content was taller than the viewport, the card was centered but its bottom portion was clipped by the viewport edge with no way to scroll.

**Impact:** User couldn't create domains on small screens, making the feature effectively broken on mobile.

**Resolution:**
1. Added `overflow-y-auto` to the modal overlay so content can scroll when it exceeds viewport height.
2. Added a `useEffect` to lock `document.body.style.overflow = "hidden"` when the modal opens, preventing background page scroll.

**Prevention:** Modal overlays should always include `overflow-y-auto` for small-screen safety. Body scroll-lock is essential for any full-viewport overlay.

---

id: fail-012
type: failure
created: 2025-05-16
tags: [css, theme, specificity, property]
related_decision: []
severity: medium
resolved: true

## Failure: Light Theme Not Applying Correctly — CSS Selector Specificity

**What happened:** When toggling to light mode, some CSS variable values remained at their dark-mode defaults instead of switching to the light-mode overrides. The background and text colors did not fully transition.

**Root cause:** The `.light` CSS class selector had the same specificity (0,1,0) as `:root` (0,1,0), which is used by Tailwind v4's `@layer properties` block to set default dark-mode CSS variable values. In certain browsers or cascade edge cases, the layered `:root` defaults could override the unlayered `.light` overrides, or the `@property` `initial-value` could interfere.

**Resolution:** Changed `.light` to `:root.light` (specificity 0,2,0), guaranteeing it beats any `:root`-level variable definitions regardless of layering. This ensures light-mode overrides always take precedence.

**Prevention:** When overriding `:root`-level CSS variables with a class-based theme toggle, always use a higher-specificity selector like `:root.light` or `html.light` to guarantee cascade precedence over layered defaults.

---

id: fail-001
type: failure
created: 2025-05-14
tags: [deployment, telegram, bot]
related_decision: []
severity: medium
resolved: true

## Failure: Telegram Bot 409 Conflict

**What happened:** Bot started but didn't respond to messages. Telegram returned `409 Conflict: terminated by other getUpdates request`.

**Root cause:** Multiple bot instances running simultaneously. Earlier `timeout 10 npx tsx src/bot/index.ts` left orphaned processes. When a second instance started via `nohup`, both tried to poll the same Telegram API endpoint, causing Telegram to reject both.

**Impact:** ~15 minutes debugging. User couldn't use bot.

**Resolution:** Kill all bot processes (`pkill -f tsx.*bot`), restart single instance.

**Prevention:** Check for existing bot process before starting new one. Or use a PID file. Or use pm2 for process management.

---

---

id: fail-002
type: failure
created: 2025-05-14
tags: [build, typescript, commonjs]
severity: low
resolved: true

## Failure: Top-Level Await in CJS Module

**What happened:** `npx tsx src/bot/index.ts` threw `TransformError: Top-level await is currently not supported with the "cjs" output format`.

**Root cause:** `package.json` has no `"type": "module"`, so tsx uses CJS output. Top-level `await` (on `bot.getMe()`) is a syntax error in CJS.

**Impact:** Bot wouldn't start. ~5 minutes to debug and fix.

**Resolution:** Wrap startup logic in async IIFE: `(async () => { ... })();`

**Prevention:** Always wrap top-level `await` in async IIFE when using tsx in CJS mode. Or add `"type": "module"` to package.json (but breaks Next.js).

---

---

id: fail-003
type: failure
created: 2025-05-14
tags: [typescript, drizzle, type-safety]
severity: low
resolved: true

## Failure: Unnecessary Type Cast `false as unknown as boolean`

**What happened:** TypeScript type error when passing `false` to Drizzle's `eq()`. Fixed by casting `false as unknown as boolean`, which worked but was unnecessary and confusing.

**Root cause:** Drizzle column defined as `integer("archived", { mode: "boolean" })` — the type system was already boolean-compatible. The cast was cargo-culted.

**Impact:** None functionally. Code was uglier.

**Resolution:** Use plain `false` — Drizzle handles the boolean-to-integer conversion internally.

**Prevention:** Trust Drizzle's type system. Try plain values first before casting.

---

---

id: fail-004
type: failure
created: 2025-05-14
tags: [react, performance, cleanup]
severity: low
resolved: true

## Failure: Toast Timer Leak on Unmount

**What happened:** Toast auto-dismiss `setTimeout` could fire after component unmount, causing React state update warning.

**Root cause:** Timer ID stored in a local variable inside `useCallback`. `return () => clearTimeout(timer)` doesn't work in `useCallback` (it's not a `useEffect` cleanup).

**Impact:** Potential minor console warning. No functional impact.

**Resolution:** Use `useRef` to store timer ID, clean up in `useEffect` return.

**Prevention:** Always use `useRef` + `useEffect` cleanup for timers in React components.

---

---

id: fail-005
type: failure
created: 2025-05-14
tags: [logic, javascript, operators]
severity: low
resolved: true

## Failure: Operator Precedence Bug in Midpoint Calculation

**What happened:** `(domain?.minValue ?? 0 + domain?.maxValue ?? 10) / 2` evaluated to `0` instead of `5` for a domain with min=0, max=10.

**Root cause:** `??` has lower precedence than `+`. So `0 + domain?.maxValue` is evaluated first, then `domain?.minValue ?? (result)`. For min=0, the result is `(0) ?? (0 + 10 ?? 10)` = `0` because `0` is not nullish.

**Impact:** Boolean domains initialized to wrong value.

**Resolution:** Use explicit parentheses: `((domain?.minValue ?? 0) + (domain?.maxValue ?? 10)) / 2`

**Prevention:** Always parenthesize compound expressions with `??` and arithmetic operators.

---

---

id: fail-006
type: failure
created: 2025-06-13
tags: [css, transitions, performance]
severity: medium
resolved: true

## Failure: Global 350ms Transition Slowed All Hover/Focus Interactions

**What happened:** Theme switch animation worked smoothly, but all button hover effects, input focus states, and card hover transitions became sluggish (350ms).

**Root cause:** Applied `transition-duration: 350ms` globally via `*` selector, which affected ALL elements and ALL properties — not just the theme-related custom properties.

**Impact:** Interactive feedback felt unresponsive. Buttons took visibly long to highlight on hover (~350ms vs expected ~150ms).

**Resolution:** Split into two transition rules:
- `* { transition-duration: 150ms }` — standard interactive properties (background-color, border-color, color, etc.)
- `:root { transition-duration: 350ms }` — only the 37 @property-registered custom variables that change during theme switch

**Prevention:** Never increase global transition duration without separating interactive feedback from decorative animation. Interactive should be ≤150ms, thematic animation can be 250-400ms.

---

---

id: fail-007
type: failure
created: 2025-06-13
tags: [code-quality, svg, duplication]
severity: low
resolved: true

## Failure: buildAreaPath Duplicating buildLinePath in SVG Chart

**What happened:** ConsistencyTrend.tsx had two nearly identical functions — `buildLinePath` and `buildAreaPath` — that calculated the same SVG path coordinates independently.

**Root cause:** Wrote `buildAreaPath` from scratch instead of reusing `buildLinePath` and appending the area closure (L bottom-left L bottom-right Z).

**Impact:** Potential for floating-point drift between the line and the area fill if one function was updated and the other wasn't. Extra code to maintain.

**Resolution:** `buildAreaPath` now calls `buildLinePath` internally: `const line = buildLinePath(data, n); return line + " L" + lastX + "," + bottom + " L" + firstX + "," + bottom + " Z";`

**Prevention:** When SVG paths share a line segment, compute it once and append the area/outline closure.

---

---

id: fail-008
type: failure
created: 2025-06-13
tags: [code-quality, dead-code]
severity: low
resolved: true

## Failure: Unused `weekly` Field in DomainCards Mapped Object

**What happened:** DomainCards computed a `weekly` field (full weekly breakdown) but only used `scores` (extracted consistency numbers) in the rendering JSX.

**Root cause:** Copied the analytics computation pattern from Heatmap but only needed the scores array for the sparkline path.

**Impact:** Dead data in the mapped object — wasted computation and memory. Minor but unnecessary.

**Resolution:** Removed the `weekly` field from the mapped object. Same result, less data.

**Prevention:** Audit mapped/derived objects before finalizing. If a field isn't used in JSX, don't compute it.

---

---

id: fail-009
type: failure
created: 2025-06-13
tags: [react, data-flow, refresh]
severity: low
resolved: true

## Failure: QuickLog Domain List Not Refreshing After Domain Creation

**What happened:** Creating a new domain via CreateDomainModal incremented `refreshKey` to update the dashboard, but QuickLog still showed the old domain list — the newly created domain was not selectable until page refresh.

**Root cause:** QuickLog fetched domains in `useEffect(() => { ... }, [])` — empty deps meant it only fetched once on mount. The `refreshKey` prop was available but not wired as a dependency.

**Impact:** UX friction — user creates a domain, opens QuickLog, and the domain isn't there. Must refresh the page.

**Resolution:** Added `refreshKey` prop to QuickLog and made the domain-fetching effect depend on `useEffect(() => { ... }, [refreshKey])`.

**Prevention:** Any component that displays data based on external state should subscribe to `refreshKey` changes. When adding a new data source dependency, always propagate the refresh key.

---

---

id: fail-010
type: failure
created: 2025-06-13
tags: [code-quality, duplication, refactoring]
severity: low
resolved: true

## Failure: Duplicate formatValue Functions Across Components

**What happened:** Both TodaySummary and RecentActivity had identical `formatValue(value, domain)` functions that formatted boolean as Yes/No and numeric as value + unit.

**Root cause:** Each component was written independently, each needing the same formatting logic. Extracting a shared helper wasn't on the first-pass radar.

**Impact:** Duplicate code. If formatting rules changed (e.g., "Yes"/"No" → "✅"/"❌"), both places needed updating.

**Resolution:** Extracted `formatDomainValue(value, domain)` into `src/lib/api.ts`. Both components import and use it. Also used by DomainCards.

**Prevention:** When the same logic appears in ≥2 components, extract to a shared utility immediately. In this case, the helper was obvious in retrospect but missed because components were written in separate sessions.

---

id: fail-019
type: failure
created: 2026-05-16
tags: [architecture, frontend, react, maintenance]
severity: high
resolved: true

## Failure: Accumulated Frontend Bugs Led to Full UI Removal

**What happened:** The Next.js/React frontend accumulated enough bugs across its 11 components, 800-line CSS design system, and complex theming setup that maintaining it was no longer worth the effort. Instead of fixing individual bugs, the entire frontend was stripped.

**Root cause:** Multi-factor:
1. CSS complexity — 37 @property-registered variables, two-tier transitions, .light override specificity, global transition conflicts
2. React component sprawl — page.tsx orchestrated 7 children with 3 state variables and 5 callbacks. QuickLog, DomainCards, CreateDomainModal had interdependencies
3. No tests — Zero tests for any of the 11 components
4. Frontend not essential — For a single-user local tool, the Telegram Bot and CLI provided the most value

**Impact:** ~80MB of dependencies removed (243 packages). Build simplified. Maintenance burden eliminated.

**Resolution:** Complete removal of all React components, pages, API routes, styles, configs, and client-side API client.

**Prevention:** Before adding a frontend to a CLI/bot-first tool, ask: "Is the web UI essential for core functionality, or is it a nice-to-have visualization?" If the latter, consider a simpler approach before committing to a full SPA framework.
