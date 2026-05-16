import { describe, it, expect } from "vitest";
import { parseJSON, ImportError } from "./import";
import type { ExportData } from "./export";

describe("parseJSON", () => {
  it("parses valid export JSON", () => {
    const json = JSON.stringify({
      version: 1,
      exportedAt: "2026-05-16T00:00:00.000Z",
      domains: [{ id: "test", label: "Test", type: "numeric", createdAt: "", archived: false }],
      events: [],
      weeklySnapshots: [],
      correlations: [],
      agentMemory: [],
      config: [],
    });

    const data = parseJSON(json);
    expect(data.version).toBe(1);
    expect(data.domains).toHaveLength(1);
    expect(data.domains[0].id).toBe("test");
  });

  it("throws on unsupported version", () => {
    const json = JSON.stringify({
      version: 999,
      domains: [],
      events: [],
      weeklySnapshots: [],
      correlations: [],
      agentMemory: [],
      config: [],
    });

    expect(() => parseJSON(json)).toThrow(ImportError);
    expect(() => parseJSON(json)).toThrow("Unsupported export version");
  });

  it("throws on missing domains array", () => {
    const json = JSON.stringify({ version: 1 });
    expect(() => parseJSON(json)).toThrow(ImportError);
    expect(() => parseJSON(json)).toThrow("missing domains");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJSON("not json")).toThrow();
  });
});
