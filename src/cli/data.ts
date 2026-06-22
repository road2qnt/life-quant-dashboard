#!/usr/bin/env tsx
import { exit, argv } from "process";
import { exportAll, exportToFile, getExportStats } from "../lib/export";
import { importFromFile } from "../lib/import";
import { generateSnapshots, summarizeSnapshots, generateWeeklyReview, sessionReport, formatSessionReport, computeBurnoutRisk, formatBurnoutReportTerminal, detectAnomalies, formatAnomalyReportTerminal } from "../lib/analytics";
import { computeAllCorrelations, summarizeCorrelations } from "../lib/analytics/correlations";
import { writeFileSync } from "node:fs";
import { exportEventsCSV, exportDomainsCSV, exportSnapshotsCSV } from "../lib/export-csv";
import { importEventsFromCSV } from "../lib/import-csv";

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}
function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`;
}
function green(text: string): string {
  return `\x1b[32m${text}\x1b[39m`;
}
function red(text: string): string {
  return `\x1b[31m${text}\x1b[39m`;
}
function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[39m`;
}

function printHelp() {
  console.log(`
${bold("Life Quant — Data & Analytics CLI")}

${dim("Export, import, snapshots, and correlations.")}

${bold("Usage:")}
  npx tsx src/cli/data.ts ${dim("<command> [options]")}

${bold("Commands:")}
  export [file]                 Export all data to JSON (default: life-quant-export.json)
  import <file>                 Import data from JSON file
  dry-run <file>                Preview import without making changes
  snapshots [weeks]             Generate weekly consistency snapshots (default: 52)
  correlate [domainA] [domainB] Compute cross-domain correlations
  review [weeks]                Generate LLM weekly review (default: 4)
  csv-events [file]             Export events as CSV (default: events.csv)
  csv-domains [file]            Export domains as CSV (default: domains.csv)
  csv-snapshots [file]          Export snapshots as CSV (default: snapshots.csv)
  csv-import <file>             Import events from CSV file
  sessions [domain]             Session patterns (time-of-day + day-of-week)
  sessions [domain] [days]      Custom lookback period (default: 90)
  burnout [domain]              Compute burnout risk score
  anomalies [domain] [days]     Detect statistical anomalies
  --help, -h                    Show this help

${bold("Examples:")}
  npx tsx src/cli/data.ts export
  npx tsx src/cli/data.ts csv-events
  npx tsx src/cli/data.ts csv-events my-events.csv
  npx tsx src/cli/data.ts csv-snapshots
  npx tsx src/cli/data.ts snapshots
  npx tsx src/cli/data.ts correlate
`);
}

async function cmdExport(filePath: string) {
  console.log(`\n${bold("Exporting data...")} ${dim("→ " + filePath)}\n`);
  await exportToFile(filePath);
  const data = await exportAll();
  console.log(getExportStats(data));
  console.log(`\n${green("✓")} Exported to ${bold(filePath)}`);
}

async function cmdImport(filePath: string, dryRun: boolean) {
  console.log(`\n${bold(dryRun ? "Previewing import..." : "Importing data...")} ${dim("← " + filePath)}\n`);

  const counts = await importFromFile(filePath, dryRun ? { dryRun: true } : undefined);

  console.log(`  Domains:           ${bold(String(counts.domains))}`);
  console.log(`  Events:            ${bold(String(counts.events))}`);
  console.log(`  Weekly snapshots:  ${bold(String(counts.snapshots))}`);
  console.log(`  Correlations:      ${bold(String(counts.correlations))}`);
  console.log(`  Agent memories:    ${bold(String(counts.memories))}`);
  console.log(`  Config entries:    ${bold(String(counts.config))}`);

  if (dryRun) {
    console.log(`\n${yellow("⚠ Dry run — no changes made.")}`);
    console.log(`  Run ${bold("import")} instead to apply.`);
  } else {
    console.log(`\n${green("✓")} Import complete!`);
  }
}

async function cmdSnapshots(weeks: number, dryRun: boolean) {
  console.log(`\n${bold(dryRun ? "Previewing snapshots..." : "Generating weekly snapshots...")} ${dim(`(${weeks} weeks)`)}\n`);

  const results = await generateSnapshots({ weeks, dryRun });

  if (dryRun) {
    console.log(summarizeSnapshots(results));
    console.log(yellow("⚠ Dry run — no changes made."));
  } else {
    console.log(summarizeSnapshots(results));
    console.log(`${green("✓")} Generated ${results.length} snapshots`);
  }
}

async function cmdBurnout(domainId?: string) {
  console.log(`\n${bold("Computing burnout risk...")} ${dim(domainId ? `(domain: ${domainId})` : "(all domains)")}\n`);
  const result = await computeBurnoutRisk(domainId);

  console.log(formatBurnoutReportTerminal(result));
  console.log(`${green("✓")} Risk score: ${(result.riskScore * 100).toFixed(0)}% (${result.risk})`);
}

async function cmdAnomalies(domainId?: string, days?: number) {
  console.log(`\n${bold("Detecting anomalies...")} ${dim(domainId ? `(domain: ${domainId})` : "(all domains)")} ${dim(`(last ${days ?? 90} days)`)}\n`);
  const result = await detectAnomalies(domainId, days);

  console.log(formatAnomalyReportTerminal(result));
  if (result.totalAnomalies > 0) {
    console.log(`${yellow("✦")} ${result.totalAnomalies} anomaly flag${result.totalAnomalies !== 1 ? "s" : ""} found across ${result.domains.filter((d) => d.anomalyCount > 0).length} domain${result.domains.length !== 1 ? "s" : ""}`);
  } else {
    console.log(`${green("✓")} No anomalies detected.`);
  }
}

async function cmdSessions(domainId?: string, days?: number) {
  console.log(`\n${bold("Session analytics...")} ${dim(`(last ${days ?? 90} days)`)}\n`);
  const reports = await sessionReport(domainId, days);

  if (reports.length === 0) {
    console.log(yellow("No data found for the given period."));
    return;
  }

  // Strip HTML for terminal display
  for (const r of reports) {
    const icon = r.icon ?? "•";
    console.log(`${icon} ${bold(r.label)} — ${r.totalEvents} events`);

    const timeParts = r.timeOfDay.map((t) => `${t.label.split(" ")[1]} ${t.percentage}%`).join("  ");
    console.log(`  ${dim("Time:")} ${timeParts}`);

    const dayParts = r.dayOfWeek.map((d) => `${d.short}:${d.count}`).join("  ");
    console.log(`  ${dim("Days:")} ${dayParts}`);

    console.log(`  Peak: ${r.busiestHour.hour}:00 (${r.busiestHour.count}x)  Quiet: ${r.quietestDay.day} (${r.quietestDay.count}x)`);
    console.log();
  }
}

async function cmdCSVImport(filePath: string) {
  console.log(`\n${bold("Importing events from CSV...")} ${dim("← " + filePath)}\n`);
  const result = await importEventsFromCSV(filePath);

  console.log(`  Total rows:  ${bold(String(result.total))}`);
  console.log(`  Imported:    ${green(String(result.imported))}`);
  console.log(`  Skipped:     ${result.skipped > 0 ? yellow(String(result.skipped)) : String(result.skipped)}`);

  if (result.errors.length > 0) {
    const shown = result.errors.slice(0, 5);
    for (const err of shown) console.log(`  ${dim("⚠")} ${err}`);
    if (result.errors.length > 5) console.log(`  ${dim(`... and ${result.errors.length - 5} more`)}`);
  }
  console.log();
}

async function cmdCSV(exportFn: () => Promise<string>, filePath: string, label: string) {
  console.log(`\n${bold(`Exporting ${label} to CSV...`)} ${dim("→ " + filePath)}\n`);
  const csv = await exportFn();
  writeFileSync(filePath, csv, "utf-8");
  const lines = csv.split("\n").length - 1;
  console.log(`  ${green("✓")} ${lines} rows exported to ${bold(filePath)}`);
}

async function cmdReview(weeks: number) {
  console.log(`\n${bold("Generating weekly review...")} ${dim(`(last ${weeks} weeks)`)}\n`);

  const result = await generateWeeklyReview(weeks);

  if (result.error && !result.review) {
    console.log(red(`❌ ${result.error}`));
    return;
  }

  if (result.rawPrompt) {
    console.log(dim("── Prompt ──"));
    console.log(result.rawPrompt);
    console.log();
  }

  if (result.review) {
    console.log(bold("── Review ──"));
    console.log(result.review);
    console.log();
  }

  if (result.error) {
    console.log(yellow(`⚠ ${result.error}`));
  }
}

async function cmdCorrelate(domainA?: string, domainB?: string) {
  console.log(`\n${bold("Computing cross-domain correlations...")}\n`);

  const results = await computeAllCorrelations(domainA, domainB);

  if (results.length === 0) {
    console.log("No correlations computed. Try: npx tsx src/cli/data.ts correlate");
    return;
  }

  console.log(await summarizeCorrelations(results));
  console.log(`${green("✓")} Computed ${results.length} correlation${results.length !== 1 ? "s" : ""}`);
}

async function main() {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const command = args[0];

  switch (command) {
    case "export": {
      const filePath = args[1] || "life-quant-export.json";
      await cmdExport(filePath);
      break;
    }
    case "import": {
      const filePath = args[1];
      if (!filePath) {
        console.error(red("❌ Missing file path. Usage: npx tsx src/cli/data.ts import <file>"));
        exit(1);
      }
      await cmdImport(filePath, false);
      break;
    }
    case "dry-run": {
      const filePath = args[1];
      if (!filePath) {
        console.error(red("❌ Missing file path. Usage: npx tsx src/cli/data.ts dry-run <file>"));
        exit(1);
      }
      await cmdImport(filePath, true);
      break;
    }
    case "snapshots": {
      const weeks = args[1] ? parseInt(args[1], 10) : 52;
      const dryRun = args.includes("--dry-run");
      if (isNaN(weeks) || weeks < 1) {
        console.error(red("❌ Invalid weeks value"));
        exit(1);
      }
      await cmdSnapshots(weeks, dryRun);
      break;
    }
    case "correlate": {
      const domainA = args[1];
      const domainB = args[2];
      await cmdCorrelate(domainA, domainB);
      break;
    }
    case "review": {
      const weeks = args[1] ? parseInt(args[1], 10) : 4;
      if (isNaN(weeks) || weeks < 1) {
        console.error(red("❌ Invalid weeks value"));
        exit(1);
      }
      await cmdReview(weeks);
      break;
    }
    case "csv-events": {
      const filePath = args[1] || "events.csv";
      await cmdCSV(() => exportEventsCSV(), filePath, "events");
      break;
    }
    case "csv-domains": {
      const fp = args[1] || "domains.csv";
      await cmdCSV(() => exportDomainsCSV(), fp, "domains");
      break;
    }
    case "csv-snapshots": {
      const fp = args[1] || "snapshots.csv";
      await cmdCSV(() => exportSnapshotsCSV(), fp, "snapshots");
      break;
    }
    case "burnout": {
      const domainId = args[1];
      await cmdBurnout(domainId);
      break;
    }
    case "anomalies": {
      const domainId = args[1];
      const days = args[2] ? parseInt(args[2], 10) : 90;
      await cmdAnomalies(domainId, isNaN(days) ? 90 : days);
      break;
    }
    case "sessions": {
      const domainId = args[1];
      const days = args[2] ? parseInt(args[2], 10) : 90;
      await cmdSessions(domainId, isNaN(days) ? 90 : days);
      break;
    }
    case "csv-import": {
      const fp = args[1];
      if (!fp) {
        console.error(red("❌ Missing file path. Usage: npx tsx src/cli/data.ts csv-import <file>"));
        exit(1);
      }
      await cmdCSVImport(fp);
      break;
    }
    default:
      console.error(red(`❌ Unknown command: "${command}"`));
      printHelp();
      exit(1);
  }
}

main().catch((err) => {
  console.error(red("❌ Error:"), err instanceof Error ? err.message : String(err));
  exit(1);
});
