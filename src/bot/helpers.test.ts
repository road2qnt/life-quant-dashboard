import { describe, it, expect } from "vitest";
import { escapeHtml, bold, code, dim, formatDateDisplay } from "./helpers";

// ─── escapeHtml ───────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes & to &amp;", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes < to &lt;", () => {
    expect(escapeHtml("<hello>")).toBe("&lt;hello&gt;");
  });

  it("escapes > to &gt;", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes all three special characters", () => {
    expect(escapeHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("does not modify strings without special characters", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
    expect(escapeHtml("12345")).toBe("12345");
    expect(escapeHtml("")).toBe("");
  });

  it("escapes multiple occurrences", () => {
    expect(escapeHtml("<<< >>> &&&")).toBe("&lt;&lt;&lt; &gt;&gt;&gt; &amp;&amp;&amp;");
  });
});

// ─── bold ─────────────────────────────────────────────────────────────

describe("bold", () => {
  it("wraps text in <b> tags", () => {
    expect(bold("hello")).toBe("<b>hello</b>");
  });

  it("escapes HTML in the input", () => {
    expect(bold("<test>")).toBe("<b>&lt;test&gt;</b>");
  });

  it("handles empty string", () => {
    expect(bold("")).toBe("<b></b>");
  });
});

// ─── code ─────────────────────────────────────────────────────────────

describe("code", () => {
  it("wraps text in <code> tags", () => {
    expect(code("npm test")).toBe("<code>npm test</code>");
  });

  it("escapes HTML in the input", () => {
    expect(code("<script>")).toBe("<code>&lt;script&gt;</code>");
  });

  it("handles empty string", () => {
    expect(code("")).toBe("<code></code>");
  });
});

// ─── dim ──────────────────────────────────────────────────────────────

describe("dim", () => {
  it("wraps text in <i> tags", () => {
    expect(dim("note")).toBe("<i>note</i>");
  });

  it("does not double-escape (expects pre-escaped input)", () => {
    expect(dim("&amp;")).toBe("<i>&amp;</i>");
  });

  it("handles empty string", () => {
    expect(dim("")).toBe("<i></i>");
  });
});

// ─── formatDateDisplay ────────────────────────────────────────────────

describe("formatDateDisplay", () => {
  it("formats a date in long English format", () => {
    const date = new Date("2024-12-25T12:00:00Z");
    const result = formatDateDisplay(date);
    expect(result).toBe("Wednesday, 25 December 2024");
  });

  it("formats first day of year", () => {
    const date = new Date("2024-01-01T00:00:00Z");
    const result = formatDateDisplay(date);
    expect(result).toBe("Monday, 1 January 2024");
  });

  it("formats last day of year", () => {
    const date = new Date("2024-12-31T12:00:00Z");
    const result = formatDateDisplay(date);
    expect(result).toBe("Tuesday, 31 December 2024");
  });

  it("formats mid-year date", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    const result = formatDateDisplay(date);
    expect(result).toBe("Saturday, 15 June 2024");
  });

  it("handles leap year date", () => {
    const date = new Date("2024-02-29T12:00:00Z");
    const result = formatDateDisplay(date);
    expect(result).toBe("Thursday, 29 February 2024");
  });
});
