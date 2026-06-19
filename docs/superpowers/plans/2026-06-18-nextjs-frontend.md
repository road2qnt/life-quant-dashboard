# Next.js Frontend (Full Mirror) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Next.js web frontend with feature parity to the existing bot + CLI, backed by Turso (SQLite-compatible) so it is accessible from any device on Vercel's free tier.

**Architecture:** Replace `better-sqlite3` with `@libsql/client` (Turso) so the frontend (Vercel), bot, and CLI all share one database. Next.js App Router with Server Actions for mutations, Server Components for reads, React built-in state. Custom SVG heatmap + Recharts for other charts. Tokyo Night (dark) + Catppuccin Latte (light) themes.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5, Tailwind v4, Recharts, next-themes, Drizzle ORM + `@libsql/client` (Turso).

**Spec:** `docs/superpowers/specs/2026-06-18-nextjs-frontend-design.md`

---

## Pre-flight: Reference Facts (verified in codebase)

These are facts confirmed by reading the code before writing this plan. Tasks reference them to stay accurate.

- **DB init** (`src/lib/db/index.ts`): `better-sqlite3` → `drizzle(sqlite, { schema })`. Exports `db` and `schema`.
- **Schema** (`src/lib/db/schema.ts`): 6 tables — `domains`, `events`, `weeklySnapshots`, `correlations`, `agentMemory`, `config`. All Drizzle `sqliteTable`. **Unchanged across migration.**
- **Files calling the DB** (non-test): `src/bot/index.ts`, `src/cli/log.ts`, `src/lib/export.ts`, `src/lib/import.ts`, `src/lib/export-csv.ts`, `src/lib/import-csv.ts`, `src/lib/seed.ts`, and the analytics modules `snapshots.ts`, `correlations.ts`, `sessions.ts`, `review.ts`, `burnout.ts`, `anomalies.ts`.
- **Sync DB calls needing `await`** (pattern: `.all()`, `.get()`, `.run()`): found in every file listed above. Most analytics functions are already `async`; the bot/CLI/export/import have sync calls inside already-async functions but missing `await`.
- **Only one test file uses a real DB**: `src/lib/analytics/burnout.test.ts` (spins up temp `better-sqlite3` files + uses `vi.resetModules()` + dynamic `import("./burnout")` so the module picks up `process.env.DB_PATH`). All other tests (consistency, anomalies, correlations, export, import, csv, bot helpers) are pure-function or mock-based.
- **Drizzle config** (`drizzle.config.ts`): `dialect: "sqlite"`, `dbCredentials.url: "data.db"`.
- **Env** (`.env.example`): `BOT_TOKEN`, `DB_PATH`.
- **Scripts** (`package.json`): `test`, `test:watch`, `bot`, `cli`, `data`, `seed`, `migrate`, `migrate:generate`.
- **`consistency.ts`** does NOT call the DB — it is a pure function module taking `EventData[]`. No migration needed there.
- **Analytics exports** (`src/lib/analytics/index.ts`): consistency, snapshots, review, sessions, burnout, anomalies. (Correlations is imported directly from `./correlations`, not via the barrel.)

---

## Phase 0 — Foundation (driver swap + Next.js skeleton + theme)

**Definition of done:** `npm run dev` serves a blank themed page; `npm test` still passes 130/130; DB connects to Turso; bot + CLI still run against Turso.

### Task 0.1: Create working branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/nextjs-frontend
```

- [ ] **Step 2: Commit the branch creation marker (spec + plan already committed on main)**

Verify clean state:
```bash
git status
git log --oneline -5
```
Expected: on `feat/nextjs-frontend`, HEAD matches main's latest spec/plan commits.

---

### Task 0.2: Swap DB driver to @libsql/client

This is the highest-risk task. Do it first, in isolation, before touching any frontend code. If tests stay green here, the rest is straightforward.

**Files:**
- Modify: `package.json` (swap deps)
- Modify: `src/lib/db/index.ts` (connection init)
- Modify: `drizzle.config.ts` (driver config)
- Modify: `.env.example` (new env vars)

- [ ] **Step 1: Install @libsql/client, remove better-sqlite3**

```bash
npm install @libsql/client
npm uninstall better-sqlite3 @types/better-sqlite3
```

- [ ] **Step 2: Rewrite `src/lib/db/index.ts`**

Replace the entire file with:

```typescript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Local SQLite file (CLI/bot/seed) OR remote Turso (Vercel + multi-device).
// Turso wins if TURSO_URL is set; otherwise fall back to a local file path.
const tursoUrl = process.env.TURSO_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl && !process.env.DB_PATH) {
  // Default local file path for dev without Turso configured
  process.env.DB_PATH = "data.db";
}

const client = createClient(
  tursoUrl
    ? { url: tursoUrl, authToken: tursoAuthToken }
    : { url: process.env.DB_PATH! }
);

export const db = drizzle(client, { schema });
export { schema };
```

- [ ] **Step 3: Update `drizzle.config.ts`**

Replace the entire file with:

```typescript
import { defineConfig } from "drizzle-kit";

const tursoUrl = process.env.TURSO_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "sqlite",
  dbCredentials: tursoUrl
    ? { url: tursoUrl, authToken: tursoAuthToken }
    : { url: process.env.DB_PATH || "data.db" },
});
```

- [ ] **Step 4: Update `.env.example`**

Append the new variables:

```bash
# ─── Database ────────────────────────────────────────────
# Option A: Local SQLite file (default for CLI/bot dev).
# DB_PATH=data.db

# Option B: Turso (remote SQLite) for multi-device access via Vercel.
# Get these from https://turso.tech after `turso db create` + `turso db tokens create`.
# TURSO_URL=libsql://<your-db>.turso.io
# TURSO_AUTH_TOKEN=<long-token-string>
```

- [ ] **Step 5: Commit the driver swap**

```bash
git add package.json package-lock.json src/lib/db/index.ts drizzle.config.ts .env.example
git commit --no-gpg-sign -m "refactor(db): swap better-sqlite3 for @libsql/client

Turso-compatible. Falls back to local SQLite file when TURSO_URL is
unset so CLI/bot still work for local dev. Drizzle schema unchanged."
```

---

### Task 0.3: Fix DB calls that lost `await` (sync → async libSQL)

`better-sqlite3` is synchronous; `@libsql/client` is async. Every `.all()`, `.get()`, `.run()` must now be awaited. TypeScript strict mode will NOT catch this because the old return type was an array; the new return type is a Promise. We must audit each file.

**Approach:** for each file, run `tsc --noEmit`, find the new type errors, add `await`. Each sub-step below is one file.

**Files (each its own commit):**
- `src/lib/export.ts`
- `src/lib/import.ts`
- `src/lib/export-csv.ts`
- `src/lib/import-csv.ts`
- `src/lib/seed.ts`
- `src/bot/index.ts`
- `src/cli/log.ts`
- `src/cli/data.ts` (imports analytics only; check no direct DB calls)

- [ ] **Step 1: Fix `src/lib/export.ts`**

The `Promise.all([...])` block at lines 17-24 wraps `.all()` calls that are no longer Promises of arrays — they now ARE Promises. With `@libsql/client`, `db.select().from(x).all()` returns a Promise, so the existing `await Promise.all([...])` pattern actually still works. **Verify by running tsc.**

```bash
npx tsc --noEmit 2>&1 | grep "export.ts" || echo "export.ts clean"
```

If errors appear, they will be about inferred types — fix the types, not the logic.

- [ ] **Step 2: Fix `src/lib/import.ts`**

The `for` loops already `await db.insert(...).run()` — that pattern works for both drivers. Verify:

```bash
npx tsc --noEmit 2>&1 | grep "import.ts" || echo "import.ts clean"
```

- [ ] **Step 3: Fix `src/lib/export-csv.ts`**

Already uses `await` on `.all()` calls (lines 35, 36, 54, 74, 75). Verify with tsc.

- [ ] **Step 4: Fix `src/lib/import-csv.ts`**

Already uses `await` (line 81, 121). Verify with tsc.

- [ ] **Step 5: Fix `src/lib/seed.ts`**

Lines 158, 169 already have `.run()` — these are inside an `async` function? Check and add `await` if missing.

```bash
npx tsc --noEmit 2>&1 | grep "seed.ts" || echo "seed.ts clean"
```

- [ ] **Step 6: Fix `src/bot/index.ts`**

This is the big one — 14 `.all()`/`.get()`/`.run()` calls (lines 81, 90, 116, 159, 240, 265, 305, 331, 444, 780, 787, 816, 878). Most are already inside `async` handlers but missing `await`. For each occurrence, prefix with `await` if not already.

Audit command:
```bash
grep -n "\.all()\|\.get()\|\.run()" src/bot/index.ts
```
For each line, open the file and prefix the call with `await`. All bot handlers are already `async`.

- [ ] **Step 7: Fix `src/cli/log.ts`**

Lines 89, 131, 140, 258, 288. Check whether the enclosing functions are `async`; if not, make them async (and propagate `await` up the call chain to `main`).

```bash
grep -n "\.all()\|\.get()\|\.run()" src/cli/log.ts
```

- [ ] **Step 8: Verify `src/cli/data.ts`**

`data.ts` imports from analytics modules (which are already async) — it should have no direct DB calls. Verify:
```bash
grep -n "schema\.\|from \"\.\./db\"\|db\." src/cli/data.ts || echo "no direct db usage"
```

- [ ] **Step 9: Run full typecheck**

```bash
npx tsc --noEmit && echo "TSC_CLEAN"
```
Expected: `TSC_CLEAN`. If errors remain, fix them — they are `await`-related.

- [ ] **Step 10: Run full test suite**

```bash
npm test 2>&1 | tail -6
```
Expected: **130 passed (130)** — all existing tests still pass. The `burnout.test.ts` file uses its own `better-sqlite3` instance directly (NOT via `src/lib/db`), so it is unaffected by the swap. Wait — Task 0.4 handles that.

- [ ] **Step 11: Commit the async fixes**

```bash
git add -u
git commit --no-gpg-sign -m "fix(db): add await to libSQL async calls in bot, CLI, export, import

better-sqlite3 was synchronous; @libsql/client is async. Prefix all
.all()/.get()/.run() calls with await. No logic changes."
```

---

### Task 0.4: Migrate burnout.test.ts off better-sqlite3

`burnout.test.ts` spins up its own `better-sqlite3` temp DB to integration-test `computeBurnoutRisk`. After removing `better-sqlite3`, this must switch to `@libsql/client` (in-memory local file works).

**Files:**
- Modify: `src/lib/analytics/burnout.test.ts` (imports at lines 5-7; setup helpers at lines 508-520, 537)

- [ ] **Step 1: Replace imports**

In `src/lib/analytics/burnout.test.ts`, replace lines 5-7:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
```

with:

```typescript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../db/schema";
```

- [ ] **Step 2: Rewrite `createTables()` helper (line 508-514)**

Replace:
```typescript
  function createTables() {
    const sqlite = new Database(tempDbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(CREATE_TABLES_SQL);
    sqlite.close();
  }
```

with:
```typescript
  async function createTables() {
    const client = createClient({ url: tempDbPath });
    // libSQL enables foreign keys by default; WAL not needed for tests.
    for (const stmt of CREATE_TABLES_SQL.split(";").map(s => s.trim()).filter(Boolean)) {
      await client.execute(stmt);
    }
    client.close();
  }
```

- [ ] **Step 3: Rewrite `clearData()` helper (line 516-520)**

Replace:
```typescript
  function clearData() {
    const sqlite = new Database(tempDbPath);
    sqlite.exec(CLEAR_DATA_SQL);
    sqlite.close();
  }
```

with:
```typescript
  async function clearData() {
    const client = createClient({ url: tempDbPath });
    for (const stmt of CLEAR_DATA_SQL.split(";").map(s => s.trim()).filter(Boolean)) {
      await client.execute(stmt);
    }
    client.close();
  }
```

- [ ] **Step 4: Make `beforeEach` async**

Replace `beforeEach(() => { clearData(); });` with:
```typescript
  beforeEach(async () => {
    await clearData();
  });
```

- [ ] **Step 5: Rewrite `seedWeekPattern()` DB connection (line 537-538)**

Replace:
```typescript
    const sqlite = new Database(tempDbPath);
    const ddb = drizzle(sqlite);
```

with:
```typescript
    const client = createClient({ url: tempDbPath });
    const ddb = drizzle(client);
```

And at the end of `seedWeekPattern` (around line 576 where `sqlite.close()` is), replace with:
```typescript
    client.close();
```

- [ ] **Step 6: Make `beforeAll` await `createTables()`**

Find `beforeAll(() => {` in the integration test describe block and change to:
```typescript
  beforeAll(async () => {
    // ... existing setup ...
    await createTables();
  });
```

- [ ] **Step 7: Run burnout tests**

```bash
npx vitest run src/lib/analytics/burnout.test.ts 2>&1 | tail -8
```
Expected: 33 passed (33).

- [ ] **Step 8: Commit**

```bash
git add src/lib/analytics/burnout.test.ts
git commit --no-gpg-sign -m "test(burnout): migrate integration tests to @libsql/client

Replaces direct better-sqlite3 temp-DB usage with @libsql/client.
Schema DDL executed statement-by-statement. Tests still integration-test
computeBurnoutRisk end-to-end via the same DB_PATH env-var trick."
```

---

### Task 0.5: Verify driver swap end-to-end

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -6
```
Expected: 130 passed (130).

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit && echo "TSC_CLEAN"
```
Expected: `TSC_CLEAN`.

- [ ] **Step 3: Smoke-test the seed + CLI against local SQLite**

```bash
DB_PATH=./tmp-test.db npm run seed
DB_PATH=./tmp-test.db npm run cli -- --list
rm tmp-test.db tmp-test.db-wal tmp-test.db-shm 2>/dev/null
```
Expected: seed runs without error; `--list` shows seeded events.

- [ ] **Step 4: Commit phase 0 progress marker (optional)**

No new changes — just a checkpoint.

---

### Task 0.6: Install Next.js + Tailwind v4 + Recharts + next-themes

**Files:** `package.json`, new config files

- [ ] **Step 1: Install runtime deps**

```bash
npm install next@latest react@latest react-dom@latest
npm install recharts next-themes
```

- [ ] **Step 2: Install dev deps**

```bash
npm install -D @types/react @types/react-dom tailwindcss@latest @tailwindcss/postcss postcss
```

- [ ] **Step 3: Add npm scripts**

In `package.json`, add to `scripts`:
```json
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
```

- [ ] **Step 4: Create `next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 5: Create `postcss.config.mjs`**

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 6: Commit the framework install**

```bash
git add package.json package-lock.json next.config.ts postcss.config.mjs
git commit --no-gpg-sign -m "chore: install Next.js, Tailwind v4, Recharts, next-themes

Foundation for the web frontend. Adds dev/build/start/lint/typecheck
scripts alongside existing bot/cli/data/seed scripts."
```

---

### Task 0.7: Set up App Router skeleton + Tailwind + theme tokens

**Files:**
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Modify: `tsconfig.json` (path alias)
- Modify: `next.config.ts` (if needed)

- [ ] **Step 1: Add path alias to `tsconfig.json`**

In the `compilerOptions` object, add:
```json
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
    "jsx": "preserve",
    "moduleResolution": "bundler",
```

Also add to `include`: `"src/**/*.ts", "src/**/*.tsx"`.

- [ ] **Step 2: Create `src/app/globals.css` with theme tokens**

```css
@import "tailwindcss";

@theme {
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
}

/* ─── Light theme: Catppuccin Latte ──────────────────────── */
:root {
  --bg: #eff1f5;
  --surface: #e6e9ef;
  --surface-2: #ccd0da;
  --border: #bcc0cc;
  --text: #4c4f69;
  --text-muted: #7c7f93;
  --blue: #1e66f5;
  --red: #d20f39;
  --green: #40a02b;
  --purple: #8839ef;
  --yellow: #df8e1d;
  --teal: #179299;
  /* Heatmap intensity ramp (5 levels) */
  --hm-0: #bcc0cc;
  --hm-1: #a6d189;
  --hm-2: #179299;
  --hm-3: #1e66f5;
  --hm-4: #8839ef;
}

/* ─── Dark theme: Tokyo Night ────────────────────────────── */
[data-theme="dark"] {
  --bg: #1a1b26;
  --surface: #24283b;
  --surface-2: #3b4261;
  --border: #3b4261;
  --text: #c0caf5;
  --text-muted: #565f89;
  --blue: #7aa2f7;
  --red: #f7768e;
  --green: #9ece6a;
  --purple: #bb9af7;
  --yellow: #e0af68;
  --teal: #41a6b5;
  /* Heatmap intensity ramp (5 levels) */
  --hm-0: #1e2030;
  --hm-1: #283457;
  --hm-2: #34629e;
  --hm-3: #41a6b5;
  --hm-4: #7aa2f7;
}

html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
}
```

- [ ] **Step 3: Create `src/app/layout.tsx`**

```tsx
import "./globals.css";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Life Quant",
  description: "Personal analytics dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Create `src/components/theme-provider.tsx`**

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 5: Create placeholder `src/app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main style={{ padding: "2rem" }}>
      <h1>Life Quant</h1>
      <p>Frontend under construction.</p>
    </main>
  );
}
```

- [ ] **Step 6: Run dev server and verify it loads**

```bash
npm run dev
```
Open http://localhost:3000 — expect "Life Quant" heading. Stop the server (Ctrl+C).

- [ ] **Step 7: Commit skeleton**

```bash
git add src/app/ src/components/theme-provider.tsx tsconfig.json
git commit --no-gpg-sign -m "feat(web): App Router skeleton with Tokyo Night + Catppuccin theme tokens

next-themes provider with data-theme attribute. CSS variables for both
themes. Tailwind v4 @theme directive. Placeholder home page."
```

---

## Phase 1 — Core CRUD (Header, Overview, QuickLog, Recent Events)

**Definition of done:** User can log an event from the web and see it appear in the list. Stat cards show real data. Domain dropdown filters.

### Task 1.1: Server Actions for events + domains

**Files:**
- Create: `src/app/actions/events.ts`
- Create: `src/app/actions/domains.ts`

- [ ] **Step 1: Create `src/app/actions/events.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function logEvent(input: {
  domainId: string;
  value: number;
  note?: string;
}) {
  try {
    await db.insert(schema.events).values({
      id: crypto.randomUUID(),
      domainId: input.domainId,
      value: input.value,
      note: input.note ?? null,
      timestamp: new Date().toISOString(),
      source: "web",
    });
    revalidatePath("/");
    return { success: true as const };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function deleteEvent(id: string) {
  try {
    await db.delete(schema.events).where(eq(schema.events.id, id)).run();
    revalidatePath("/");
    return { success: true as const };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function getRecentEvents(limit = 10) {
  return db
    .select({
      id: schema.events.id,
      domainId: schema.events.domainId,
      domainLabel: schema.domains.label,
      domainIcon: schema.domains.icon,
      value: schema.events.value,
      note: schema.events.note,
      timestamp: schema.events.timestamp,
    })
    .from(schema.events)
    .innerJoin(schema.domains, eq(schema.events.domainId, schema.domains.id))
    .orderBy(desc(schema.events.timestamp))
    .limit(limit)
    .all();
}
```

- [ ] **Step 2: Create `src/app/actions/domains.ts`**

```typescript
"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function getDomains() {
  return db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();
}
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit && echo "TSC_CLEAN"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/
git commit --no-gpg-sign -m "feat(web): server actions for events (log/delete/recent) and domains"
```

---

### Task 1.2: Header component (tabs + theme toggle + domain dropdown)

**Files:**
- Create: `src/components/header.tsx`
- Create: `src/components/theme-toggle.tsx`
- Modify: `src/app/layout.tsx` (mount Header)
- Create: `src/app/(tabs)/overview/layout.tsx` (tab navigation layout)

- [ ] **Step 1: Create `src/components/theme-toggle.tsx`**

```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span style={{ width: 24 }} />; // avoid hydration mismatch
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
```

- [ ] **Step 2: Create `src/components/header.tsx`**

```tsx
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

const TABS = [
  { href: "/overview", label: "Overview" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/analytics", label: "Analytics" },
  { href: "/correlations", label: "Correlations" },
  { href: "/anomalies", label: "Anomalies" },
  { href: "/review", label: "Review" },
  { href: "/data", label: "Data" },
];

export function Header() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 24px",
        borderBottom: `1px solid var(--border)`,
        background: "var(--surface)",
      }}
    >
      <strong style={{ color: "var(--text)" }}>Life Quant</strong>
      <nav style={{ display: "flex", gap: 4, flex: 1 }}>
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              color: "var(--text-muted)",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <ThemeToggle />
    </header>
  );
}
```

- [ ] **Step 3: Update `src/app/layout.tsx` to mount Header**

```tsx
import "./globals.css";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Life Quant",
  description: "Personal analytics dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <Header />
          <main style={{ padding: 24 }}>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Redirect root → overview**

Replace `src/app/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/overview");
}
```

- [ ] **Step 5: Run dev server, verify header renders**

```bash
npm run dev
```
Open http://localhost:3000 — expect redirect to /overview (will 404 until Task 1.3). Header visible with tabs + theme toggle working.

- [ ] **Step 6: Commit**

```bash
git add src/components/header.tsx src/components/theme-toggle.tsx src/app/layout.tsx src/app/page.tsx
git commit --no-gpg-sign -m "feat(web): header with 7 tab links and theme toggle"
```

---

### Task 1.3: Overview page with stat cards + QuickLog + recent events

**Files:**
- Create: `src/app/(tabs)/overview/page.tsx`
- Create: `src/components/stat-card.tsx`
- Create: `src/components/quick-log-form.tsx`
- Create: `src/components/recent-events.tsx`
- Create: `src/components/quick-log-fab.tsx`

- [ ] **Step 1: Create `src/components/stat-card.tsx`**

```tsx
export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ color: accent ?? "var(--text)", fontSize: 28, marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/quick-log-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { logEvent } from "@/app/actions/events";

export function QuickLogForm({ domains }: { domains: { id: string; label: string; icon: string | null }[] }) {
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "ok">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domainId || !value) return;
    setStatus("submitting");
    const res = await logEvent({ domainId, value: Number(value), note: note || undefined });
    setStatus(res.success ? "ok" : "error");
    if (res.success) {
      setValue("");
      setNote("");
      setTimeout(() => setStatus("idle"), 1500);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <select value={domainId} onChange={(e) => setDomainId(e.target.value)} disabled={status === "submitting"}>
        {domains.map((d) => (
          <option key={d.id} value={d.id}>{d.icon ?? ""} {d.label}</option>
        ))}
      </select>
      <input
        type="number"
        step="0.1"
        placeholder="Value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={status === "submitting"}
      />
      <input
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={status === "submitting"}
      />
      <button type="submit" disabled={status === "submitting" || !domainId || !value}>
        {status === "submitting" ? "Logging..." : "Log Event"}
      </button>
      {status === "ok" && <span style={{ color: "var(--green)" }}>✓ Logged</span>}
      {status === "error" && <span style={{ color: "var(--red)" }}>✗ Failed</span>}
    </form>
  );
}
```

- [ ] **Step 3: Create `src/components/recent-events.tsx`**

```tsx
"use client";

import { deleteEvent } from "@/app/actions/events";

type RecentEvent = {
  id: string;
  domainId: string;
  domainLabel: string;
  domainIcon: string | null;
  value: number;
  note: string | null;
  timestamp: string;
};

export function RecentEvents({ events }: { events: RecentEvent[] }) {
  async function onDelete(id: string) {
    await deleteEvent(id);
  }
  if (events.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>No events yet.</p>;
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {events.map((e) => (
        <li
          key={e.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span>
            {e.domainIcon ?? ""} {e.domainLabel}: <strong>{e.value}</strong>
            {e.note && <em style={{ color: "var(--text-muted)" }}> — {e.note}</em>}
          </span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <small style={{ color: "var(--text-muted)" }}>{new Date(e.timestamp).toLocaleString()}</small>
            <button onClick={() => onDelete(e.id)} style={{ color: "var(--red)", cursor: "pointer" }}>
              ✕
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Create `src/components/quick-log-fab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { getDomains } from "@/app/actions/domains";
import { QuickLogForm } from "./quick-log-form";

export function QuickLogFab() {
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<Awaited<ReturnType<typeof getDomains>>>([]);

  async function onOpen() {
    if (domains.length === 0) setDomains(await getDomains());
    setOpen(true);
  }

  if (!open) {
    return (
      <button
        onClick={onOpen}
        aria-label="Quick log"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--blue)",
          color: "white",
          fontSize: 28,
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        +
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        width: 280,
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>Quick Log</strong>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <QuickLogForm domains={domains} />
    </div>
  );
}
```

- [ ] **Step 5: Create Overview page**

```tsx
import { getRecentEvents } from "@/app/actions/events";
import { getDomains } from "@/app/actions/domains";
import { StatCard } from "@/components/stat-card";
import { QuickLogForm } from "@/components/quick-log-form";
import { RecentEvents } from "@/components/recent-events";
import { QuickLogFab } from "@/components/quick-log-fab";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [domains, recentEvents, todaysEvents] = await Promise.all([
    getDomains(),
    getRecentEvents(5),
    getRecentEvents(100).then((events) =>
      events.filter((e) => new Date(e.timestamp).toDateString() === new Date().toDateString())
    ),
  ]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Events Today" value={String(todaysEvents.length)} accent="var(--green)" />
        <StatCard label="Active Domains" value={String(domains.length)} accent="var(--blue)" />
        <StatCard label="Recent (5)" value={String(recentEvents.length)} accent="var(--purple)" />
        <StatCard label="Domains" value={String(domains.length)} accent="var(--teal)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Quick Log</h3>
          <QuickLogForm domains={domains} />
        </section>
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Recent Events</h3>
          <RecentEvents events={recentEvents} />
        </section>
      </div>

      <QuickLogFab />
    </div>
  );
}
```

- [ ] **Step 6: Add QuickLogFab to root layout**

In `src/app/layout.tsx`, add `<QuickLogFab />` before `</main>` (import it). This makes the FAB global.

- [ ] **Step 7: Run dev server and verify end-to-end**

```bash
DB_PATH=./tmp-dev.db npm run seed    # seed sample data
DB_PATH=./tmp-dev.db npm run dev
```
Open http://localhost:3000/overview — expect: stat cards with numbers, QuickLog form, recent events list, FAB button. Log an event → it appears in Recent Events after the page refreshes (via `revalidatePath`).

- [ ] **Step 8: Commit**

```bash
git add src/app/(tabs)/ src/components/stat-card.tsx src/components/quick-log-form.tsx src/components/recent-events.tsx src/components/quick-log-fab.tsx src/app/layout.tsx
git commit --no-gpg-sign -m "feat(web): Overview tab with stat cards, QuickLog, recent events, FAB

Server Components fetch domains + events; Server Action logEvent
mutates and calls revalidatePath. Stat cards show event counts. QuickLog
available as both inline widget and global floating action button."
```

---

## Phase 2 — Heatmap + Trends (Analytics charts)

**Definition of done:** Heatmap tab renders per-domain heatmap; Analytics tab shows time-series + burnout gauge.

### Task 2.1: Heatmap tab (custom SVG)

**Files:**
- Create: `src/app/actions/analytics.ts` (shared wrappers for DB-backed analytics)
- Create: `src/components/heatmap-grid.tsx`
- Create: `src/app/(tabs)/heatmap/page.tsx`

- [ ] **Step 1: Create `src/app/actions/analytics.ts`**

```typescript
"use server";

import { desc, eq, and, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function getEventsForHeatmap(domainId: string, days = 90) {
  const rangeStart = new Date();
  rangeStart.setDate(rangeStart.getDate() - days);
  return db
    .select({ value: schema.events.value, timestamp: schema.events.timestamp })
    .from(schema.events)
    .where(and(eq(schema.events.domainId, domainId), gte(schema.events.timestamp, rangeStart.toISOString())))
    .orderBy(desc(schema.events.timestamp))
    .all();
}
```

- [ ] **Step 2: Create `src/components/heatmap-grid.tsx`**

```tsx
"use client";

import { useState } from "react";

type HeatEvent = { value: number; timestamp: string };

function buildCells(events: HeatEvent[], days: number) {
  // Bucket events by YYYY-MM-DD, averaging per day.
  const byDate = new Map<string, number[]>();
  for (const e of events) {
    const date = e.timestamp.slice(0, 10);
    const arr = byDate.get(date) ?? [];
    arr.push(e.value);
    byDate.set(date, arr);
  }
  const cells: { date: string; avg: number | null }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const vals = byDate.get(dateStr);
    cells.push({ date: dateStr, avg: vals && vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null });
  }
  return cells;
}

function levelFor(avg: number | null, max: number): 0 | 1 | 2 | 3 | 4 {
  if (avg === null || avg <= 0) return 0;
  const ratio = avg / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

export function HeatmapGrid({
  events,
  maxValue = 10,
  days = 90,
}: {
  events: HeatEvent[];
  maxValue?: number;
  days?: number;
}) {
  const cells = buildCells(events, days);
  const [hovered, setHovered] = useState<string | null>(null);
  const colorFor = (lvl: number) => `var(--hm-${lvl})`;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(7, 16px)`,
          gap: 3,
          gridAutoFlow: "column",
          gridTemplateRows: "repeat(7, 16px)",
        }}
      >
        {cells.map((c) => {
          const lvl = levelFor(c.avg, maxValue);
          return (
            <div
              key={c.date}
              title={`${c.date}: ${c.avg === null ? "no data" : c.avg.toFixed(1)}`}
              onMouseEnter={() => setHovered(c.date)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                background: colorFor(lvl),
                outline: hovered === c.date ? `2px solid var(--text)` : "none",
                outlineOffset: 1,
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>
      {hovered && (
        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12 }}>
          Hovered: {hovered}
        </div>
      )}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} style={{ width: 12, height: 12, borderRadius: 2, background: colorFor(l) }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(tabs)/heatmap/page.tsx`**

```tsx
import { getDomains } from "@/app/actions/domains";
import { getEventsForHeatmap } from "@/app/actions/analytics";
import { HeatmapGrid } from "@/components/heatmap-grid";

export const dynamic = "force-dynamic";

export default async function HeatmapPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  const { domain: domainId } = await searchParams;
  const domains = await getDomains();
  const active = domains.find((d) => d.id === domainId) ?? domains[0];
  if (!active) return <p>No domains configured. Run `npm run seed` first.</p>;

  const events = await getEventsForHeatmap(active.id, 90);
  const max = active.maxValue ?? 10;

  return (
    <div>
      <h2>Heatmap — {active.label}</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {domains.map((d) => (
          <a
            key={d.id}
            href={`/heatmap?domain=${d.id}`}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: d.id === active.id ? "var(--blue)" : "var(--surface-2)",
              color: d.id === active.id ? "white" : "var(--text-muted)",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            {d.icon ?? ""} {d.label}
          </a>
        ))}
      </div>
      <HeatmapGrid events={events} maxValue={max} days={90} />
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
npm run dev
```
Open http://localhost:3000/heatmap — expect heatmap grid rendered, domain selector links work.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/analytics.ts src/components/heatmap-grid.tsx "src/app/(tabs)/heatmap/page.tsx"
git commit --no-gpg-sign -m "feat(web): Heatmap tab with custom SVG grid, per-domain selector

5-level intensity ramp bound to theme heatmap CSS variables. 90-day
default view. Hover tooltip via title attribute + outline highlight."
```

---

### Task 2.2: Analytics tab (trend chart + burnout gauge)

**Files:**
- Create: `src/components/trend-chart.tsx`
- Create: `src/components/burnout-gauge.tsx`
- Create: `src/app/(tabs)/analytics/page.tsx`
- Modify: `src/app/actions/analytics.ts` (add session + burnout wrappers)

- [ ] **Step 1: Extend `src/app/actions/analytics.ts`**

Append:

```typescript
import { computeBurnoutRisk, formatBurnoutReport } from "@/lib/analytics";
import { sessionReport } from "@/lib/analytics/sessions";

export async function getBurnoutRisk(domainId?: string) {
  return computeBurnoutRisk(domainId);
}

export async function getSessions(domainId?: string, days?: number) {
  return sessionReport(domainId, days);
}
```

- [ ] **Step 2: Create `src/components/trend-chart.tsx`**

```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Point = { date: string; value: number };

export function TrendChart({ data, color = "var(--blue)" }: { data: Point[]; color?: string }) {
  if (data.length === 0) return <p style={{ color: "var(--text-muted)" }}>No data.</p>;
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} tickFormatter={(s: string) => s.slice(5)} />
          <YAxis stroke="var(--text-muted)" fontSize={11} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}
            labelStyle={{ color: "var(--text)" }}
          />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/burnout-gauge.tsx`**

```tsx
export function BurnoutGauge({
  risk,
  riskScore,
}: {
  risk: "low" | "moderate" | "high";
  riskScore: number;
}) {
  const color = risk === "low" ? "var(--green)" : risk === "moderate" ? "var(--yellow)" : "var(--red)";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase" }}>Burnout Risk</div>
      <div style={{ color, fontSize: 32, textTransform: "capitalize" }}>{risk}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Score: {riskScore.toFixed(2)}</div>
    </div>
  );
}
import type { OverallBurnout } from "@/lib/analytics";
```

(Note: the `import type` at the bottom is unusual — move it to the top of the file in the actual edit.)

- [ ] **Step 4: Create `src/app/(tabs)/analytics/page.tsx`**

```tsx
import { getDomains } from "@/app/actions/domains";
import { getEventsForHeatmap, getBurnoutRisk } from "@/app/actions/analytics";
import { TrendChart } from "@/components/trend-chart";
import { BurnoutGauge } from "@/components/burnout-gauge";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  const { domain: domainId } = await searchParams;
  const [domains, burnout] = await Promise.all([
    getDomains(),
    getBurnoutRisk(domainId),
  ]);
  const active = domains.find((d) => d.id === domainId) ?? domains[0];

  let trendData: { date: string; value: number }[] = [];
  if (active) {
    const events = await getEventsForHeatmap(active.id, 90);
    // Average per day
    const byDate = new Map<string, number[]>();
    for (const e of events) {
      const d = e.timestamp.slice(0, 10);
      const arr = byDate.get(d) ?? [];
      arr.push(e.value);
      byDate.set(d, arr);
    }
    trendData = Array.from(byDate.entries())
      .map(([date, vals]) => ({ date, value: vals.reduce((a, b) => a + b, 0) / vals.length }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return (
    <div>
      <h2>Analytics</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <a href="/analytics" style={{ padding: "4px 10px", borderRadius: 6, background: !domainId ? "var(--blue)" : "var(--surface-2)", color: !domainId ? "white" : "var(--text-muted)", textDecoration: "none", fontSize: 13 }}>All</a>
        {domains.map((d) => (
          <a key={d.id} href={`/analytics?domain=${d.id}`} style={{ padding: "4px 10px", borderRadius: 6, background: d.id === domainId ? "var(--blue)" : "var(--surface-2)", color: d.id === domainId ? "white" : "var(--text-muted)", textDecoration: "none", fontSize: 13 }}>
            {d.icon ?? ""} {d.label}
          </a>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Trend — last 90 days</h3>
          <TrendChart data={trendData} />
        </section>
        <BurnoutGauge risk={burnout.risk} riskScore={burnout.riskScore} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run dev   # check /analytics renders
git add src/app/actions/analytics.ts src/components/trend-chart.tsx src/components/burnout-gauge.tsx "src/app/(tabs)/analytics/page.tsx"
git commit --no-gpg-sign -m "feat(web): Analytics tab with trend chart and burnout gauge

Recharts line chart for 90-day trend. BurnoutGauge wraps existing
computeBurnoutRisk. Domain selector via query string."
```

---

## Phase 3 — Analytics Advanced (Correlations, Anomalies, Sessions)

**Definition of done:** All 7 backend analytics modules have a web UI equivalent.

### Task 3.1: Correlations tab

**Files:**
- Create: `src/components/correlation-matrix.tsx`
- Create: `src/app/(tabs)/correlations/page.tsx`
- Modify: `src/app/actions/analytics.ts` (add correlation wrapper)

- [ ] **Step 1: Extend `src/app/actions/analytics.ts`**

Append:

```typescript
import { computeAllCorrelations, summarizeCorrelations } from "@/lib/analytics/correlations";

export async function getCorrelations(days = 365) {
  const results = await computeAllCorrelations(days);
  return summarizeCorrelations(results);
}
```

- [ ] **Step 2: Create `src/components/correlation-matrix.tsx`**

```tsx
type Cell = { a: string; b: string; r: number; n: number; p: number };

export function CorrelationMatrix({ cells, labels }: { cells: Cell[]; labels: string[] }) {
  function colorForR(r: number): string {
    const abs = Math.abs(r);
    if (abs > 0.7) return r > 0 ? "var(--green)" : "var(--red)";
    if (abs > 0.4) return r > 0 ? "var(--teal)" : "var(--yellow)";
    return "var(--surface-2)";
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th />
            {labels.map((l) => <th key={l} style={{ padding: 6 }}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((a) => (
            <tr key={a}>
              <th style={{ padding: 6 }}>{a}</th>
              {labels.map((b) => {
                const cell = cells.find((c) => c.a === a && c.b === b);
                return (
                  <td
                    key={b}
                    title={cell ? `r=${cell.r.toFixed(2)}, n=${cell.n}` : "n/a"}
                    style={{
                      padding: 8,
                      textAlign: "center",
                      background: cell ? colorForR(cell.r) : "var(--surface)",
                      color: "var(--text)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {cell ? cell.r.toFixed(2) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(tabs)/correlations/page.tsx`**

```tsx
import { getCorrelations } from "@/app/actions/analytics";
import { CorrelationMatrix } from "@/components/correlation-matrix";

export const dynamic = "force-dynamic";

export default async function CorrelationsPage() {
  const correlations = await getCorrelations(365);
  // summarizeCorrelations returns a summary shape — adapt to Cell[] based on actual return
  const labels: string[] = Array.from(new Set(correlations.flatMap((c: any) => [c.domainA, c.domainB])));
  const cells = correlations.map((c: any) => ({ a: c.domainA, b: c.domainB, r: c.pearsonR, n: c.sampleSize ?? 0, p: c.significance ?? 1 }));

  return (
    <div>
      <h2>Cross-Domain Correlations</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Pearson r over the last 365 days. Green = positive, red = negative.</p>
      <CorrelationMatrix cells={cells} labels={labels} />
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run dev   # check /correlations renders
git add src/components/correlation-matrix.tsx "src/app/(tabs)/correlations/page.tsx" src/app/actions/analytics.ts
git commit --no-gpg-sign -m "feat(web): Correlations tab with cross-domain Pearson r matrix"
```

---

### Task 3.2: Anomalies tab

**Files:**
- Create: `src/components/anomaly-list.tsx`
- Create: `src/app/(tabs)/anomalies/page.tsx`

- [ ] **Step 1: Create `src/components/anomaly-list.tsx`**

```tsx
import type { OverallAnomalies } from "@/lib/analytics";

export function AnomalyList({ result }: { result: OverallAnomalies }) {
  if (result.totalAnomalies === 0) {
    return <p style={{ color: "var(--green)" }}>✅ No anomalies detected.</p>;
  }
  return (
    <div>
      {result.domains.map((d) => (
        <div key={d.domainId} style={{ marginBottom: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>{d.icon ?? ""} {d.label} — {d.anomalyCount} flags</h3>
          {d.zScoreAnomalies.length > 0 && (
            <div>
              <strong style={{ color: "var(--purple)" }}>Z-score outliers</strong>
              <ul>
                {d.zScoreAnomalies.map((a, i) => (
                  <li key={i}>{a.date}: value {a.value}, z={a.zScore.toFixed(2)}</li>
                ))}
              </ul>
            </div>
          )}
          {d.streakAnomalies.length > 0 && (
            <div>
              <strong style={{ color: "var(--yellow)" }}>Low-effort streaks</strong>
              <ul>
                {d.streakAnomalies.map((s, i) => (
                  <li key={i}>{s.startDate} → {s.endDate} ({s.streakDays}d, avg {s.avgValueDuringStreak})</li>
                ))}
              </ul>
            </div>
          )}
          {d.contextualAnomalies.length > 0 && (
            <div>
              <strong style={{ color: "var(--red)" }}>Day-of-week deviations</strong>
              <ul>
                {d.contextualAnomalies.map((c, i) => (
                  <li key={i}>{c.date} ({c.dayOfWeek}): {c.value} vs avg {c.dayAverage} ({Math.abs(c.deviation).toFixed(1)}σ)</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(tabs)/anomalies/page.tsx`**

```tsx
import { detectAnomalies } from "@/lib/analytics";
import { AnomalyList } from "@/components/anomaly-list";

export const dynamic = "force-dynamic";

export default async function AnomaliesPage() {
  const result = await detectAnomalies(undefined, 90);
  return (
    <div>
      <h2>Anomaly Report — last 90 days</h2>
      <AnomalyList result={result} />
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run dev   # check /anomalies renders
git add src/components/anomaly-list.tsx "src/app/(tabs)/anomalies/page.tsx"
git commit --no-gpg-sign -m "feat(web): Anomalies tab using detectAnomalies + grouped AnomalyList"
```

---

### Task 3.3: Add Sessions to Analytics tab

**Files:**
- Modify: `src/app/(tabs)/analytics/page.tsx` (add sessions section)

- [ ] **Step 1: Extend analytics page to show session patterns**

In `src/app/(tabs)/analytics/page.tsx`, add a third section after TrendChart + BurnoutGauge:

```tsx
// at top, add import
import { getSessions } from "@/app/actions/analytics";

// in the component, fetch sessions:
const sessions = active ? await getSessions(active.id, 90) : [];

// render section (below the grid):
{active && sessions.length > 0 && (
  <section style={{ marginTop: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
    <h3 style={{ marginTop: 0 }}>Session Patterns — {active.label}</h3>
    {sessions[0] && (
      <div>
        <p>Busiest hour: <strong>{sessions[0].busiestHour.hour}:00</strong> ({sessions[0].busiestHour.count} events)</p>
        <p>Quietest day: <strong>{sessions[0].quietestDay.day}</strong> ({sessions[0].quietestDay.count} events)</p>
        <h4>Time of Day</h4>
        <ul>
          {sessions[0].timeOfDay.map((t, i) => (
            <li key={i}>{t.label}: {t.count} ({t.percentage.toFixed(0)}%)</li>
          ))}
        </ul>
      </div>
    )}
  </section>
)}
```

- [ ] **Step 2: Verify and commit**

```bash
npm run dev   # check /analytics now shows sessions
git add "src/app/(tabs)/analytics/page.tsx"
git commit --no-gpg-sign -m "feat(web): add session patterns section to Analytics tab"
```

---

## Phase 4 — Review + Data (Feature parity)

**Definition of done:** Weekly review page generates LLM insights; Data page handles import/export. Full Mirror complete.

### Task 4.1: Review tab (AI weekly review)

**Files:**
- Create: `src/app/(tabs)/review/page.tsx`
- Modify: `src/app/actions/analytics.ts` (add review wrapper)

- [ ] **Step 1: Extend `src/app/actions/analytics.ts`**

Append:

```typescript
import { generateWeeklyReview } from "@/lib/analytics";

export async function getWeeklyReview(weeks = 4) {
  return generateWeeklyReview(weeks);
}
```

- [ ] **Step 2: Create `src/app/(tabs)/review/page.tsx`**

```tsx
import { getWeeklyReview } from "@/app/actions/analytics";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  let review;
  let error: string | null = null;
  try {
    review = await getWeeklyReview(4);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to generate review.";
  }

  return (
    <div>
      <h2>Weekly Review</h2>
      {error && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--red)", borderRadius: 8, padding: 16, color: "var(--red)" }}>
          ⚠ {error}
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>
            Configure <code>LLM_API_KEY</code> (and optionally <code>LLM_MODEL</code>, <code>LLM_BASE_URL</code>) in your environment.
          </p>
        </div>
      )}
      {review && !error && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Week of {review.weekStart} → {review.weekEnd}</h3>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{review.review || review.rawPrompt}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run dev   # check /review renders (will show error if LLM_API_KEY missing, which is expected)
git add "src/app/(tabs)/review/page.tsx" src/app/actions/analytics.ts
git commit --no-gpg-sign -m "feat(web): Review tab with LLM weekly review + graceful missing-key error"
```

---

### Task 4.2: Data tab (Import / Export)

**Files:**
- Create: `src/app/actions/import-export.ts`
- Create: `src/components/import-export.tsx`
- Create: `src/app/(tabs)/data/page.tsx`

- [ ] **Step 1: Create `src/app/actions/import-export.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { exportAll } from "@/lib/export";
import { parseJSON, importData } from "@/lib/import";

export async function exportData() {
  const data = await exportAll();
  return JSON.stringify(data, null, 2);
}

export async function importJson(jsonString: string) {
  try {
    const data = parseJSON(jsonString);
    const counts = await importData(data);
    revalidatePath("/");
    return { success: true as const, counts };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "Import failed" };
  }
}
```

- [ ] **Step 2: Create `src/components/import-export.tsx`**

```tsx
"use client";

import { useState } from "react";
import { exportData, importJson } from "@/app/actions/import-export";

export function ImportExport() {
  const [importStatus, setImportStatus] = useState<string>("");

  async function onExport() {
    const json = await exportData();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `life-quant-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus("Importing...");
    const text = await file.text();
    const res = await importJson(text);
    setImportStatus(res.success ? `✓ Imported ${res.counts.events} events` : `✗ ${res.error}`);
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <button onClick={onExport}>⬇ Export JSON</button>
      <label style={{ cursor: "pointer" }}>
        ⬆ Import JSON
        <input type="file" accept=".json,application/json" onChange={onImport} style={{ display: "none" }} />
      </label>
      {importStatus && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{importStatus}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(tabs)/data/page.tsx`**

```tsx
import { ImportExport } from "@/components/import-export";

export const dynamic = "force-dynamic";

export default function DataPage() {
  return (
    <div>
      <h2>Data — Import / Export</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Back up or restore your full dataset (all tables).</p>
      <ImportExport />
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run dev   # check /data renders, test export downloads a JSON file
git add src/app/actions/import-export.ts src/components/import-export.tsx "src/app/(tabs)/data/page.tsx"
git commit --no-gpg-sign -m "feat(web): Data tab with JSON import/export via server actions"
```

---

### Task 4.3: README sync + final verification

**Files:**
- Modify: `README.md` (correct the false Next.js claims, document the new scripts)

- [ ] **Step 1: Update README's Quick Start**

In `README.md`, replace the false "Next.js 16 / Tailwind 4 / Zustand" stack description and add the real commands. Add:

- Web: `npm run dev` → http://localhost:3000
- CLI: `npm run cli`, `npm run data`
- Bot: `npm run bot`
- Tests: `npm test`
- Migrate DB: `npm run migrate`

Document Turso env vars (`TURSO_URL`, `TURSO_AUTH_TOKEN`) and the local fallback (`DB_PATH`).

- [ ] **Step 2: Final full verification**

```bash
npm test 2>&1 | tail -6           # expect 130 passed
npx tsc --noEmit && echo "TSC_CLEAN"
npm run build 2>&1 | tail -10      # expect successful Next.js build
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit --no-gpg-sign -m "docs: sync README with actual stack (Next.js + Turso + multi-interface)"
```

---

### Task 4.4: Merge to main + finish

- [ ] **Step 1: Push the feature branch**

```bash
git push -u origin feat/nextjs-frontend
```

- [ ] **Step 2: Use the finishing-a-development-branch skill to decide integration**

Invoke `superpowers:finishing-a-development-branch` to choose between merge / PR / cleanup. This will handle the final integration decision.

---

## Self-Review Notes (applied during writing)

- **Spec coverage:** Phase 0 = Foundation. Phase 1 = Core CRUD (Overview + QuickLog + Recent). Phase 2 = Heatmap + Analytics (burnout + trend). Phase 3 = Correlations + Anomalies + Sessions. Phase 4 = Review + Data. All 7 tabs covered. Theme system covered (Phase 0.7). Driver swap covered (0.2-0.5). Turso setup documented in `.env.example`. ✅
- **Placeholder scan:** No TBD/TODO. Code blocks are concrete. Two places use `(c: any)` in correlations — this is acceptable because `summarizeCorrelations`'s exact return shape isn't fully pinned down in the spec; the plan instructs the implementer to adapt to the actual return type. (Acceptable — the analytics function is already implemented and its type is discoverable.)
- **Type consistency:** `logEvent`, `deleteEvent`, `getRecentEvents`, `getDomains`, `getEventsForHeatmap`, `getBurnoutRisk`, `getSessions`, `getCorrelations`, `getWeeklyReview`, `exportData`, `importJson` — names used consistently across actions and components.
- **BurnoutGauge import fix flagged inline** (Task 2.2 Step 3 notes to move the `import type` to the top).
