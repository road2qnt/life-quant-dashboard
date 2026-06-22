import { eq, and, gte, lte } from "drizzle-orm";
import { db, schema } from "../db";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ZScoreAnomaly {
  date: string;
  value: number;
  zScore: number;
  mean: number;
  std: number;
}

export interface StreakAnomaly {
  startDate: string;
  endDate: string;
  streakDays: number;
  avgValueDuringStreak: number;
  personalAverage: number;
}

export interface ContextualAnomaly {
  date: string;
  dayOfWeek: string;
  value: number;
  dayAverage: number;
  deviation: number;
}

export interface AnomalyResult {
  domainId: string;
  label: string;
  icon: string | null;
  zScoreAnomalies: ZScoreAnomaly[];
  streakAnomalies: StreakAnomaly[];
  contextualAnomalies: ContextualAnomaly[];
  totalEvents: number;
  anomalyCount: number;
}

export interface OverallAnomalies {
  totalAnomalies: number;
  domains: AnomalyResult[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const squaredDiffs = values.map((v) => (v - m) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Group events by calendar date (YYYY-MM-DD).
 * Returns a map of date → array of values for that day.
 */
function groupByDate(
  events: { value: number; timestamp: string }[],
): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (const e of events) {
    const date = e.timestamp.slice(0, 10);
    const existing = byDate.get(date);
    if (existing) {
      existing.push(e.value);
    } else {
      byDate.set(date, [e.value]);
    }
  }
  return byDate;
}

/**
 * Get the day of the week (0=Mon..6=Sun) from a YYYY-MM-DD string.
 */
function getDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00.000Z");
  // getDay() returns 0=Sun..6=Sat, convert to 0=Mon..6=Sun
  return (d.getDay() + 6) % 7;
}

/**
 * Compute the average value per day per date.
 */
function dailyAverages(
  byDate: Map<string, number[]>,
): Map<string, number> {
  const daily = new Map<string, number>();
  for (const [date, values] of byDate) {
    daily.set(date, mean(values));
  }
  return daily;
}

// ─── Z-Score Anomaly Detection ─────────────────────────────────────────

/**
 * Detect events where |value - mean| / std > zThreshold.
 * Returns anomalies sorted by absolute z-score (most anomalous first).
 */
export function detectZScoreAnomalies(
  events: { value: number; timestamp: string }[],
  zThreshold: number,
): ZScoreAnomaly[] {
  if (events.length < 3) return [];

  const values = events.map((e) => e.value);
  const m = mean(values);
  const s = std(values);
  if (s === 0) return []; // No variance → no anomalies

  const anomalies: ZScoreAnomaly[] = [];
  for (const e of events) {
    const z = (e.value - m) / s;
    if (Math.abs(z) > zThreshold) {
      anomalies.push({
        date: e.timestamp.slice(0, 10),
        value: e.value,
        zScore: Math.round(z * 100) / 100,
        mean: Math.round(m * 100) / 100,
        std: Math.round(s * 100) / 100,
      });
    }
  }

  return anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

// ─── Streak Anomaly Detection ──────────────────────────────────────────

/**
 * Detect consecutive-day streaks where the daily value is below
 * a threshold fraction of the personal average.
 * Only flags streaks of minStreakDays or longer.
 */
export function detectStreakAnomalies(
  events: { value: number; timestamp: string }[],
  thresholdFraction: number,
  minStreakDays: number,
): StreakAnomaly[] {
  if (events.length < 7) return [];

  const byDate = groupByDate(events);
  const daily = dailyAverages(byDate);
  const allValues = Array.from(daily.values());
  const personalAvg = mean(allValues);
  if (personalAvg === 0) return [];

  const threshold = personalAvg * thresholdFraction;

  // Sort dates chronologically
  const sortedDates = Array.from(daily.keys()).sort();
  const streaks: StreakAnomaly[] = [];

  let streakStart: string | null = null;
  let streakValues: number[] = [];

  for (const date of sortedDates) {
    const avgValue = daily.get(date)!;
    if (avgValue < threshold) {
      if (streakStart === null) {
        streakStart = date;
      }
      streakValues.push(avgValue);
    } else {
      if (streakStart !== null && streakValues.length >= minStreakDays) {
        streaks.push({
          startDate: streakStart,
          endDate: sortedDates[sortedDates.indexOf(date) - 1],
          streakDays: streakValues.length,
          avgValueDuringStreak: Math.round(mean(streakValues) * 100) / 100,
          personalAverage: Math.round(personalAvg * 100) / 100,
        });
      }
      streakStart = null;
      streakValues = [];
    }
  }

  // Handle streak at the end of the data
  if (streakStart !== null && streakValues.length >= minStreakDays) {
    streaks.push({
      startDate: streakStart,
      endDate: sortedDates[sortedDates.length - 1],
      streakDays: streakValues.length,
      avgValueDuringStreak: Math.round(mean(streakValues) * 100) / 100,
      personalAverage: Math.round(personalAvg * 100) / 100,
    });
  }

  return streaks;
}

// ─── Contextual Anomaly Detection ──────────────────────────────────────

/**
 * Detect events where the value deviates significantly from the
 * day-of-week average. Deviation is measured in multiples of the
 * day-of-week std.
 */
export function detectContextualAnomalies(
  events: { value: number; timestamp: string }[],
  deviationThreshold: number,
): ContextualAnomaly[] {
  if (events.length < 7) return [];

  const byDate = groupByDate(events);
  const daily = dailyAverages(byDate);

  // Compute per-day-of-week stats
  const dowValues: number[][] = [[], [], [], [], [], [], []];
  for (const [date, avgValue] of daily) {
    const dow = getDayOfWeek(date);
    dowValues[dow].push(avgValue);
  }

  const dowMeans = dowValues.map((vals) => mean(vals));
  const dowStd = dowValues.map((vals) => std(vals));

  const anomalies: ContextualAnomaly[] = [];
  for (const [date, avgValue] of daily) {
    const dow = getDayOfWeek(date);
    const dayMean = dowMeans[dow];
    const daySigma = dowStd[dow];
    if (daySigma === 0) continue;

    const deviation = (avgValue - dayMean) / daySigma;
    if (Math.abs(deviation) > deviationThreshold) {
      anomalies.push({
        date,
        dayOfWeek: DAY_NAMES[dow],
        value: Math.round(avgValue * 100) / 100,
        dayAverage: Math.round(dayMean * 100) / 100,
        deviation: Math.round(deviation * 100) / 100,
      });
    }
  }

  return anomalies.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
}

// ─── Main anomaly computation ──────────────────────────────────────────

export async function detectAnomalies(
  domainId?: string,
  days: number = 90,
  zThreshold: number = 2.0,
  streakThreshold: number = 0.5,
  minStreakDays: number = 3,
  contextualThreshold: number = 2.0,
): Promise<OverallAnomalies> {
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - days);
  const rangeStartStr = rangeStart.toISOString();

  // Fetch domains
  const domains = domainId
    ? await db
        .select({
          id: schema.domains.id,
          label: schema.domains.label,
          icon: schema.domains.icon,
        })
        .from(schema.domains)
        .where(and(eq(schema.domains.id, domainId), eq(schema.domains.archived, false)))
        .all()
    : await db
        .select({
          id: schema.domains.id,
          label: schema.domains.label,
          icon: schema.domains.icon,
        })
        .from(schema.domains)
        .where(eq(schema.domains.archived, false))
        .all();

  const results: AnomalyResult[] = [];
  let totalAnomalies = 0;

  for (const domain of domains) {
    const events = await db
      .select({ value: schema.events.value, timestamp: schema.events.timestamp })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.domainId, domain.id),
          gte(schema.events.timestamp, rangeStartStr),
        ),
      )
      .all();

    if (events.length < 3) {
      results.push({
        domainId: domain.id,
        label: domain.label,
        icon: domain.icon,
        zScoreAnomalies: [],
        streakAnomalies: [],
        contextualAnomalies: [],
        totalEvents: events.length,
        anomalyCount: 0,
      });
      continue;
    }

    const zScoreAnomalies = detectZScoreAnomalies(events, zThreshold);
    const streakAnomalies = detectStreakAnomalies(events, streakThreshold, minStreakDays);
    const contextualAnomalies = detectContextualAnomalies(events, contextualThreshold);

    // Deduplicate: a streak anomaly may include events also flagged as z-score anomalies
    // We count unique anomaly types, not individual events
    const anomalyCount =
      zScoreAnomalies.length +
      streakAnomalies.length +
      contextualAnomalies.length;

    totalAnomalies += anomalyCount;

    results.push({
      domainId: domain.id,
      label: domain.label,
      icon: domain.icon,
      zScoreAnomalies,
      streakAnomalies,
      contextualAnomalies,
      totalEvents: events.length,
      anomalyCount,
    });
  }

  return { totalAnomalies, domains: results };
}

// ─── Formatting for display ─────────────────────────────────────────────

export function formatAnomalyReport(result: OverallAnomalies): string {
  if (result.totalAnomalies === 0) {
    return `✅ <b>No anomalies detected</b> across ${result.domains.length} domain${result.domains.length !== 1 ? "s" : ""}.\n\nAll values within normal range.`;
  }

  let output = `🔍 <b>Anomaly Report</b> — ${result.totalAnomalies} flag${result.totalAnomalies !== 1 ? "s" : ""} found\n\n`;

  for (const d of result.domains) {
    const icon = d.icon ?? "•";
    output += `${icon} <b>${d.label}</b>  (${d.totalEvents} events, ${d.anomalyCount} anomaly flags)\n`;

    if (d.zScoreAnomalies.length > 0) {
      output += `  ✦ <b>Z-score outliers:</b>\n`;
      for (const a of d.zScoreAnomalies.slice(0, 5)) {
        const direction = a.value > a.mean ? "🔺 high" : "🔻 low";
        output += `    ${a.date}  value: ${a.value}  z=${a.zScore.toFixed(2)}  (${direction})\n`;
      }
      if (d.zScoreAnomalies.length > 5) {
        output += `    ... and ${d.zScoreAnomalies.length - 5} more\n`;
      }
    }

    if (d.streakAnomalies.length > 0) {
      output += `  ⚡ <b>Low-effort streaks:</b>\n`;
      for (const s of d.streakAnomalies) {
        output += `    ${s.startDate} → ${s.endDate}  (${s.streakDays}d, avg ${s.avgValueDuringStreak} vs personal ${s.personalAverage})\n`;
      }
    }

    if (d.contextualAnomalies.length > 0) {
      output += `  🌓 <b>Day-of-week deviations:</b>\n`;
      for (const c of d.contextualAnomalies.slice(0, 3)) {
        const dir = c.deviation > 0 ? "above" : "below";
        output += `    ${c.date} (${c.dayOfWeek})  value: ${c.value} vs avg ${c.dayAverage}  (${Math.abs(c.deviation).toFixed(1)}σ ${dir})\n`;
      }
      if (d.contextualAnomalies.length > 3) {
        output += `    ... and ${d.contextualAnomalies.length - 3} more\n`;
      }
    }

    output += "\n";
  }

  return output;
}

export function formatAnomalyReportTerminal(result: OverallAnomalies): string {
  return formatAnomalyReport(result)
    .replace(/<b>/g, "\x1b[1m")
    .replace(/<\/b>/g, "\x1b[22m")
    .replace(/<i>/g, "")
    .replace(/<\/i>/g, "");
}
