import { eq, and, gte, lte } from "drizzle-orm";
import { db, schema } from "../db";
import { consistencyScore } from "./consistency";

// ─── Types ──────────────────────────────────────────────────────────────

export interface BurnoutFactors {
  consistencyDrop: number;  // 1 - (recent / baseline)
  variability: number;      // coefficient of variation (std / mean)
  moodTrend: number | null; // slope of mood domain, if tracked
}

export interface BurnoutResult {
  domainId: string;
  label: string;
  icon: string | null;
  risk: "low" | "moderate" | "high";
  riskScore: number;
  factors: BurnoutFactors;
  recentConsistency: number;
  baselineConsistency: number;
}

export interface OverallBurnout {
  risk: "low" | "moderate" | "high";
  riskScore: number;
  domains: BurnoutResult[];
  contributingDomains: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00.000Z");
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute coefficient of variation (std / mean).
 * Returns 0 if mean is 0 or array has fewer than 2 elements.
 */
function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

/**
 * Simple linear regression slope.
 */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const indices = values.map((_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  const numerator = indices.reduce((sum, x, i) => sum + (x - meanX) * (values[i] - meanY), 0);
  const denominator = indices.reduce((sum, x) => sum + (x - meanX) * (x - meanX), 0);
  return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Classify burnout risk score into low / moderate / high.
 */
function classifyRisk(score: number): "low" | "moderate" | "high" {
  if (score >= 0.5) return "high";
  if (score >= 0.25) return "moderate";
  return "low";
}

// ─── Fetch weekly events grouped by domain ──────────────────────────────

interface DomainInfo {
  id: string;
  label: string;
  icon: string | null;
  maxValue: number | null;
}

interface WeekEvents {
  weekStart: string;
  events: { value: number; timestamp: string }[];
}

async function fetchWeeklyEvents(
  domainId: string,
  weeks: number,
): Promise<WeekEvents[]> {
  const now = new Date();
  const weekStarts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weekStarts.push(getWeekStart(d));
  }

  const rangeStart = weekStarts[0];
  const rangeEnd = getWeekEnd(weekStarts[weekStarts.length - 1]);

  const allEvents = await db
    .select({ value: schema.events.value, timestamp: schema.events.timestamp })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.domainId, domainId),
        gte(schema.events.timestamp, rangeStart),
        lte(schema.events.timestamp, rangeEnd),
      ),
    )
    .all();

  return weekStarts.map((weekStart) => {
    const weekEnd = getWeekEnd(weekStart);
    const events = allEvents.filter((e) => {
      const date = e.timestamp.slice(0, 10);
      return date >= weekStart && date < weekEnd;
    });
    return { weekStart, events };
  });
}

// ─── Main burnout computation ───────────────────────────────────────────

export async function computeBurnoutRisk(
  domainId?: string,
): Promise<OverallBurnout> {
  const RECENT_WEEKS = 2;
  const BASELINE_WEEKS = 8;
  const TOTAL_WEEKS = BASELINE_WEEKS; // 8 weeks total

  // Fetch domains
  const domains: DomainInfo[] = domainId
    ? await db
        .select({
          id: schema.domains.id,
          label: schema.domains.label,
          icon: schema.domains.icon,
          maxValue: schema.domains.maxValue,
        })
        .from(schema.domains)
        .where(
          and(eq(schema.domains.id, domainId), eq(schema.domains.archived, false)),
        )
        .all()
    : await db
        .select({
          id: schema.domains.id,
          label: schema.domains.label,
          icon: schema.domains.icon,
          maxValue: schema.domains.maxValue,
        })
        .from(schema.domains)
        .where(eq(schema.domains.archived, false))
        .all();

  // Fetch mood trend separately (if mood domain exists)
  const moodDomain = domains.find((d) => d.id === "mood");
  let moodSlope: number | null = null;
  if (moodDomain) {
    const moodWeeks = await fetchWeeklyEvents("mood", TOTAL_WEEKS);
    const moodWeeklyScores = moodWeeks.map((w) => {
      const result = consistencyScore(w.events, 7, moodDomain.maxValue ?? 10);
      return result.consistency;
    });
    moodSlope = linearSlope(moodWeeklyScores);
  }

  const results: BurnoutResult[] = [];

  for (const domain of domains) {
    const weeks = await fetchWeeklyEvents(domain.id, TOTAL_WEEKS);
    const maxValue = domain.maxValue ?? 10;

    // Compute weekly consistency scores
    const weeklyScores = weeks.map((w) => {
      const result = consistencyScore(w.events, 7, maxValue);
      return result.consistency;
    });

    // Filter out weeks with no data for meaningful variance
    const activeWeeks = weeklyScores.filter((s) => s > 0);

    if (activeWeeks.length < 3) {
      // Not enough data to compute meaningful risk
      results.push({
        domainId: domain.id,
        label: domain.label,
        icon: domain.icon,
        risk: "low",
        riskScore: 0,
        factors: { consistencyDrop: 0, variability: 0, moodTrend: moodSlope },
        recentConsistency: 0,
        baselineConsistency: 0,
      });
      continue;
    }

    // Recent = last 2 weeks
    const recentScores = weeklyScores.slice(-RECENT_WEEKS).filter((s) => s > 0);
    // Baseline = weeks 3-8 (older 6 weeks)
    const baselineScores = weeklyScores.slice(0, -RECENT_WEEKS).filter((s) => s > 0);

    const recentConsistency =
      recentScores.length > 0
        ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length
        : 0;
    const baselineConsistency =
      baselineScores.length > 0
        ? baselineScores.reduce((a, b) => a + b, 0) / baselineScores.length
        : 0.001; // Avoid division by zero

    // Factor 1: Consistency drop (how far recent has fallen from baseline)
    const consistencyDrop = baselineConsistency > 0
      ? Math.max(0, 1 - recentConsistency / baselineConsistency)
      : 0;

    // Factor 2: Variability (coefficient of variation over recent weeks)
    const variability = coefficientOfVariation(activeWeeks);

    // Factor 3: Mood trend (negative slope = declining mood = risk factor)
    // Use domain-specific mood if this is the mood domain, otherwise use global moodSlope
    const effectiveMoodTrend =
      domain.id === "mood"
        ? linearSlope(weeklyScores)
        : moodSlope;

    // Normalize mood trend to [0, 1] where:
    //   positive slope → 0 (no risk — mood improving)
    //   slope near 0   → ~0.3 (neutral)
    //   negative slope → up to 1 (high risk — mood declining)
    const moodRisk =
      effectiveMoodTrend !== null
        ? Math.min(1, Math.max(0, 0.3 - effectiveMoodTrend * 10))
        : 0.15; // No mood data → mild default risk

    // Burnout risk score
    const riskScore =
      0.4 * consistencyDrop +
      0.3 * variability +
      0.3 * moodRisk;

    const clampedScore = Math.min(1, Math.max(0, riskScore));
    const risk = classifyRisk(clampedScore);

    results.push({
      domainId: domain.id,
      label: domain.label,
      icon: domain.icon,
      risk,
      riskScore: Math.round(clampedScore * 1000) / 1000,
      factors: {
        consistencyDrop: Math.round(consistencyDrop * 1000) / 1000,
        variability: Math.round(variability * 1000) / 1000,
        moodTrend: effectiveMoodTrend !== null ? Math.round(effectiveMoodTrend * 1000) / 1000 : null,
      },
      recentConsistency: Math.round(recentConsistency * 1000) / 1000,
      baselineConsistency: Math.round(baselineConsistency * 1000) / 1000,
    });
  }

  // Overall burnout: weighted average across domains
  const scoredResults = results.filter((r) => r.riskScore > 0);
  let overallScore = 0;
  if (scoredResults.length > 0) {
    overallScore =
      scoredResults.reduce((a, r) => a + r.riskScore, 0) / scoredResults.length;
  }

  // Domains contributing most to risk
  const contributingDomains = [...results]
    .filter((r) => r.risk === "moderate" || r.risk === "high")
    .sort((a, b) => b.riskScore - a.riskScore)
    .map((r) => r.label);

  return {
    risk: classifyRisk(overallScore),
    riskScore: Math.round(overallScore * 1000) / 1000,
    domains: results,
    contributingDomains,
  };
}

// ─── Formatting for display ─────────────────────────────────────────────

export function formatBurnoutReport(result: OverallBurnout): string {
  const riskIcon =
    result.risk === "high" ? "🔴" : result.risk === "moderate" ? "🟡" : "🟢";
  const riskLabel = result.risk.toUpperCase();

  let output = `${riskIcon} <b>Burnout Risk: ${riskLabel}</b> (${(result.riskScore * 100).toFixed(0)}%)\n\n`;

  for (const d of result.domains) {
    const icon = d.icon ?? "•";
    const riskEmoji =
      d.risk === "high" ? "🔴" : d.risk === "moderate" ? "🟡" : "🟢";

    output += `${riskEmoji} ${icon} <b>${d.label}</b>  score: ${(d.riskScore * 100).toFixed(0)}%\n`;

    if (d.riskScore > 0) {
      const dropPct = (d.factors.consistencyDrop * 100).toFixed(0);
      const varPct = (d.factors.variability * 100).toFixed(0);
      output += `    📉 Drop: ${dropPct}%  📊 Variability: ${varPct}%`;

      if (d.factors.moodTrend !== null) {
        const trendIcon = d.factors.moodTrend > 0 ? "📈" : "📉";
        output += `  ${trendIcon} Mood: ${d.factors.moodTrend.toFixed(3)}`;
      }

      output += "\n";
      output += `    Recent: ${(d.recentConsistency * 100).toFixed(1)}%  Baseline: ${(d.baselineConsistency * 100).toFixed(1)}%\n`;
    }
    output += "\n";
  }

  if (result.contributingDomains.length > 0) {
    output += `⚠️ <b>Contributing domains:</b> ${result.contributingDomains.join(", ")}\n`;
  }

  if (result.risk === "low") {
    output += "\n✅ No burnout indicators detected. Keep it up!";
  } else if (result.risk === "moderate") {
    output += "\n⚡ Some risk factors detected. Consider reviewing your load.";
  } else {
    output += "\n🚨 High burnout risk detected. Prioritize recovery and rest.";
  }

  return output;
}

export function formatBurnoutReportTerminal(result: OverallBurnout): string {
  // Strip HTML tags for terminal display
  return formatBurnoutReport(result)
    .replace(/<b>/g, "\x1b[1m")
    .replace(/<\/b>/g, "\x1b[22m")
    .replace(/<i>/g, "")
    .replace(/<\/i>/g, "");
}
