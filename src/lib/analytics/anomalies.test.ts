import { describe, it, expect } from "vitest";
import {
  detectZScoreAnomalies,
  detectStreakAnomalies,
  detectContextualAnomalies,
  formatAnomalyReport,
  formatAnomalyReportTerminal,
  type ZScoreAnomaly,
  type StreakAnomaly,
  type ContextualAnomaly,
} from "./anomalies";
import type { OverallAnomalies, AnomalyResult } from "./anomalies";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeEvent(value: number, dateStr: string): { value: number; timestamp: string } {
  return { value, timestamp: `${dateStr}T12:00:00.000Z` };
}

/**
 * Build a minimal OverallAnomalies for formatting tests.
 */
function makeOverall(overrides: Partial<OverallAnomalies> = {}): OverallAnomalies {
  return {
    totalAnomalies: 0,
    domains: [],
    ...overrides,
  };
}

function makeDomainResult(overrides: Partial<AnomalyResult> = {}): AnomalyResult {
  return {
    domainId: "test",
    label: "Test",
    icon: null,
    zScoreAnomalies: [],
    streakAnomalies: [],
    contextualAnomalies: [],
    totalEvents: 0,
    anomalyCount: 0,
    ...overrides,
  };
}

// ─── detectZScoreAnomalies ────────────────────────────────────────────

describe("detectZScoreAnomalies", () => {
  it("returns empty for fewer than 3 events", () => {
    const events = [makeEvent(5, "2024-01-01"), makeEvent(6, "2024-01-02")];
    const result = detectZScoreAnomalies(events, 2.0);
    expect(result).toEqual([]);
  });

  it("returns empty for empty events", () => {
    const result = detectZScoreAnomalies([], 2.0);
    expect(result).toEqual([]);
  });

  it("returns empty when all values are identical (zero std)", () => {
    const events = [
      makeEvent(5, "2024-01-01"),
      makeEvent(5, "2024-01-02"),
      makeEvent(5, "2024-01-03"),
      makeEvent(5, "2024-01-04"),
    ];
    const result = detectZScoreAnomalies(events, 2.0);
    expect(result).toEqual([]);
  });

  it("detects z-score anomalies above the threshold", () => {
    // Values mostly around 5, with one outlier at 50
    const events = [
      makeEvent(5, "2024-01-01"),
      makeEvent(5, "2024-01-02"),
      makeEvent(4, "2024-01-03"),
      makeEvent(6, "2024-01-04"),
      makeEvent(5, "2024-01-05"),
      makeEvent(50, "2024-01-06"), // anomalous
      makeEvent(5, "2024-01-07"),
    ];
    const result = detectZScoreAnomalies(events, 2.0);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].value).toBe(50);
    expect(Math.abs(result[0].zScore)).toBeGreaterThan(2);
  });

  it("returns sorted by absolute z-score (most anomalous first)", () => {
    // Tight cluster of normal values + one extreme outlier
    const events = [
      makeEvent(50, "2024-01-01"),
      makeEvent(50, "2024-01-02"),
      makeEvent(50, "2024-01-03"),
      makeEvent(50, "2024-01-04"),
      makeEvent(50, "2024-01-05"),
      makeEvent(500, "2024-01-06"), // very anomalous
    ];
    const result = detectZScoreAnomalies(events, 2.0);
    expect(result.length).toBe(1);
    expect(result[0].value).toBe(500);
    expect(result[0].zScore).toBeGreaterThan(2);
  });

  it("does not flag values within normal range", () => {
    const events = [
      makeEvent(5, "2024-01-01"),
      makeEvent(5.1, "2024-01-02"),
      makeEvent(4.9, "2024-01-03"),
      makeEvent(5.2, "2024-01-04"),
      makeEvent(4.8, "2024-01-05"),
    ];
    const result = detectZScoreAnomalies(events, 2.0);
    expect(result).toEqual([]);
  });
});

// ─── detectStreakAnomalies ─────────────────────────────────────────────

describe("detectStreakAnomalies", () => {
  it("returns empty for fewer than 7 events", () => {
    const events = [
      makeEvent(5, "2024-01-01"),
      makeEvent(6, "2024-01-02"),
    ];
    const result = detectStreakAnomalies(events, 0.5, 3);
    expect(result).toEqual([]);
  });

  it("returns empty for empty events", () => {
    const result = detectStreakAnomalies([], 0.5, 3);
    expect(result).toEqual([]);
  });

  it("detects a low-effort streak", () => {
    // 7 days: 3 high, then 4 low in a row
    const events = [
      makeEvent(8, "2024-01-01"),
      makeEvent(8, "2024-01-02"),
      makeEvent(8, "2024-01-03"),
      makeEvent(1, "2024-01-04"), // streak starts
      makeEvent(1, "2024-01-05"), // streak
      makeEvent(2, "2024-01-06"), // streak
      makeEvent(1, "2024-01-07"), // streak
    ];
    const result = detectStreakAnomalies(events, 0.5, 3);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].streakDays).toBeGreaterThanOrEqual(3);
    // Personal average is (8+8+8+1+1+2+1) / 7 = 29/7 ≈ 4.14
    // 50% threshold = ~2.07. Values 1,1,2,1 are all below this.
  });

  it("does not flag short streaks below minStreakDays", () => {
    // 2 low days in a row should not be flagged with minStreakDays=3
    const events = [
      makeEvent(8, "2024-01-01"),
      makeEvent(8, "2024-01-02"),
      makeEvent(8, "2024-01-03"),
      makeEvent(8, "2024-01-04"),
      makeEvent(1, "2024-01-05"), // low
      makeEvent(1, "2024-01-06"), // low (streak of 2, < 3)
      makeEvent(8, "2024-01-07"),
    ];
    const result = detectStreakAnomalies(events, 0.5, 3);
    expect(result).toEqual([]);
  });

  it("handles uniformly low values (no streak anomaly because personal average is also low)", () => {
    // When ALL values are uniformly low, the personal average matches them
    // so there's no "drop" to flag as a streak anomaly
    const events = [
      makeEvent(1, "2024-01-01"),
      makeEvent(1, "2024-01-02"),
      makeEvent(1, "2024-01-03"),
      makeEvent(1, "2024-01-04"),
      makeEvent(1, "2024-01-05"),
      makeEvent(1, "2024-01-06"),
      makeEvent(1, "2024-01-07"),
    ];
    const result = detectStreakAnomalies(events, 0.5, 3);
    // Personal average is 1, threshold = 0.5. All values (1) > 0.5, so no streak
    expect(result).toEqual([]);
  });
});

// ─── detectContextualAnomalies ─────────────────────────────────────────

describe("detectContextualAnomalies", () => {
  it("returns empty for fewer than 7 events", () => {
    const events = [
      makeEvent(5, "2024-01-01"),
      makeEvent(6, "2024-01-02"),
    ];
    const result = detectContextualAnomalies(events, 2.0);
    expect(result).toEqual([]);
  });

  it("returns empty for empty events", () => {
    const result = detectContextualAnomalies([], 2.0);
    expect(result).toEqual([]);
  });

  it("detects deviations from day-of-week average with sufficient data", () => {
    // 8 weeks of consistent data + 1 anomalous Tuesday.
    // Tue values: [8,8,8,8,8,8,8,1], mean=8*7+1=57/9... but grouped by date,
    // each Tuesday contributes one daily-average of 8 except the last (1).
    // With sample std (n-1): mean=7.22, std≈2.33 → z=(1-7.22)/2.33≈-2.67 ✓
    const events: { value: number; timestamp: string }[] = [];
    // 2024-01-01 is a Monday. Lay down 8 full weeks at value 5.
    for (let week = 0; week < 8; week++) {
      for (let day = 0; day < 7; day++) {
        const d = new Date(Date.UTC(2024, 0, 1 + week * 7 + day));
        const dateStr = d.toISOString().slice(0, 10);
        events.push(makeEvent(5, dateStr));
      }
    }
    // Bump every Tuesday (day-of-week 1) to 8 to establish a strong baseline.
    for (let week = 0; week < 8; week++) {
      const d = new Date(Date.UTC(2024, 0, 2 + week * 7)); // Tuesdays
      const dateStr = d.toISOString().slice(0, 10);
      events.push(makeEvent(8, dateStr));
    }
    // Overwrite the last Tuesday with an anomalous low value.
    events.push(makeEvent(1, new Date(Date.UTC(2024, 2, 12)).toISOString().slice(0, 10))); // 2024-03-12, Tue

    const result = detectContextualAnomalies(events, 2.0);

    expect(result.length).toBeGreaterThan(0);
    const anomaly = result[0];
    expect(anomaly.dayOfWeek).toBe("Tue");
    expect(anomaly.deviation).toBeLessThan(-2.0);
    expect(anomaly.date).toBe("2024-03-12");
  });

  it("does not flag values within normal day-of-week range", () => {
    // 8 weeks of perfectly consistent data — no anomalies expected.
    const events: { value: number; timestamp: string }[] = [];
    for (let week = 0; week < 8; week++) {
      for (let day = 0; day < 7; day++) {
        const d = new Date(Date.UTC(2024, 0, 1 + week * 7 + day));
        events.push(makeEvent(day % 2 === 0 ? 5 : 8, d.toISOString().slice(0, 10)));
      }
    }
    const result = detectContextualAnomalies(events, 2.0);
    expect(result).toEqual([]);
  });
});

// ─── formatAnomalyReport ──────────────────────────────────────────────

describe("formatAnomalyReport", () => {
  it("returns no-anomalies message for empty results", () => {
    const result = makeOverall({ totalAnomalies: 0, domains: [] });
    const output = formatAnomalyReport(result);
    expect(output).toContain("No anomalies detected");
  });

  it("includes domain names and z-score details", () => {
    const zAnomalies: ZScoreAnomaly[] = [
      { date: "2024-01-06", value: 50, zScore: 3.5, mean: 5, std: 1.2 },
    ];
    const result = makeOverall({
      totalAnomalies: 1,
      domains: [
        makeDomainResult({
          domainId: "deep-work",
          label: "Deep Work",
          icon: "🧠",
          zScoreAnomalies: zAnomalies,
          anomalyCount: 1,
          totalEvents: 20,
        }),
      ],
    });
    const output = formatAnomalyReport(result);
    expect(output).toContain("Deep Work");
    expect(output).toContain("z=3.50");
    expect(output).toContain("value: 50");
  });

  it("includes streak anomaly details", () => {
    const streak: StreakAnomaly[] = [
      {
        startDate: "2024-01-04",
        endDate: "2024-01-07",
        streakDays: 4,
        avgValueDuringStreak: 1.5,
        personalAverage: 7,
      },
    ];
    const result = makeOverall({
      totalAnomalies: 1,
      domains: [
        makeDomainResult({
          domainId: "sleep",
          label: "Sleep",
          icon: "🌙",
          streakAnomalies: streak,
          anomalyCount: 1,
          totalEvents: 30,
        }),
      ],
    });
    const output = formatAnomalyReport(result);
    expect(output).toContain("Sleep");
    expect(output).toContain("2024-01-04");
    expect(output).toContain("4d");
    expect(output).toContain("avg 1.5");
    expect(output).toContain("personal 7");
  });

  it("includes contextual anomaly details", () => {
    const contextual: ContextualAnomaly[] = [
      { date: "2024-01-15", dayOfWeek: "Mon", value: 1, dayAverage: 8, deviation: -2.5 },
    ];
    const result = makeOverall({
      totalAnomalies: 1,
      domains: [
        makeDomainResult({
          domainId: "deep-work",
          label: "Deep Work",
          icon: "🧠",
          contextualAnomalies: contextual,
          anomalyCount: 1,
          totalEvents: 21,
        }),
      ],
    });
    const output = formatAnomalyReport(result);
    expect(output).toContain("Mon");
    expect(output).toContain("value: 1 vs avg 8");
    expect(output).toContain("2.5σ below");
  });

  it("handles multiple domains with mixed anomaly types", () => {
    const result = makeOverall({
      totalAnomalies: 3,
      domains: [
        makeDomainResult({
          domainId: "deep-work",
          label: "Deep Work",
          icon: "🧠",
          zScoreAnomalies: [
            { date: "2024-01-06", value: 50, zScore: 3.5, mean: 5, std: 1.2 },
          ],
          streakAnomalies: [
            { startDate: "2024-01-04", endDate: "2024-01-07", streakDays: 4, avgValueDuringStreak: 1.5, personalAverage: 7 },
          ],
          contextualAnomalies: [
            { date: "2024-01-15", dayOfWeek: "Mon", value: 1, dayAverage: 8, deviation: -2.5 },
          ],
          totalEvents: 30,
          anomalyCount: 3,
        }),
      ],
    });
    const output = formatAnomalyReport(result);
    expect(output).toContain("Deep Work");
    expect(output).toContain("Z-score outliers");
    expect(output).toContain("Low-effort streaks");
    expect(output).toContain("Day-of-week deviations");
    expect(output).toContain("3 anomaly flags");
  });

  it("truncates long lists with '... and N more'", () => {
    const zAnomalies: ZScoreAnomaly[] = [];
    for (let i = 0; i < 10; i++) {
      zAnomalies.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        value: 50 + i,
        zScore: 3 + i * 0.1,
        mean: 5,
        std: 1.2,
      });
    }
    const result = makeOverall({
      totalAnomalies: 10,
      domains: [
        makeDomainResult({
          domainId: "test",
          label: "Test",
          zScoreAnomalies: zAnomalies,
          totalEvents: 100,
          anomalyCount: 10,
        }),
      ],
    });
    const output = formatAnomalyReport(result);
    expect(output).toContain("... and 5 more");
  });
});

// ─── formatAnomalyReportTerminal ──────────────────────────────────────

describe("formatAnomalyReportTerminal", () => {
  it("replaces <b> with ANSI bold escape codes", () => {
    const result = makeOverall({
      totalAnomalies: 0,
      domains: [makeDomainResult({ label: "Test" })],
    });
    const output = formatAnomalyReportTerminal(result);
    expect(output).toContain("\x1b[1m");
    expect(output).not.toContain("<b>");
  });

  it("strips <i> tags", () => {
    const result = makeOverall({
      totalAnomalies: 0,
      domains: [makeDomainResult({ label: "Test" })],
    });
    const output = formatAnomalyReportTerminal(result);
    expect(output).not.toContain("<i>");
    expect(output).not.toContain("</i>");
  });

  it("does not crash on empty results", () => {
    const result = makeOverall({ totalAnomalies: 0, domains: [] });
    const output = formatAnomalyReportTerminal(result);
    expect(output).toBeTruthy();
    expect(typeof output).toBe("string");
  });
});
