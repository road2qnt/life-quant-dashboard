import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export interface CSVImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else if (char === "\r") {
        // skip carriage return
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

export async function importEventsFromCSV(filePath: string): Promise<CSVImportResult> {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return { total: 0, imported: 0, skipped: 0, errors: ["CSV file is empty or has only a header."] };
  }

  const header = parseCSVLine(lines[0]);
  const hasId = header.includes("id");
  const hasDomainId = header.includes("domainId");
  const hasTimestamp = header.includes("timestamp");
  const hasValue = header.includes("value");

  if (!hasDomainId || !hasTimestamp || !hasValue) {
    return {
      total: 0, imported: 0, skipped: 0,
      errors: [`CSV must have at least domainId, timestamp, value columns. Got: ${header.join(", ")}`],
    };
  }

  const idIdx = header.indexOf("id");
  const domainIdx = header.indexOf("domainId");
  const tsIdx = header.indexOf("timestamp");
  const valIdx = header.indexOf("value");
  const noteIdx = header.indexOf("note");
  const srcIdx = header.indexOf("source");

  let total = 0;
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Cache known domains
  const allDomains = await db.select({ id: schema.domains.id }).from(schema.domains).all();
  const knownDomainIds = new Set(allDomains.map((d) => d.id));

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    total++;

    const domainId = row[domainIdx]?.trim();
    const timestamp = row[tsIdx]?.trim();
    const valueStr = row[valIdx]?.trim();
    const value = parseFloat(valueStr);

    if (!domainId) { skipped++; errors.push(`Row ${i}: missing domainId`); continue; }
    if (!timestamp) { skipped++; errors.push(`Row ${i}: missing timestamp`); continue; }
    if (isNaN(value)) { skipped++; errors.push(`Row ${i}: invalid value "${valueStr}"`); continue; }

    if (!knownDomainIds.has(domainId)) {
      skipped++;
      errors.push(`Row ${i}: domain "${domainId}" not found. Skip or create domain first.`);
      continue;
    }

    const note = noteIdx >= 0 ? (row[noteIdx] || null) : null;
    const srcVal = srcIdx >= 0 ? row[srcIdx]?.trim() ?? "" : "";
    const source = srcVal && ["manual", "cli", "telegram", "api", "integration"].includes(srcVal) ? srcVal as "manual" | "cli" | "telegram" | "api" | "integration" : "api";
    const id = hasId && row[idIdx]?.trim() ? row[idIdx].trim() : crypto.randomUUID();

    try {
      await db
        .insert(schema.events)
        .values({
          id,
          domainId,
          timestamp,
          value,
          note: note ?? null,
          source: source ?? ("api" as const),
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing({ target: schema.events.id })
        .run();
      imported++;
    } catch (err) {
      skipped++;
      errors.push(`Row ${i}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { total, imported, skipped, errors };
}
