import { describe, it, expect } from "vitest";

// Test the CSV escaping logic in isolation (the module uses DB, we test the escape logic)
function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

describe("CSV escaping", () => {
  it("returns empty string for null", () => {
    expect(escapeCSV(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCSV(undefined)).toBe("");
  });

  it("passes simple values through", () => {
    expect(escapeCSV("hello")).toBe("hello");
    expect(escapeCSV(42)).toBe("42");
    expect(escapeCSV(3.14)).toBe("3.14");
  });

  it("wraps values containing commas in quotes", () => {
    expect(escapeCSV("a,b")).toBe('"a,b"');
  });

  it("wraps values containing quotes and escapes them", () => {
    expect(escapeCSV('say "hello"')).toBe('"say ""hello"""');
  });

  it("wraps values containing newlines in quotes", () => {
    expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
  });

  it("handles number 0 correctly", () => {
    expect(escapeCSV(0)).toBe("0");
  });

  it("handles empty string", () => {
    expect(escapeCSV("")).toBe("");
  });
});
