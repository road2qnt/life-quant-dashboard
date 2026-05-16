import { readFile } from "node:fs/promises";
import { db, schema } from "./db";
import type { ExportData } from "./export";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export function parseJSON(json: string): ExportData {
  const data = JSON.parse(json) as ExportData;

  if (!data.version || data.version !== 1) {
    throw new ImportError(`Unsupported export version: ${data.version}`);
  }

  if (!Array.isArray(data.domains)) {
    throw new ImportError("Invalid export: missing domains array");
  }

  return data;
}

export async function importData(data: ExportData, options?: { dryRun?: boolean }): Promise<{ domains: number; events: number; snapshots: number; correlations: number; memories: number; config: number }> {
  const counts = { domains: 0, events: 0, snapshots: 0, correlations: 0, memories: 0, config: 0 };

  if (options?.dryRun) {
    counts.domains = data.domains.length;
    counts.events = data.events.length;
    counts.snapshots = data.weeklySnapshots.length;
    counts.correlations = data.correlations.length;
    counts.memories = data.agentMemory.length;
    counts.config = data.config.length;
    return counts;
  }

  // Import domains first (foreign key dependency)
  for (const domain of data.domains) {
    await db
      .insert(schema.domains)
      .values(domain)
      .onConflictDoNothing({ target: schema.domains.id })
      .run();
    counts.domains++;
  }

  // Import events
  for (const event of data.events) {
    await db
      .insert(schema.events)
      .values(event)
      .onConflictDoNothing({ target: schema.events.id })
      .run();
    counts.events++;
  }

  // Import weekly snapshots
  for (const snap of data.weeklySnapshots) {
    await db
      .insert(schema.weeklySnapshots)
      .values(snap)
      .onConflictDoNothing({ target: schema.weeklySnapshots.id })
      .run();
    counts.snapshots++;
  }

  // Import correlations
  for (const corr of data.correlations) {
    await db
      .insert(schema.correlations)
      .values(corr)
      .onConflictDoNothing({ target: schema.correlations.id })
      .run();
    counts.correlations++;
  }

  // Import agent memories
  for (const mem of data.agentMemory) {
    await db
      .insert(schema.agentMemory)
      .values(mem)
      .onConflictDoNothing({ target: schema.agentMemory.id })
      .run();
    counts.memories++;
  }

  // Import config
  for (const cfg of data.config) {
    await db
      .insert(schema.config)
      .values(cfg)
      .onConflictDoNothing({ target: schema.config.key })
      .run();
    counts.config++;
  }

  return counts;
}

export async function importFromFile(filePath: string, options?: { dryRun?: boolean }): Promise<{ domains: number; events: number; snapshots: number; correlations: number; memories: number; config: number }> {
  const json = await readFile(filePath, "utf-8");
  const data = parseJSON(json);
  return importData(data, options);
}
