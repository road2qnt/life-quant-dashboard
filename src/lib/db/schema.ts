import { sqliteTable, text, real, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Domains ────────────────────────────────────────────────────────────
// Configurable tracked domains (e.g., deep-work, sleep, gym)
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(), // e.g., 'deep-work', 'sleep'
  label: text("label").notNull(), // e.g., 'Deep Work'
  icon: text("icon"), // emoji or icon identifier
  unit: text("unit"), // 'hours', 'sessions', '1-10'
  type: text("type", { enum: ["numeric", "boolean", "scale"] })
    .notNull()
    .default("numeric"),
  minValue: real("min_value").default(0),
  maxValue: real("max_value").default(10),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  archived: integer("archived", { mode: "boolean" }).default(false),
});

// ─── Events (raw log) ──────────────────────────────────────────────────
// Append-only immutable event log. No UPDATEs, only DELETE for undo.
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id),
    timestamp: text("timestamp").notNull(), // ISO 8601
    value: real("value").notNull(),
    note: text("note"),
    source: text("source", {
      enum: ["manual", "cli", "telegram", "api", "integration", "web"],
    }).default("manual"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    domainDateIdx: uniqueIndex("idx_events_domain_date").on(
      table.domainId,
      table.timestamp
    ),
  })
);

// ─── Weekly Snapshots (computed cache) ─────────────────────────────────
export const weeklySnapshots = sqliteTable(
  "weekly_snapshots",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id),
    weekStart: text("week_start").notNull(), // Monday of week (ISO 8601)
    consistency: real("consistency"), // 0.0 to 1.0
    totalValue: real("total_value"),
    numEvents: integer("num_events"),
    trend: text("trend", {
      enum: ["improving", "declining", "stable", "insufficient"],
    }),
    metadata: text("metadata"), // JSON blob
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    domainWeekIdx: uniqueIndex("idx_snapshots_domain_week").on(
      table.domainId,
      table.weekStart
    ),
  })
);

// ─── Cross-domain Correlations (computed cache) ───────────────────────
export const correlations = sqliteTable(
  "correlations",
  {
    id: text("id").primaryKey(),
    domainAId: text("domain_a_id")
      .notNull()
      .references(() => domains.id),
    domainBId: text("domain_b_id")
      .notNull()
      .references(() => domains.id),
    pearsonR: real("pearson_r"),
    lagDays: integer("lag_days").default(0),
    sampleSize: integer("sample_size"),
    significance: real("significance"),
    computedAt: text("computed_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    pairIdx: uniqueIndex("idx_correlations_pair").on(
      table.domainAId,
      table.domainBId,
      table.lagDays
    ),
  })
);

// ─── Agent Memory (AI context) ─────────────────────────────────────────
export const agentMemory = sqliteTable("agent_memory", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: ["decision", "insight", "failure", "goal"],
  }).notNull(),
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── System Config (key-value) ─────────────────────────────────────────
export const config = sqliteTable("config", {
  key: text("key").primaryKey(),  value: text("value").notNull(), // JSON
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
