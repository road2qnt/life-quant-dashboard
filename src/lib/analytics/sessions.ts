import { eq, and, gte, desc } from "drizzle-orm";
import { db, schema } from "../db";

export interface TimeOfDayDistribution {
  label: string;
  hours: string;
  count: number;
  percentage: number;
}

export interface DayOfWeekStats {
  day: string;
  short: string;
  count: number;
  avgValue: number;
  eventsPerDay: number;
}

export interface SessionReport {
  domainId: string;
  label: string;
  icon: string | null;
  totalEvents: number;
  timeOfDay: TimeOfDayDistribution[];
  dayOfWeek: DayOfWeekStats[];
  busiestHour: { hour: number; count: number };
  quietestDay: { day: string; count: number };
}

const TIME_SLOTS = [
  { label: "🌅 Morning", hours: "5–11", min: 5, max: 11 },
  { label: "☀️ Afternoon", hours: "11–17", min: 11, max: 17 },
  { label: "🌆 Evening", hours: "17–21", min: 17, max: 21 },
  { label: "🌙 Night", hours: "21–5", min: 21, max: 24 },
  { label: "🌙 Night", hours: "0–5", min: 0, max: 5 },
];

const DAYS = [
  { day: "Monday", short: "Mon" },
  { day: "Tuesday", short: "Tue" },
  { day: "Wednesday", short: "Wed" },
  { day: "Thursday", short: "Thu" },
  { day: "Friday", short: "Fri" },
  { day: "Saturday", short: "Sat" },
  { day: "Sunday", short: "Sun" },
];

function getHour(timestamp: string): number {
  return new Date(timestamp).getHours();
}

function getDayOfWeek(timestamp: string): number {
  return new Date(timestamp).getDay(); // 0=Sun
}

export async function sessionReport(
  domainId?: string,
  days?: number,
): Promise<SessionReport[]> {
  const lookback = days ?? 90;
  const rangeStart = new Date();
  rangeStart.setDate(rangeStart.getDate() - lookback);
  const rangeStartStr = rangeStart.toISOString();

  const domains = domainId
    ? await db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, domainId), eq(schema.domains.archived, false)))
        .all()
    : await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.archived, false))
        .all();

  const reports: SessionReport[] = [];

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
      .orderBy(desc(schema.events.timestamp))
      .all();

    if (events.length === 0) continue;

    // Time of day distribution
    const hourCounts = new Array(24).fill(0);
    for (const e of events) {
      const h = getHour(e.timestamp);
      hourCounts[h]++;
    }

    const timeOfDay = TIME_SLOTS.map((slot) => {
      let count = 0;
      for (let h = slot.min; h < slot.max; h++) {
        count += hourCounts[h] ?? 0;
      }
      return {
        label: slot.label,
        hours: slot.hours,
        count,
        percentage: Math.round((count / events.length) * 100),
      };
    });

    // Busiest hour
    let busiestHourIdx = 0;
    for (let h = 1; h < 24; h++) {
      if (hourCounts[h] > hourCounts[busiestHourIdx]) busiestHourIdx = h;
    }

    // Day of week stats
    const dayCounts = new Array(7).fill(0);
    const dayValues = new Array(7).fill(0) as number[];
    for (const e of events) {
      const d = getDayOfWeek(e.timestamp);
      dayCounts[d]++;
      dayValues[d] += e.value;
    }

    const dayOfWeek = DAYS.map((d, i) => ({
      day: d.day,
      short: d.short,
      count: dayCounts[i],
      avgValue: dayCounts[i] > 0 ? Math.round((dayValues[i] / dayCounts[i]) * 100) / 100 : 0,
      eventsPerDay: Math.round((dayCounts[i] / lookback) * 100) / 100,
    }));

    // Quietest day
    let quietestIdx = 0;
    for (let d = 1; d < 7; d++) {
      if (dayCounts[d] < dayCounts[quietestIdx]) quietestIdx = d;
    }

    // Get domain info
    const icon = domain.icon ?? null;
    const label = domain.label;

    reports.push({
      domainId: domain.id,
      label,
      icon,
      totalEvents: events.length,
      timeOfDay,
      dayOfWeek,
      busiestHour: { hour: busiestHourIdx, count: hourCounts[busiestHourIdx] },
      quietestDay: { day: DAYS[quietestIdx].day, count: dayCounts[quietestIdx] },
    });
  }

  return reports;
}

export function formatSessionReport(reports: SessionReport[]): string {
  let output = "";

  for (const r of reports) {
    const icon = r.icon ?? "•";
    output += `${icon} <b>${r.label}</b> — ${r.totalEvents} events\n`;

    // Time of day (compact bar chart)
    output += `  <b>Time:</b> `;
    for (const t of r.timeOfDay) {
      const bar = "▓".repeat(Math.ceil(t.percentage / 10));
      output += `${t.label.split(" ")[1]} ${bar} ${t.percentage}%  `;
    }
    output += `\n`;

    // Day of week
    output += `  <b>Days:</b> `;
    for (const d of r.dayOfWeek) {
      const bar = d.count > 0 ? "▓" : "░";
      output += `${d.short} ${bar}${d.count > 0 ? ` ${d.count}` : ""}  `;
    }
    output += `\n`;

    // Busiest / quietest
    output += `  🕐 Peak at ${r.busiestHour.hour}:00 (${r.busiestHour.count}x)  `;
    output += `💤 Quietest: ${r.quietestDay.day} (${r.quietestDay.count}x)\n\n`;
  }

  return output;
}
