import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../db/schema";

// ─── Schema DDL ─────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS domains (
  id text PRIMARY KEY NOT NULL,
  label text NOT NULL,
  icon text,
  unit text,
  type text DEFAULT 'numeric' NOT NULL,
  min_value real DEFAULT 0,
  max_value real DEFAULT 10,
  created_at text DEFAULT (datetime('now')) NOT NULL,
  archived integer DEFAULT false
);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY NOT NULL,
  domain_id text NOT NULL,
  timestamp text NOT NULL,
  value real NOT NULL,
  note text,
  source text DEFAULT 'manual',
  created_at text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(id)
);

CREATE INDEX IF NOT EXISTS idx_events_domain_date ON events (domain_id, timestamp);
`;

const CLEAR_DATA_SQL = `
DELETE FROM events;
DELETE FROM domains;
`;

// ─── Duplicated private helpers for testing ───────────────────────────

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

function classifyRisk(score: number): "low" | "moderate" | "high" {
  if (score >= 0.5) return "high";
  if (score >= 0.25) return "moderate";
  return "low";
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const indices = values.map((_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  const numerator = indices.reduce((sum, x, i) => sum + (x - meanX) * (values[i] - meanY), 0);
  const denominator = indices.reduce((sum, x) => sum + (x - meanX) * (x - meanX), 0);
  return denominator !== 0 ? numerator / denominator : 0;
}

// ─── coefficientOfVariation ───────────────────────────────────────────

describe("coefficientOfVariation", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(coefficientOfVariation([])).toBe(0);
    expect(coefficientOfVariation([5])).toBe(0);
  });

  it("returns 0 for all identical values", () => {
    const result = coefficientOfVariation([5, 5, 5, 5]);
    expect(result).toBe(0);
  });

  it("returns 0 if mean is 0", () => {
    const result = coefficientOfVariation([0, 0, 0, 0]);
    expect(result).toBe(0);
  });

  it("computes correctly for uniform data", () => {
    const result = coefficientOfVariation([2, 4, 6, 8]);
    expect(result).toBeCloseTo(0.5164, 3);
  });

  it("returns 0 for constant non-zero values", () => {
    const result = coefficientOfVariation([10, 10, 10]);
    expect(result).toBe(0);
  });

  it("handles mixed positive and negative values", () => {
    const result = coefficientOfVariation([-4, 0, 5]);
    expect(result).toBeGreaterThan(0);
    expect(isFinite(result)).toBe(true);
    expect(result).toBeCloseTo(13.53, 1);
  });

  it("handles large value spread", () => {
    const result = coefficientOfVariation([0.1, 10]);
    expect(result).toBeCloseTo(1.386, 2);
  });
});

// ─── classifyRisk ─────────────────────────────────────────────────────

describe("classifyRisk", () => {
  it("returns 'low' for scores below 0.25", () => {
    expect(classifyRisk(0)).toBe("low");
    expect(classifyRisk(0.1)).toBe("low");
    expect(classifyRisk(0.24)).toBe("low");
    expect(classifyRisk(-0.1)).toBe("low");
  });

  it("returns 'moderate' for scores 0.25 to 0.5 (exclusive)", () => {
    expect(classifyRisk(0.25)).toBe("moderate");
    expect(classifyRisk(0.3)).toBe("moderate");
    expect(classifyRisk(0.49)).toBe("moderate");
  });

  it("returns 'high' for scores 0.5 and above", () => {
    expect(classifyRisk(0.5)).toBe("high");
    expect(classifyRisk(0.75)).toBe("high");
    expect(classifyRisk(1)).toBe("high");
    expect(classifyRisk(1.5)).toBe("high");
  });

  it("is inclusive at boundaries", () => {
    expect(classifyRisk(0.25)).toBe("moderate");
    expect(classifyRisk(0.5)).toBe("high");
  });
});

// ─── linearSlope ──────────────────────────────────────────────────────

describe("linearSlope", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(linearSlope([])).toBe(0);
    expect(linearSlope([5])).toBe(0);
  });

  it("returns positive slope for increasing values", () => {
    const result = linearSlope([0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(result).toBeGreaterThan(0.07);
    expect(result).toBeLessThan(0.11);
  });

  it("returns negative slope for decreasing values", () => {
    const result = linearSlope([0.8, 0.7, 0.6, 0.5, 0.4]);
    expect(result).toBeLessThan(-0.07);
    expect(result).toBeGreaterThan(-0.11);
  });

  it("returns ~0 for flat values", () => {
    const result = linearSlope([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(result).toBeCloseTo(0, 5);
  });

  it("returns 0 for constant values", () => {
    expect(linearSlope([10, 10, 10])).toBe(0);
  });
});

// ─── formatBurnoutReport ─────────────────────────────────────────────

describe("formatBurnoutReport", () => {
  type BurnoutResult = import("./burnout").BurnoutResult;
  type OverallBurnout = import("./burnout").OverallBurnout;
  let formatBurnoutReport: (r: OverallBurnout) => string;

  beforeAll(async () => {
    const mod = await import("./burnout");
    formatBurnoutReport = mod.formatBurnoutReport;
  });

  function makeBurnoutResult(overrides: Partial<BurnoutResult> = {}): BurnoutResult {
    return {
      domainId: "deep-work",
      label: "Deep Work",
      icon: "🧠",
      risk: "low",
      riskScore: 0,
      factors: { consistencyDrop: 0, variability: 0, moodTrend: null },
      recentConsistency: 0,
      baselineConsistency: 0,
      ...overrides,
    };
  }

  function makeOverall(overrides: Partial<OverallBurnout> = {}): OverallBurnout {
    return {
      risk: "low",
      riskScore: 0,
      domains: [],
      contributingDomains: [],
      ...overrides,
    };
  }

  it("shows low risk with green indicator", () => {
    const result = makeOverall({
      risk: "low",
      riskScore: 0.05,
      domains: [makeBurnoutResult()],
    });
    const output = formatBurnoutReport(result);
    expect(output).toContain("🟢");
    expect(output).toContain("Burnout Risk: LOW");
    expect(output).toContain("5%");
    expect(output).toContain("No burnout indicators detected");
  });

  it("shows moderate risk with yellow indicator", () => {
    const result = makeOverall({
      risk: "moderate",
      riskScore: 0.35,
      domains: [
        makeBurnoutResult({
          domainId: "deep-work",
          label: "Deep Work",
          icon: "🧠",
          risk: "moderate",
          riskScore: 0.35,
          factors: { consistencyDrop: 0.3, variability: 0.25, moodTrend: null },
          recentConsistency: 0.5,
          baselineConsistency: 0.8,
        }),
      ],
      contributingDomains: ["Deep Work"],
    });
    const output = formatBurnoutReport(result);
    expect(output).toContain("🟡");
    expect(output).toContain("Burnout Risk: MODERATE");
    expect(output).toContain("Deep Work");
    expect(output).toContain("Drop: 30%");
    expect(output).toContain("Variability: 25%");
    expect(output).toContain("Recent: 50.0%");
    expect(output).toContain("Baseline: 80.0%");
    expect(output).toContain("Contributing domains:");
    expect(output).toContain("Some risk factors detected");
  });

  it("shows high risk with red indicator", () => {
    const result = makeOverall({
      risk: "high",
      riskScore: 0.72,
      domains: [
        makeBurnoutResult({
          domainId: "deep-work",
          label: "Deep Work",
          icon: "🧠",
          risk: "high",
          riskScore: 0.72,
          factors: { consistencyDrop: 0.6, variability: 0.5, moodTrend: -0.05 },
          recentConsistency: 0.3,
          baselineConsistency: 0.9,
        }),
      ],
      contributingDomains: ["Deep Work"],
    });
    const output = formatBurnoutReport(result);
    expect(output).toContain("🔴");
    expect(output).toContain("Burnout Risk: HIGH");
    expect(output).toContain("Drop: 60%");
    expect(output).toContain("Variability: 50%");
    expect(output).toContain("Mood: -0.050");
    expect(output).toContain("Prioritize recovery and rest");
  });

  it("includes mood trend data when present", () => {
    const result = makeOverall({
      risk: "moderate",
      riskScore: 0.3,
      domains: [
        makeBurnoutResult({
          domainId: "mood",
          label: "Mood",
          icon: "🎯",
          risk: "moderate",
          riskScore: 0.3,
          factors: { consistencyDrop: 0.2, variability: 0.15, moodTrend: -0.08 },
          recentConsistency: 0.6,
          baselineConsistency: 0.8,
        }),
      ],
    });
    const output = formatBurnoutReport(result);
    expect(output).toContain("📉 Mood:");
    expect(output).toContain("-0.080");
  });

  it("shows positive mood trend with improving arrow", () => {
    const result = makeOverall({
      risk: "low",
      riskScore: 0.1,
      domains: [
        makeBurnoutResult({
          domainId: "mood",
          label: "Mood",
          icon: "🎯",
          risk: "low",
          riskScore: 0.1,
          factors: { consistencyDrop: 0.05, variability: 0.1, moodTrend: 0.12 },
          recentConsistency: 0.8,
          baselineConsistency: 0.7,
        }),
      ],
    });
    const output = formatBurnoutReport(result);
    expect(output).toContain("📈 Mood:");
    expect(output).toContain("0.120");
  });

  it("handles empty domains gracefully", () => {
    const result = makeOverall();
    const output = formatBurnoutReport(result);
    expect(output).toContain("LOW");
    expect(output).toContain("Keep it up");
  });

  it("handles multiple domains with mixed risks", () => {
    const result = makeOverall({
      risk: "moderate",
      riskScore: 0.3,
      domains: [
        makeBurnoutResult({
          domainId: "deep-work",
          label: "Deep Work",
          risk: "high",
          riskScore: 0.6,
          factors: { consistencyDrop: 0.5, variability: 0.4, moodTrend: null },
          recentConsistency: 0.4,
          baselineConsistency: 0.9,
        }),
        makeBurnoutResult({
          domainId: "sleep",
          label: "Sleep",
          risk: "low",
          riskScore: 0.05,
          factors: { consistencyDrop: 0.05, variability: 0.02, moodTrend: null },
          recentConsistency: 0.85,
          baselineConsistency: 0.9,
        }),
        makeBurnoutResult({
          domainId: "gym",
          label: "Gym",
          icon: "💪",
          risk: "moderate",
          riskScore: 0.3,
          factors: { consistencyDrop: 0.2, variability: 0.3, moodTrend: null },
          recentConsistency: 0.6,
          baselineConsistency: 0.8,
        }),
      ],
      contributingDomains: ["Deep Work", "Gym"],
    });
    const output = formatBurnoutReport(result);
    expect(output).toContain("Deep Work");
    expect(output).toContain("Sleep");
    expect(output).toContain("Gym");
    expect(output).toContain("Deep Work, Gym");
    expect(output).toContain("Contributing domains:");
  });

  it("does not show factors detail when riskScore is 0", () => {
    const result = makeOverall({
      domains: [
        makeBurnoutResult({
          label: "Deep Work",
          riskScore: 0,
        }),
      ],
    });
    const output = formatBurnoutReport(result);
    expect(output).not.toContain("Drop:");
    expect(output).not.toContain("Recent:");
  });
});

// ─── formatBurnoutReportTerminal ─────────────────────────────────────

describe("formatBurnoutReportTerminal", () => {
  type BurnoutResult = import("./burnout").BurnoutResult;
  type OverallBurnout = import("./burnout").OverallBurnout;
  let formatBurnoutReportTerminal: (r: OverallBurnout) => string;
  let formatBurnoutReport: (r: OverallBurnout) => string;

  beforeAll(async () => {
    const mod = await import("./burnout");
    formatBurnoutReportTerminal = mod.formatBurnoutReportTerminal;
    formatBurnoutReport = mod.formatBurnoutReport;
  });

  function makeBurnoutResult(overrides: Partial<BurnoutResult> = {}): BurnoutResult {
    return {
      domainId: "deep-work",
      label: "Deep Work",
      icon: "🧠",
      risk: "low",
      riskScore: 0,
      factors: { consistencyDrop: 0, variability: 0, moodTrend: null },
      recentConsistency: 0,
      baselineConsistency: 0,
      ...overrides,
    };
  }

  function makeOverall(overrides: Partial<OverallBurnout> = {}): OverallBurnout {
    return {
      risk: "low",
      riskScore: 0,
      domains: [],
      contributingDomains: [],
      ...overrides,
    };
  }

  it("replaces <b> with ANSI bold escape codes", () => {
    const result = makeOverall({
      risk: "low",
      riskScore: 0,
    });
    const output = formatBurnoutReportTerminal(result);
    expect(output).toContain("\x1b[1m");
    expect(output).toContain("\x1b[22m");
    expect(output).not.toContain("<b>");
    expect(output).not.toContain("</b>");
  });

  it("strips <i> tags entirely", () => {
    const result = makeOverall({
      risk: "moderate",
      riskScore: 0.3,
      domains: [
        makeBurnoutResult({
          label: "Test",
          risk: "moderate",
          riskScore: 0.3,
          factors: { consistencyDrop: 0.2, variability: 0.15, moodTrend: null },
          recentConsistency: 0.6,
          baselineConsistency: 0.8,
        }),
      ],
    });
    const output = formatBurnoutReportTerminal(result);
    expect(output).not.toContain("<i>");
    expect(output).not.toContain("</i>");
  });

  it("preserves readable content after stripping HTML", () => {
    const result = makeOverall({
      risk: "moderate",
      riskScore: 0.35,
      domains: [
        makeBurnoutResult({
          label: "Deep Work",
          risk: "moderate",
          riskScore: 0.35,
          factors: { consistencyDrop: 0.3, variability: 0.25, moodTrend: null },
          recentConsistency: 0.5,
          baselineConsistency: 0.8,
        }),
      ],
      contributingDomains: ["Deep Work"],
    });
    const output = formatBurnoutReportTerminal(result);
    expect(output).toContain("Deep Work");
    expect(output).toContain("Drop:");
    expect(output).toContain("Variability:");
    expect(output).toContain("Some risk factors detected");
  });
});

// ─── computeBurnoutRisk (integration) ──────────────────────────────────
// Uses dynamic imports so vi.resetModules() gives a fresh DB connection.
// Uses vi.useFakeTimers() for deterministic week boundary alignment.

describe("computeBurnoutRisk", () => {
  let tmpDir: string;
  let tempDbPath: string;

  beforeAll(async () => {
    // Fix current date to a Monday so week calculations are deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-06T12:00:00.000Z")); // Monday

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lqd-burnout-"));
    tempDbPath = path.join(tmpDir, "test.db");
    process.env.DB_PATH = tempDbPath;
    await createTables();
  });

  afterAll(() => {
    vi.useRealTimers();
    delete process.env.DB_PATH;
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  async function createTables() {
    const client = createClient({ url: `file:${tempDbPath}` });
    for (const stmt of CREATE_TABLES_SQL.split(";").map(s => s.trim()).filter(Boolean)) {
      await client.execute(stmt);
    }
    client.close();
  }

  async function clearData() {
    const client = createClient({ url: `file:${tempDbPath}` });
    for (const stmt of CLEAR_DATA_SQL.split(";").map(s => s.trim()).filter(Boolean)) {
      await client.execute(stmt);
    }
    client.close();
  }

  beforeEach(async () => {
    await clearData();
  });

  /**
   * Seed a domain + events with explicit day-of-week timestamps.
   * Week 0 = most recent week (Jan 6-12, 2025), week N = N weeks before.
   */
  async function seedWeekPattern(
    domainId: string,
    label: string,
    icon: string | null,
    maxValue: number,
    weekPatterns: Record<number, number>[], // one per week: { dayOfWeek: value }
  ) {
    const client = createClient({ url: `file:${tempDbPath}` });
    const ddb = drizzle(client);

    await ddb
      .insert(schema.domains)
      .values({
        id: domainId,
        label,
        icon,
        type: "numeric",
        maxValue,
        archived: false,
      })
      .run();

    for (let w = 0; w < weekPatterns.length; w++) {
      const pattern = weekPatterns[w];
      for (const [dayOfWeek, value] of Object.entries(pattern)) {
        if (value > 0) {
          const dayOffset = parseInt(dayOfWeek);
          const eventDate = new Date("2025-01-06T12:00:00.000Z");
          eventDate.setDate(eventDate.getDate() - w * 7 + dayOffset);
          const timestamp = eventDate.toISOString();

          await ddb
            .insert(schema.events)
            .values({
              id: crypto.randomUUID(),
              domainId,
              timestamp,
              value,
              source: "manual",
              note: null,
            })
            .run();
        }
      }
    }

    client.close();
  }

  it("returns low risk for consistent high-engagement data", async () => {
    const weeks: Record<number, number>[] = [];
    for (let w = 0; w < 8; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 8;
      weeks.push(pattern);
    }
    await seedWeekPattern("deep-work", "Deep Work", "🧠", 10, weeks);

    vi.resetModules();
    const mod = await import("./burnout");
    const result = await mod.computeBurnoutRisk("deep-work");

    expect(result.risk).toBe("low");
    expect(result.riskScore).toBeLessThan(0.25);
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0].label).toBe("Deep Work");
    expect(result.contributingDomains).toHaveLength(0);
  });

  it("returns high risk for declining/sporadic data", async () => {
    // fetchWeeklyEvents returns weeks from oldest (idx 0) to newest (idx 7).
    // So seed w=0-1 (sporadic, low) goes to oldest weeks (idx 0-1),
    // and seed w=2-7 (consistent, high) goes to recent weeks (idx 2-7).
    // This means recent > baseline → consistencyDrop = 0 → NOT high risk.
    // 
    // For high risk we need: recent < baseline.
    // So seed: w=0-5 (high, consistent) → goes to OLDEST 6 weeks = baseline
    //         w=6-7 (sporadic, low) → goes to RECENT 2 weeks
    // But since seed w=0 maps to the most recent fetch slot (idx 7),
    // we must REVERSE: first part of seed array goes to newest fetch slots.
    //
    // Seed order: oldest-first in fetch = last in seed array.
    // For the test: first 2 seed entries (w=0,1) → newest = recent
    //               last 6 seed entries (w=2-7) → oldest = baseline
    // We want recent LOW, baseline HIGH, so:
    //   first 2 seed entries: low/sporadic (value 2 on Mon/Wed)
    //   last 6 seed entries: high/consistent (daily value 8)
    const weeks: Record<number, number>[] = [];
    // Recent 2 weeks (w=0,1 → newest fetch slots): sporadic, low
    for (let w = 0; w < 2; w++) {
      weeks.push({ 0: 2, 2: 2 });
    }
    // Baseline 6 weeks (w=2-7 → oldest fetch slots): consistent, high
    for (let w = 0; w < 6; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 8;
      weeks.push(pattern);
    }
    await seedWeekPattern("sleep", "Sleep", "🌙", 10, weeks);

    vi.resetModules();
    const mod = await import("./burnout");
    const result = await mod.computeBurnoutRisk("sleep");

    expect(result.risk).toBe("high");
    expect(result.riskScore).toBeGreaterThanOrEqual(0.5);
    expect(result.domains[0].label).toBe("Sleep");
  });

  it("returns low risk when there are fewer than 3 active weeks", async () => {
    const weeks: Record<number, number>[] = [];
    for (let w = 0; w < 2; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 5;
      weeks.push(pattern);
    }
    await seedWeekPattern("reading", "Reading", "📚", 10, weeks);

    vi.resetModules();
    const mod = await import("./burnout");
    const result = await mod.computeBurnoutRisk("reading");

    expect(result.risk).toBe("low");
    expect(result.riskScore).toBe(0);
    expect(result.domains[0].risk).toBe("low");
    expect(result.domains[0].riskScore).toBe(0);
  });

  it("includes mood domain analysis when mood data is present", async () => {
    // fetchWeeklyEvents returns oldest→newest. seedWeekPattern's first entries
    // (w=0,1,2) go to newest fetch slots. Last entries go to oldest.
    // We want: recent LOW, oldest HIGH → declining trend.
    // So seed: first entries = low, last entries = high.
    const weeks: Record<number, number>[] = [];
    // Recent 2 weeks (seed w=0,1 → newest fetch): daily at 2 (low)
    for (let w = 0; w < 2; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 2;
      weeks.push(pattern);
    }
    // Middle 3 weeks (seed w=2-4): daily at 5 (medium)
    for (let w = 0; w < 3; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 5;
      weeks.push(pattern);
    }
    // Oldest 3 weeks (seed w=5-7 → oldest fetch): daily at 9 (high)
    for (let w = 0; w < 3; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 9;
      weeks.push(pattern);
    }
    await seedWeekPattern("mood", "Mood", "🎯", 10, weeks);

    vi.resetModules();
    const mod = await import("./burnout");
    const result = await mod.computeBurnoutRisk("mood");

    expect(result.domains[0].domainId).toBe("mood");
    expect(result.domains[0].factors.moodTrend).not.toBeNull();
    if (result.domains[0].factors.moodTrend !== null) {
      // Declining mood (recent lower than oldest) → negative slope
      expect(result.domains[0].factors.moodTrend).toBeLessThan(0);
    }
  });

  it("handles multiple domains and identifies top contributors", async () => {
    // Sleep: consistent (daily at 7) → low risk
    const sleepWeeks: Record<number, number>[] = [];
    for (let w = 0; w < 8; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 7;
      sleepWeeks.push(pattern);
    }
    await seedWeekPattern("sleep", "Sleep", "🌙", 10, sleepWeeks);

    // Deep Work: also consistent (daily at 8) → low risk
    const dwWeeks: Record<number, number>[] = [];
    for (let w = 0; w < 8; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 8;
      dwWeeks.push(pattern);
    }
    await seedWeekPattern("deep-work", "Deep Work", "🧠", 10, dwWeeks);

    vi.resetModules();
    const mod = await import("./burnout");
    const result = await mod.computeBurnoutRisk();

    expect(result.domains.length).toBe(2);
    expect(result.domains[0].risk).toBe("low");
    expect(result.domains[1].risk).toBe("low");
    expect(result.contributingDomains).toHaveLength(0);
    // Both should have low risk (< 0.25) with positive riskScore due to default mood risk
    for (const domain of result.domains) {
      expect(domain.riskScore).toBeGreaterThan(0);
      expect(domain.riskScore).toBeLessThan(0.25);
    }
  });

  it("computes overall average across all domains", async () => {
    // Deep Work: 8 weeks, daily at 8
    const dwWeeks: Record<number, number>[] = [];
    for (let w = 0; w < 8; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 8;
      dwWeeks.push(pattern);
    }
    await seedWeekPattern("deep-work", "Deep Work", "🧠", 10, dwWeeks);

    // Sleep: 8 weeks, daily at 5
    const sleepWeeks: Record<number, number>[] = [];
    for (let w = 0; w < 8; w++) {
      const pattern: Record<number, number> = {};
      for (let d = 0; d < 7; d++) pattern[d] = 5;
      sleepWeeks.push(pattern);
    }
    await seedWeekPattern("sleep", "Sleep", "🌙", 10, sleepWeeks);

    vi.resetModules();
    const mod = await import("./burnout");
    const result = await mod.computeBurnoutRisk();

    const scoredDomains = result.domains.filter((d: { riskScore: number }) => d.riskScore > 0);
    const expectedOverall =
      scoredDomains.length > 0
        ? scoredDomains.reduce((a: number, d: { riskScore: number }) => a + d.riskScore, 0) /
          scoredDomains.length
        : 0;
    expect(result.riskScore).toBeCloseTo(expectedOverall, 2);
  });
});
