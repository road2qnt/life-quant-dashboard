import { describe, it, expect } from "vitest";

// Test the CSV line parser in isolation
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else if (char === "\r") {
        // skip
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

describe("parseCSVLine", () => {
  it("splits simple comma-separated values", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted values with commas", () => {
    expect(parseCSVLine('1,"hello, world",3')).toEqual(["1", "hello, world", "3"]);
  });

  it("handles double-quote escaping", () => {
    expect(parseCSVLine('1,"say ""hi""",2')).toEqual(["1", 'say "hi"', "2"]);
  });

  it("handles empty fields", () => {
    expect(parseCSVLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles trailing comma", () => {
    expect(parseCSVLine("a,b,")).toEqual(["a", "b", ""]);
  });

  it("skips carriage returns in a field", () => {
    expect(parseCSVLine("a,b\rc")).toEqual(["a", "bc"]);
  });

  it("handles single field", () => {
    expect(parseCSVLine("hello")).toEqual(["hello"]);
  });

  it("handles empty string", () => {
    expect(parseCSVLine("")).toEqual([""]);
  });

  it("handles quoted field with newline", () => {
    expect(parseCSVLine('"line1\nline2",value')).toEqual(["line1\nline2", "value"]);
  });
});
