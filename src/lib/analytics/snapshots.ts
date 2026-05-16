import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { consistencyScore, trendDirection } from "./consistency";

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

function getMondayWeeksBack(weeks: number): string[] {
  const now = new Date();
  const weeksList: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeksList.push(getWeekStart(d));
  }
  return weeksList;
}

export interface SnapshotResult {
  domainId: string;
  weekStart: string;
  consistency: number;
  totalValue: number;
  numEvents: number;
  trend: string;
}

export async function generateSnapshots(options?: {
  weeks?: number;
  domainId?: string;
  dryRun?: boolean;
}): Promise<SnapshotResult[]> {
  const weeks = options?.weeks ?? 52;
  const weekStarts = getMondayWeeksBack(weeks);

  const domains = options?.domainId
    ? await db
        .select()
        .from(schema.domains)
        .where(
          and(
            eq(schema.domains.id, options.domainId),
            eq(schema.domains.archived, false),
          ),
        )
        .all()
    : await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.archived, false))
        .all();

  const results: SnapshotResult[] = [];

  for (const domain of domains) {
    const maxValue = domain.maxValue ?? 10;

    // Fetch all events for this domain in range
    const rangeStart = weekStarts[0];
    const rangeEnd = getWeekEnd(weekStarts[weekStarts.length - 1]);

    const allEvents = await db
      .select({ value: schema.events.value, timestamp: schema.events.timestamp })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.domainId, domain.id),
          gte(schema.events.timestamp, rangeStart),
          lte(schema.events.timestamp, rangeEnd),
        ),
      )
      .all();

    // Compute per-week snapshots
    const weeklyScores: number[] = [];

    for (const weekStart of weekStarts) {
      const weekEnd = getWeekEnd(weekStart);

      const weekEvents = allEvents.filter((e) => {
        const date = e.timestamp.slice(0, 10);
        return date >= weekStart && date < weekEnd;
      });

      const result = consistencyScore(weekEvents, 7, maxValue);

      const totalValue = weekEvents.reduce((sum, e) => sum + e.value, 0);
      const numEvents = weekEvents.length;
      weeklyScores.push(result.consistency);

      // Determine trend from last 4+ weeks
      const trend = trendDirection(weeklyScores.filter((s) => s > 0));

      if (options?.dryRun) {
        results.push({
          domainId: domain.id,
          weekStart,
          consistency: result.consistency,
          totalValue,
          numEvents,
          trend,
        });
        continue;
      }

      const id = `${domain.id}_${weekStart}`;
      await db
        .insert(schema.weeklySnapshots)
        .values({
          id,
          domainId: domain.id,
          weekStart,
          consistency: result.consistency,
          totalValue,
          numEvents,
          trend: trend as "improving" | "declining" | "stable" | "insufficient",
          metadata: JSON.stringify({
            avgValue: result.avgValue,
            activeDays: result.activeDays,
            maxValue,
          }),
        })
        .onConflictDoUpdate({
          target: schema.weeklySnapshots.id,
          set: {
            consistency: result.consistency,
            totalValue,
            numEvents,
            trend: trend as "improving" | "declining" | "stable" | "insufficient",
            metadata: JSON.stringify({
              avgValue: result.avgValue,
              activeDays: result.activeDays,
              maxValue,
            }),
          },
        })
        .run();

      results.push({
        domainId: domain.id,
        weekStart,
        consistency: result.consistency,
        totalValue,
        numEvents,
        trend,
      });
    }
  }

  return results;
}

export function summarizeSnapshots(results: SnapshotResult[]): string {
  const byDomain = new Map<string, SnapshotResult[]>();
  for (const r of results) {
    if (!byDomain.has(r.domainId)) byDomain.set(r.domainId, []);
    byDomain.get(r.domainId)!.push(r);
  }

  let output = "";
  for (const [domainId, snaps] of byDomain) {
    const nonZero = snaps.filter((s) => s.consistency > 0);
    const avgConsistency =
      nonZero.length > 0
        ? nonZero.reduce((a, s) => a + s.consistency, 0) / nonZero.length
        : 0;
    const totalEvents = snaps.reduce((a, s) => a + s.numEvents, 0);
    output += `${domainId}: ${snaps.length} snapshots, avg ${avgConsistency.toFixed(3)}, ${totalEvents} events\n`;
  }
  return output;
}
