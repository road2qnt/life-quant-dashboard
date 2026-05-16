import { eq } from "drizzle-orm";
import { db, schema } from "./db";

function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(escapeCSV).join(",");
  const lines = rows.map((row) =>
    columns.map((col) => escapeCSV(row[col] as string | number | null | undefined)).join(","),
  );
  return [header, ...lines].join("\n");
}

export async function exportEventsCSV(domainId?: string): Promise<string> {
  const conditions = domainId ? eq(schema.events.domainId, domainId) : undefined;
  const query = db
    .select({
      id: schema.events.id,
      domainId: schema.events.domainId,
      timestamp: schema.events.timestamp,
      value: schema.events.value,
      note: schema.events.note,
      source: schema.events.source,
    })
    .from(schema.events);

  const rows = conditions
    ? await query.where(conditions).orderBy(schema.events.timestamp).all()
    : await query.orderBy(schema.events.timestamp).all();

  return toCSV(rows, ["id", "domainId", "timestamp", "value", "note", "source"]);
}

export async function exportDomainsCSV(): Promise<string> {
  const rows = await db
    .select({
      id: schema.domains.id,
      label: schema.domains.label,
      icon: schema.domains.icon,
      unit: schema.domains.unit,
      type: schema.domains.type,
      minValue: schema.domains.minValue,
      maxValue: schema.domains.maxValue,
      archived: schema.domains.archived,
    })
    .from(schema.domains)
    .all();

  return toCSV(rows, ["id", "label", "icon", "unit", "type", "minValue", "maxValue", "archived"]);
}

export async function exportSnapshotsCSV(domainId?: string): Promise<string> {
  const conditions = domainId ? eq(schema.weeklySnapshots.domainId, domainId) : undefined;
  const query = db
    .select({
      id: schema.weeklySnapshots.id,
      domainId: schema.weeklySnapshots.domainId,
      weekStart: schema.weeklySnapshots.weekStart,
      consistency: schema.weeklySnapshots.consistency,
      totalValue: schema.weeklySnapshots.totalValue,
      numEvents: schema.weeklySnapshots.numEvents,
      trend: schema.weeklySnapshots.trend,
    })
    .from(schema.weeklySnapshots);

  const rows = conditions
    ? await query.where(conditions).orderBy(schema.weeklySnapshots.weekStart).all()
    : await query.orderBy(schema.weeklySnapshots.weekStart).all();

  return toCSV(rows, ["id", "domainId", "weekStart", "consistency", "totalValue", "numEvents", "trend"]);
}

export async function exportAllCSV(): Promise<{ events: string; domains: string; snapshots: string }> {
  const [events, domains, snapshots] = await Promise.all([
    exportEventsCSV(),
    exportDomainsCSV(),
    exportSnapshotsCSV(),
  ]);
  return { events, domains, snapshots };
}
