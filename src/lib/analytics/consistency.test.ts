import { describe, it, expect } from "vitest";
import {
  consistencyScore,
  weeklyConsistencyScores,
  trendDirection,
  cognitiveDrift,
  type EventData,
} from "./consistency";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeEvent(value: number, dateStr: string): EventData {
  return { value, timestamp: `${dateStr}T12:00:00.000Z` };
}

// ─── consistencyScore ─────────────────────────────────────────────────

describe("consistencyScore", () => {
  it("returns zero for empty events", () => {
    const result = consistencyScore([], 30, 10);
    expect(result).toEqual({
      consistency: 0,
      activeDays: 0,
      totalDays: 30,
      avgValue: 0,
    });
  });

  it("returns zero for zero totalDays", () => {
    const events = [makeEvent(5, "2024-01-01")];
    const result = consistencyScore(events, 0, 10);
    expect(result.consistency).toBe(0);
    expect(result.activeDays).toBe(0);
  });

  it("returns zero for zero maxValue", () => {
    const events = [makeEvent(5, "2024-01-01")];
    const result = consistencyScore(events, 30, 0);
    expect(result.consistency).toBe(0);
    expect(result.activeDays).toBe(0);
  });

  it("computes perfect consistency for max value every day", () => {
    const events: EventData[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date("2024-01-01");
      date.setDate(date.getDate() + d);
      events.push(makeEvent(10, date.toISOString().slice(0, 10)));
    }
    const result = consistencyScore(events, 7, 10);
    // frequency = 7/7 = 1, intensity = 10/10 = 1, consistency = 1
    expect(result.consistency).toBeCloseTo(1, 5);
    expect(result.activeDays).toBe(7);
    expect(result.avgValue).toBeCloseTo(10, 5);
  });

  it("penalizes missed days", () => {
    // 3 active days out of 7, value=10 each
    const events = [
      makeEvent(10, "2024-01-01"),
      makeEvent(10, "2024-01-03"),
      makeEvent(10, "2024-01-05"),
    ];
    const result = consistencyScore(events, 7, 10);
    // frequency = 3/7 ≈ 0.4286, intensity = 10/10 = 1, consistency ≈ 0.4286
    expect(result.consistency).toBeCloseTo(0.4286, 3);
    expect(result.activeDays).toBe(3);
  });

  it("penalizes low effort days", () => {
    // 7 active days but avg value is 3 out of 10
    const events: EventData[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date("2024-01-01");
      date.setDate(date.getDate() + d);
      events.push(makeEvent(3, date.toISOString().slice(0, 10)));
    }
    const result = consistencyScore(events, 7, 10);
    // frequency = 1, intensity = 3/10 = 0.3, consistency = 0.3
    expect(result.consistency).toBeCloseTo(0.3, 5);
    expect(result.avgValue).toBeCloseTo(3, 5);
  });

  it("counts unique days, not events", () => {
    // 2 events on same day, 1 event on another day = 2 active days
    const events = [
      makeEvent(5, "2024-01-01"),
      makeEvent(3, "2024-01-01"),
      makeEvent(7, "2024-01-02"),
    ];
    const result = consistencyScore(events, 7, 10);
    expect(result.activeDays).toBe(2);
    // avgValue = (5+3+7)/3 = 5
    expect(result.avgValue).toBeCloseTo(5, 5);
  });

  it("caps consistency at 1.0", () => {
    // 7 active days, avg value 12 > maxValue 10
    const events: EventData[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date("2024-01-01");
      date.setDate(date.getDate() + d);
      events.push(makeEvent(12, date.toISOString().slice(0, 10)));
    }
    const result = consistencyScore(events, 7, 10);
    expect(result.consistency).toBe(1);
  });

  it("handles single event correctly", () => {
    const result = consistencyScore([makeEvent(8, "2024-06-15")], 30, 10);
    expect(result.activeDays).toBe(1);
    expect(result.avgValue).toBeCloseTo(8, 5);
    // frequency = 1/30, intensity = 8/10 = 0.8
    expect(result.consistency).toBeCloseTo(0.0267, 3);
  });
});

// ─── weeklyConsistencyScores ──────────────────────────────────────────

describe("weeklyConsistencyScores", () => {
  it("returns correct number of weeks", () => {
    const events = [makeEvent(5, "2024-06-15")];
    const scores = weeklyConsistencyScores(events, 10, 4);
    expect(scores).toHaveLength(4);
  });

  it("each entry has weekStart and consistency", () => {
    const events = [makeEvent(5, "2024-06-15")];
    const scores = weeklyConsistencyScores(events, 10, 2);
    for (const s of scores) {
      expect(s).toHaveProperty("weekStart");
      expect(s).toHaveProperty("consistency");
      expect(typeof s.consistency).toBe("number");
      expect(s.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns zero consistency weeks for no events", () => {
    const scores = weeklyConsistencyScores([], 10, 3);
    expect(scores).toHaveLength(3);
    for (const s of scores) {
      expect(s.consistency).toBe(0);
    }
  });
});

// ─── trendDirection ───────────────────────────────────────────────────

describe("trendDirection", () => {
  it("returns 'insufficient' for fewer than 4 weeks", () => {
    expect(trendDirection([0.5, 0.6, 0.7])).toBe("insufficient");
    expect(trendDirection([])).toBe("insufficient");
    expect(trendDirection([0.8])).toBe("insufficient");
  });

  it("returns 'improving' for upward trend", () => {
    const scores = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    expect(trendDirection(scores)).toBe("improving");
  });

  it("returns 'declining' for downward trend", () => {
    const scores = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    expect(trendDirection(scores)).toBe("declining");
  });

  it("returns 'stable' for flat scores", () => {
    const scores = [0.5, 0.51, 0.49, 0.5, 0.52, 0.48];
    expect(trendDirection(scores)).toBe("stable");
  });

  it("returns 'stable' for alternating scores", () => {
    const scores = [0.5, 0.6, 0.5, 0.6, 0.5, 0.6];
    expect(trendDirection(scores)).toBe("stable");
  });
});

// ─── cognitiveDrift ───────────────────────────────────────────────────

describe("cognitiveDrift", () => {
  it("returns not detected for fewer than 12 weeks", () => {
    const scores = Array(11).fill(0.7);
    const result = cognitiveDrift(scores);
    expect(result.detected).toBe(false);
    expect(result.driftMagnitude).toBe(0);
    expect(result.weeksSinceDrift).toBe(0);
  });

  it("detects drift when recent 4 weeks are significantly lower", () => {
    // 12 weeks: first 8 at 0.8, last 4 at 0.5
    const scores = [...Array(8).fill(0.8), ...Array(4).fill(0.5)];
    const result = cognitiveDrift(scores);
    // baselineAvg (first 8) = 0.8, recentAvg (last 4) = 0.5
    // driftMagnitude = 0.8 - 0.5 = 0.3 > 0.15
    expect(result.detected).toBe(true);
    expect(result.driftMagnitude).toBeGreaterThan(0.15);
    expect(result.weeksSinceDrift).toBe(4);
  });

  it("does not detect drift when scores are consistent", () => {
    const scores = Array(12).fill(0.7);
    const result = cognitiveDrift(scores);
    expect(result.detected).toBe(false);
    expect(result.driftMagnitude).toBeLessThan(0.15);
  });

  it("does not detect drift for small decline", () => {
    // Recent 4 at 0.75 vs baseline 8 at 0.80 → driftMagnitude = 0.05 < 0.15
    const scores = [...Array(8).fill(0.8), ...Array(4).fill(0.75)];
    const result = cognitiveDrift(scores);
    expect(result.detected).toBe(false);
    expect(result.driftMagnitude).toBeCloseTo(0.05, 5);
  });
});
