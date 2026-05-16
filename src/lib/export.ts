import { writeFile } from "node:fs/promises";
import { db, schema } from "./db";

export interface ExportData {
  version: 1;
  exportedAt: string;
  domains: (typeof schema.domains.$inferSelect)[];
  events: (typeof schema.events.$inferSelect)[];
  weeklySnapshots: (typeof schema.weeklySnapshots.$inferSelect)[];
  correlations: (typeof schema.correlations.$inferSelect)[];
  agentMemory: (typeof schema.agentMemory.$inferSelect)[];
  config: (typeof schema.config.$inferSelect)[];
}

export async function exportAll(): Promise<ExportData> {
  const [domains, events, weeklySnapshots, correlations, agentMemory, config] =
    await Promise.all([
      db.select().from(schema.domains).all(),
      db.select().from(schema.events).all(),
      db.select().from(schema.weeklySnapshots).all(),
      db.select().from(schema.correlations).all(),
      db.select().from(schema.agentMemory).all(),
      db.select().from(schema.config).all(),
    ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    domains,
    events,
    weeklySnapshots,
    correlations,
    agentMemory,
    config,
  };
}

export function exportToJSON(data: ExportData): string {
  return JSON.stringify(data, null, 2);
}

export async function exportToFile(filePath: string): Promise<void> {
  const data = await exportAll();
  const json = exportToJSON(data);
  await writeFile(filePath, json, "utf-8");
}

export function getExportStats(data: ExportData): string {
  const parts: string[] = [];
  parts.push(`Domains: ${data.domains.length}`);
  parts.push(`Events: ${data.events.length}`);
  parts.push(`Weekly snapshots: ${data.weeklySnapshots.length}`);
  parts.push(`Correlations: ${data.correlations.length}`);
  parts.push(`Agent memories: ${data.agentMemory.length}`);
  parts.push(`Config entries: ${data.config.length}`);
  return parts.join("\n");
}
