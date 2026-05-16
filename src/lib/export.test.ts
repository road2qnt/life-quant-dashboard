import { describe, it, expect } from "vitest";
import { getExportStats } from "./export";
import type { ExportData } from "./export";

describe("getExportStats", () => {
  it("returns stats for populated data", () => {
    const data: ExportData = {
      version: 1,
      exportedAt: "2026-05-16T00:00:00.000Z",
      domains: [{
        id: "test", label: "Test", type: "numeric",
        icon: null, unit: null, minValue: 0, maxValue: 10,
        createdAt: "", archived: false,
      }],
      events: [{
        id: "1", domainId: "test", timestamp: "2026-01-01T00:00:00.000Z",
        value: 5, source: "manual", note: null, createdAt: "",
      }],
      weeklySnapshots: [{
        id: "s1", domainId: "test", weekStart: "2026-01-01",
        consistency: null, totalValue: null, numEvents: null,
        trend: null, metadata: null, createdAt: "",
      }],
      correlations: [{
        id: "c1", domainAId: "a", domainBId: "b",
        pearsonR: null, lagDays: null, sampleSize: null, significance: null, computedAt: "",
      }],
      agentMemory: [{
        id: "m1", type: "insight", content: "test", metadata: null, createdAt: "",
      }],
      config: [{ key: "k", value: "v", updatedAt: "" }],
    };

    const stats = getExportStats(data);
    expect(stats).toContain("Domains: 1");
    expect(stats).toContain("Events: 1");
    expect(stats).toContain("Weekly snapshots: 1");
    expect(stats).toContain("Correlations: 1");
    expect(stats).toContain("Agent memories: 1");
    expect(stats).toContain("Config entries: 1");
  });

  it("returns zero counts for empty data", () => {
    const data: ExportData = {
      version: 1,
      exportedAt: "2026-05-16T00:00:00.000Z",
      domains: [],
      events: [],
      weeklySnapshots: [],
      correlations: [],
      agentMemory: [],
      config: [],
    };

    const stats = getExportStats(data);
    expect(stats).toContain("Domains: 0");
    expect(stats).toContain("Events: 0");
  });
});
