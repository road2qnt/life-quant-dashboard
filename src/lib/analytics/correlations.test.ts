import { describe, it, expect } from "vitest";

// Test the pure Pearson r function extracted from the module logic
function pearsonR(x: number[], y: number[]): { r: number; n: number; p: number } {
  const n = x.length;
  if (n < 3) return { r: 0, n, p: 1 };

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denomX = n * sumX2 - sumX * sumX;
  const denomY = n * sumY2 - sumY * sumY;
  const denominator = Math.sqrt(denomX * denomY);

  if (denominator === 0) return { r: 0, n, p: 1 };

  const r = numerator / denominator;
  const clamped = Math.max(-1, Math.min(1, r));

  const t = Math.abs(clamped) * Math.sqrt((n - 2) / (1 - clamped * clamped));
  const p = 2 * (1 - studentT_CDF(t, n - 2));

  return { r: clamped, n, p };
}

function studentT_CDF(t: number, df: number): number {
  const x = df / (df + t * t);
  return 1 - 0.5 * regularizedIncompleteBeta(df / 2, 0.5, x);
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x < 0 || x > 1) return 0;
  if (x === 0 || x === 1) return x;

  let sum = 0;
  let term = 1;
  for (let i = 0; i < 100; i++) {
    term *= ((a + b + i) * x) / (a + 1 + i);
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }
  const bot = betaFunc(a, b);
  if (bot === 0 || !isFinite(bot)) return x > 0.5 ? 1 : 0;
  const result = (Math.pow(x, a) * Math.pow(1 - x, b)) / (a * bot);
  return Math.min(1, Math.max(0, result * (1 + sum)));
}

function betaFunc(a: number, b: number): number {
  return Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b));
}

function lgamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let a = c[0];
  const t = x + 7 + 0.5;
  for (let i = 1; i < c.length; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

describe("pearsonR", () => {
  it("returns r=0 for fewer than 3 points", () => {
    expect(pearsonR([1, 2], [3, 4]).r).toBe(0);
    expect(pearsonR([1], [3]).r).toBe(0);
    expect(pearsonR([], []).r).toBe(0);
  });

  it("returns r=1 for perfect positive correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    const { r, n } = pearsonR(x, y);
    expect(n).toBe(5);
    expect(r).toBeCloseTo(1, 5);
  });

  it("returns r=-1 for perfect negative correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    const { r, n } = pearsonR(x, y);
    expect(n).toBe(5);
    expect(r).toBeCloseTo(-1, 5);
  });

  it("returns r≈0 for uncorrelated data", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
    const { r } = pearsonR(x, y);
    expect(Math.abs(r)).toBeLessThan(0.3);
  });

  it("returns reasonable r for moderate correlation", () => {
    // sleep (x) vs mood (y): weak-to-moderate positive
    const x = [5, 6, 7, 8, 9, 5, 6, 7, 8, 9];
    const y = [4, 5, 6, 7, 8, 3, 4, 5, 7, 8];
    const { r } = pearsonR(x, y);
    expect(r).toBeGreaterThan(0.6);
    expect(r).toBeLessThan(1);
  });

  it("returns n equal to input length", () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [2, 4, 6, 8, 10, 12];
    expect(pearsonR(x, y).n).toBe(6);
  });

  it("handles constant values (zero variance)", () => {
    const x = [5, 5, 5, 5, 5];
    const y = [1, 2, 3, 4, 5];
    const { r } = pearsonR(x, y);
    expect(r).toBe(0);
  });

  it("clamps to [-1, 1]", () => {
    const x = [1, 2, 3];
    const y = [10, 20, 30];
    const { r } = pearsonR(x, y);
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
  });
});
