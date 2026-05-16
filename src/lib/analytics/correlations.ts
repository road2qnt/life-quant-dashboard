import { eq, and, gte } from "drizzle-orm";
import { db, schema } from "../db";

export interface CorrelationResult {
  domainA: string;
  domainB: string;
  pearsonR: number;
  sampleSize: number;
  significance: number;
}

type DailyValue = { date: string; value: number };

function getDailyValues(events: { value: number; timestamp: string }[]): DailyValue[] {
  const byDate = new Map<string, number[]>();
  for (const e of events) {
    const date = e.timestamp.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(e.value);
  }
  const result: DailyValue[] = [];
  for (const [date, values] of byDate) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    result.push({ date, value: avg });
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

function pearsonR(
  x: number[],
  y: number[],
): { r: number; n: number; p: number } {
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

  // Approximate p-value using t-distribution
  const t = Math.abs(clamped) * Math.sqrt((n - 2) / (1 - clamped * clamped));
  const p = 2 * (1 - studentT_CDF(t, n - 2));

  return { r: clamped, n, p };
}

function studentT_CDF(t: number, df: number): number {
  // Regularized incomplete beta function approximation
  const x = df / (df + t * t);
  return 1 - 0.5 * regularizedIncompleteBeta(df / 2, 0.5, x);
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x < 0 || x > 1) return 0;
  if (x === 0 || x === 1) return x;

  // Continued fraction approximation (Lentz's method)
  const fpmin = 1e-30;
  const aa = 1;
  let bb = 1;
  let del = 1;
  let ab = a + b;
  let apar = 1 + (b - 1) / (a + 1);

  // Use simpler approximation for common cases
  // This is a rough approximation sufficient for significance ranking
  let sum = 0;
  let term = 1;
  for (let i = 0; i < 100; i++) {
    term *= ((a + b + i) * x) / (a + 1 + i);
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }
  const result = (Math.pow(x, a) * Math.pow(1 - x, b)) / (a * betaFunc(a, b));
  return result * (1 + sum);
}

function betaFunc(a: number, b: number): number {
  return Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b));
}

function lgamma(x: number): number {
  // Stirling's approximation for log-gamma
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < c.length; i++) {
    a += c[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export async function fetchDomainDailyValues(
  domainId: string,
  days?: number,
): Promise<DailyValue[]> {
  const rangeStart = new Date();
  rangeStart.setDate(rangeStart.getDate() - (days ?? 365));
  const rangeStartStr = rangeStart.toISOString();

  const events = await db
    .select({ value: schema.events.value, timestamp: schema.events.timestamp })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.domainId, domainId),
        gte(schema.events.timestamp, rangeStartStr),
      ),
    )
    .all();

  return getDailyValues(events);
}

export async function computeCorrelation(
  domainA: string,
  domainB: string,
  days?: number,
): Promise<CorrelationResult> {
  const [valuesA, valuesB] = await Promise.all([
    fetchDomainDailyValues(domainA, days),
    fetchDomainDailyValues(domainB, days),
  ]);

  // Align by date
  const dateMapA = new Map(valuesA.map((v) => [v.date, v.value]));
  const dateMapB = new Map(valuesB.map((v) => [v.date, v.value]));

  const commonDates: string[] = [];
  for (const date of dateMapA.keys()) {
    if (dateMapB.has(date)) commonDates.push(date);
  }
  commonDates.sort();

  const x = commonDates.map((d) => dateMapA.get(d)!);
  const y = commonDates.map((d) => dateMapB.get(d)!);

  const { r, n, p } = pearsonR(x, y);

  return {
    domainA,
    domainB,
    pearsonR: Math.round(r * 1000) / 1000,
    sampleSize: n,
    significance: Math.round(p * 1000) / 1000,
  };
}

export async function computeAllCorrelations(
  domainA?: string,
  domainB?: string,
): Promise<CorrelationResult[]> {
  if (domainA && domainB) {
    const result = await computeCorrelation(domainA, domainB);
    // Store in DB
    const id = [domainA, domainB].sort().join("_");
    await db
      .insert(schema.correlations)
      .values({
        id,
        domainAId: domainA,
        domainBId: domainB,
        pearsonR: result.pearsonR,
        sampleSize: result.sampleSize,
        significance: result.significance,
        lagDays: 0,
        computedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.correlations.id,
        set: {
          pearsonR: result.pearsonR,
          sampleSize: result.sampleSize,
          significance: result.significance,
          computedAt: new Date().toISOString(),
        },
      })
      .run();
    return [result];
  }

  // Compute all pairs
  const domains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();

  const results: CorrelationResult[] = [];
  const domainIds = domains.map((d) => d.id);

  for (let i = 0; i < domainIds.length; i++) {
    for (let j = i + 1; j < domainIds.length; j++) {
      const result = await computeCorrelation(domainIds[i], domainIds[j]);
      const id = [domainIds[i], domainIds[j]].sort().join("_");

      await db
        .insert(schema.correlations)
        .values({
          id,
          domainAId: domainIds[i],
          domainBId: domainIds[j],
          pearsonR: result.pearsonR,
          sampleSize: result.sampleSize,
          significance: result.significance,
          lagDays: 0,
          computedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: schema.correlations.id,
          set: {
            pearsonR: result.pearsonR,
            sampleSize: result.sampleSize,
            significance: result.significance,
            computedAt: new Date().toISOString(),
          },
        })
        .run();

      results.push(result);
    }
  }

  return results;
}

export async function summarizeCorrelations(results: CorrelationResult[]): Promise<string> {
  const sorted = [...results].sort((a, b) => Math.abs(b.pearsonR) - Math.abs(a.pearsonR));

  // Resolve all domain icons in parallel
  const iconPromises = sorted.flatMap((r) => [awaitDomainIcon(r.domainA), awaitDomainIcon(r.domainB)]);
  const icons = await Promise.all(iconPromises);

  let output = `${bold("Cross-Domain Correlations")}\n\n`;
  let idx = 0;

  for (const r of sorted) {
    const strength =
      Math.abs(r.pearsonR) >= 0.7
        ? "strong"
        : Math.abs(r.pearsonR) >= 0.4
          ? "moderate"
          : Math.abs(r.pearsonR) >= 0.2
            ? "weak"
            : "none";

    const direction = r.pearsonR > 0 ? "+" : "";
    const sig = r.significance < 0.05 ? " *" : "";

    const iconA = icons[idx++];
    const iconB = icons[idx++];
    output += `  ${iconA} ${r.domainA} ↔ ${iconB} ${r.domainB}:  ${direction}${r.pearsonR.toFixed(3)} (${strength}, n=${r.sampleSize})${sig}\n`;
  }

  output += `\n  * p < 0.05 (statistically significant)`;
  return output;
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

const iconCache = new Map<string, string>();

async function awaitDomainIcon(domainId: string): Promise<string> {
  if (iconCache.has(domainId)) return iconCache.get(domainId)!;
  const domain = await db
    .select({ icon: schema.domains.icon })
    .from(schema.domains)
    .where(eq(schema.domains.id, domainId))
    .get();
  const icon = domain?.icon ?? "•";
  iconCache.set(domainId, icon);
  return icon;
}
