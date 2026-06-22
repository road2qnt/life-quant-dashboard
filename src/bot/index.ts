#!/usr/bin/env tsx
/**
 * Life Quant Dashboard — Telegram Bot
 *
 * Long-polling bot for logging events via Telegram.
 *
 * Usage:
 *   1. Set BOT_TOKEN in .env (get from @BotFather)
 *   2. npx tsx src/bot/index.ts
 *   3. Send commands to your bot on Telegram
 *
 * Commands:
 *   /log <domain> <value> [note]  — Log an event
 *   /today                        — Today's summary
 *   /stats                        — Weekly consistency trends
 *   /snapshots [weeks]            — Generate weekly snapshots
 *   /correlate                    — Cross-domain correlations
 *   /review                       — LLM weekly review
 *   /sessions [domain]            — Session patterns (time/day)
 *   /burnout [domain]            — Burnout risk assessment
 *   /anomalies                    — Detect statistical anomalies
 *   /domains                      — List tracked domains
 *   /export                       — Export all data as JSON
 *   /csv                          — Export events as CSV
 *   /delete [id]                  — Delete/undo an event
 *   /help                         — Show this help
 *   /start                        — Welcome message
 */

import { db, schema } from "../lib/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { config } from "dotenv";
import { escapeHtml, bold, code, formatDateDisplay } from "./helpers";
import { weeklyConsistencyScores, trendDirection, generateSnapshots, summarizeSnapshots, computeBurnoutRisk, formatBurnoutReport, detectAnomalies, formatAnomalyReport } from "../lib/analytics";
import { computeAllCorrelations, summarizeCorrelations } from "../lib/analytics/correlations";
import { generateWeeklyReview, sessionReport, formatSessionReport } from "../lib/analytics";
import { exportEventsCSV } from "../lib/export-csv";
import { exportAll, exportToJSON, getExportStats } from "../lib/export";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TODAY_HEADER_SEPARATOR = "\n\n" + "─".repeat(22) + "\n";
const STATS_WEEKS = 8;

// ─── Inline conversation state ──────────────────────────────────────────
const conversations = new Map<number, { step: string; domainId: string }>();

config(); // Load .env

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN not set in .env file");
  console.error("   Get a token from @BotFather on Telegram");
  console.error("   Then add it to .env: BOT_TOKEN=your_token_here");
  process.exit(1);
}

// ─── Bot setup ──────────────────────────────────────────────────────────

import TelegramBot from "node-telegram-bot-api";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── Helpers ────────────────────────────────────────────────────────────
// (helpers extracted to ./helpers.ts for testability)

// ─── Domain lookup ──────────────────────────────────────────────────────

async function findDomain(query: string) {
  const q = query.toLowerCase().trim();

  // Try exact id match first
  let domain = await db
    .select()
    .from(schema.domains)
    .where(
      and(eq(schema.domains.id, q), eq(schema.domains.archived, false))
    )
    .get();

  if (domain) return domain;

  // Fetch all non-archived domains for JS-side matching
  const all = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();

  // Case-insensitive label match
  domain = all.find(
    (d) =>
      d.id.toLowerCase() === q ||
      d.label.toLowerCase() === q ||
      d.label.toLowerCase().includes(q)
  );
  if (domain) return domain;

  // Partial/fuzzy match
  const partial = all.filter(
    (d) => d.id.includes(q) || d.label.toLowerCase().includes(q)
  );

  if (partial.length === 1) return partial[0];

  return null;
}

async function listDomainsMarkdown(): Promise<string> {
  const domains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();

  if (domains.length === 0) {
    return "No domains configured. Run the seed script first:\n" + code("npx tsx src/lib/seed.ts");
  }

  let result = "📋 <b>Available domains:</b>\n\n";
  for (const d of domains) {
    const range =
      d.type === "boolean" ? "0/1" : `${d.minValue ?? 0}–${d.maxValue ?? 10}`;
    result += `${d.icon ?? "•"} <b>${escapeHtml(d.id)}</b> — ${escapeHtml(d.label)} (${range}${d.unit ? " " + escapeHtml(d.unit) : ""})\n`;
  }
  result += "\nUsage: " + code("/log <domain> <value> [note]");
  return result;
}

// ─── Today summary ──────────────────────────────────────────────────────

async function todaySummary(): Promise<string> {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const todayStart = `${todayStr}T00:00:00.000Z`;
  const todayEnd = `${todayStr}T23:59:59.999Z`;

  // Fetch today's events with domain info (join)
  const rows = await db
    .select({
      domainId: schema.events.domainId,
      value: schema.events.value,
      note: schema.events.note,
      icon: schema.domains.icon,
      label: schema.domains.label,
      unit: schema.domains.unit,
      type: schema.domains.type,
    })
    .from(schema.events)
    .leftJoin(schema.domains, eq(schema.events.domainId, schema.domains.id))
    .where(
      and(
        gte(schema.events.timestamp, todayStart),
        lte(schema.events.timestamp, todayEnd)
      )
    )
    .all();

  if (rows.length === 0) {
    return `📋 <b>Today's Summary — ${escapeHtml(formatDateDisplay(now))}</b>

No events logged yet today. Use ${code("/log <domain> <value>")} to get started.`;
  }

  // Group by domain (handle nullable join columns with defaults)
  const byDomain = new Map<
    string,
    { icon: string | null; label: string; unit: string | null; type: string; values: number[]; notes: string[] }
  >();

  for (const row of rows) {
    const domainId = row.domainId;
    if (!byDomain.has(domainId)) {
      byDomain.set(domainId, {
        icon: row.icon ?? null,
        label: row.label ?? domainId,
        unit: row.unit ?? null,
        type: row.type ?? "numeric",
        values: [],
        notes: [],
      });
    }
    const entry = byDomain.get(domainId)!;
    entry.values.push(row.value);
    if (row.note) entry.notes.push(row.note);
  }

  const dateDisplay = formatDateDisplay(now);
  let result = `📋 <b>Today's Summary — ${escapeHtml(dateDisplay)}</b>\n\n`;

  let totalEvents = 0;

  for (const [, entry] of byDomain) {
    const icon = entry.icon ?? "•";
    const total = entry.values.reduce((a, b) => a + b, 0);
    const count = entry.values.length;
    totalEvents += count;

    let valueDisplay: string;
    if (entry.type === "boolean") {
      const yesCount = entry.values.filter((v) => v >= 1).length;
      valueDisplay = yesCount > 0 ? "✅ Yes" : "❌ No";
    } else {
      const avg = total / count;
      const formattedAvg = avg % 1 === 0 ? avg.toFixed(0) : avg.toFixed(1);
      valueDisplay = `${bold(formattedAvg)}${entry.unit ? ` ${escapeHtml(entry.unit)}` : ""}`;
      if (count > 1) {
        valueDisplay += ` <i>(total: ${total}${entry.unit ? " " + escapeHtml(entry.unit) : ""})</i>`;
      }
    }

    result += `${icon} <b>${escapeHtml(entry.label)}:</b> ${valueDisplay}`;

    if (entry.notes.length > 0) {
      // Show first note inline, abbreviate if long
      const firstNote = entry.notes[0];
      const truncated = firstNote.length > 40 ? firstNote.slice(0, 40) + "…" : firstNote;
      result += ` <i>— ${escapeHtml(truncated)}</i>`;
    }

    result += "\n";
  }

  result += `${TODAY_HEADER_SEPARATOR}`;
  const domainCount = byDomain.size;
  result += `📊 ${bold(String(totalEvents))} event${totalEvents !== 1 ? "s" : ""} across ${bold(String(domainCount))} domain${domainCount !== 1 ? "s" : ""}`;

  return result;
}

// ─── Weekly trend report ────────────────────────────────────────────────

async function weeklyTrendReport(): Promise<string> {
  const domains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();

  if (domains.length === 0) {
    return "No domains configured. Run the seed script first:\n" + code("npx tsx src/lib/seed.ts");
  }

  // Date range: STATS_WEEKS weeks back + 1 week buffer
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - STATS_WEEKS * 7 - 7);
  const rangeStartStr = rangeStart.toISOString();

  let result = `📊 <b>Weekly Trends — Last ${STATS_WEEKS} weeks</b>\n\n`;
  let totalConsistency = 0;

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

    const maxValue = domain.maxValue ?? 10;
    const weekly = weeklyConsistencyScores(events, maxValue, STATS_WEEKS);
    const scores = weekly.map((w) => w.consistency);
    const trend = trendDirection(scores);
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    totalConsistency += avgScore;

    const trendIcon =
      trend === "improving" ? "📈" : trend === "declining" ? "📉" : "➡️";
    const icon = domain.icon ?? "•";
    const formattedAvg = avgScore.toFixed(2);

    result += `${icon} <b>${escapeHtml(domain.label)}</b>  ${trendIcon} ${trend}  <i>(${formattedAvg})</i>\n`;
  }

  const overallAvg = (totalConsistency / domains.length).toFixed(2);
  result += `\n📊 Overall consistency: <b>${overallAvg}</b>`;
  return result;
}

// ─── Log event ──────────────────────────────────────────────────────────

async function logEvent(
  domainId: string,
  value: number,
  note?: string
): Promise<{
  success: boolean;
  message: string;
  domain?: { icon: string | null; label: string; unit: string | null; type: string };
  finalValue?: number;
  timestamp?: string;
}> {
  const domain = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.id, domainId))
    .get();

  if (!domain) {
    return { success: false, message: `Domain "${domainId}" not found.` };
  }

  const min = domain.minValue ?? 0;
  const max = domain.maxValue ?? 10;
  const clampedValue = Math.max(min, Math.min(max, value));

  const finalValue =
    domain.type === "boolean" ? (clampedValue >= 1 ? 1 : 0) : clampedValue;

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  await db
    .insert(schema.events)
    .values({
      id,
      domainId,
      timestamp,
      value: finalValue,
      note: note ?? null,
      source: "telegram",
    })
    .run();

  const displayLabel = domain.icon
    ? `${domain.icon} ${domain.label}`
    : domain.label;
  const displayValue =
    domain.type === "boolean"
      ? finalValue === 1
        ? "Yes"
        : "No"
      : `${finalValue}${domain.unit ? ` ${domain.unit}` : ""}`;

  const clampedWarning =
    clampedValue !== value
      ? `\n⚠️ Value clamped to ${clampedValue} (range: ${min}–${max})`
      : "";

  return {
    success: true,
    message: `✅ ${displayLabel}: ${bold(String(displayValue))}${clampedWarning}`,
    domain: { icon: domain.icon, label: domain.label, unit: domain.unit, type: domain.type },
    finalValue,
    timestamp,
  };
}

// ─── Command handlers ──────────────────────────────────────────────────

// /start
bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "there";

  await bot.sendMessage(
    chatId,
    `Hey ${escapeHtml(name)}! 👋

I'm your <b>Life Quant</b> logging bot. I help you track your daily activities directly from Telegram.

${bold("Commands:")}
${code("/log <domain> <value> [note]")}  — Log an event
${code("/today")}                          — Today's summary
${code("/stats")}                          — Weekly consistency trends
${code("/snapshots")}                      — Generate weekly snapshots
${code("/correlate")}                      — Cross-domain correlations
${code("/review")}                         — LLM weekly review
${code("/sessions [domain]")}              — Session patterns
${code("/burnout [domain]")}               — Burnout risk assessment
${code("/anomalies")}                       — Detect anomalies
${code("/delete [id]")}                    — Delete/undo an event
${code("/help")}                           — Show this help

${bold("Examples:")}
${code("/log deep-work 3.5 focus session")}
${code("/log sleep 7.5")}
${code("/log mood 8 feeling great")}

Get started: ${code("/domains")} to see what you can track.`,
    { parse_mode: "HTML" }
  );
});

// /help
bot.onText(/^\/help$/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    `<b>Life Quant — Help</b>

${bold("Commands:")}
${code("/log <domain> <value> [note]")}  — Log an event
${code("/today")}                          — Today's summary
${code("/stats")}                          — Weekly consistency trends
${code("/snapshots [weeks]")}              — Generate weekly snapshots
${code("/correlate")}                      — Cross-domain correlations
${code("/review")}                         — LLM weekly review
${code("/sessions [domain]")}              — Session patterns
${code("/burnout [domain]")}               — Burnout risk assessment
${code("/anomalies")}                       — Detect anomalies
${code("/domains")}                        — List all domains
${code("/export")}                         — Export all data as JSON
${code("/csv")}                            — Export events as CSV
${code("/delete [id]")}                    — Delete/undo an event
${code("/help")}                           — Show this message
${code("/start")}                          — Welcome screen

${bold("Examples:")}
${code("/log deep-work 3.5 focus session")}
${code("/log sleep 7.5")}
${code("/log gym 1 morning workout")}
${code("/log mood 8")}

💡 <b>Tip:</b> You can use domain names or IDs.
   e.g., both ${code("/log deep-work 3")} and ${code("/log Deep Work 3")} work.`,
    { parse_mode: "HTML" }
  );
});

// /domains
bot.onText(/^\/domains$/, async (msg) => {
  const chatId = msg.chat.id;
  const text = await listDomainsMarkdown();
  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
});

// ─── Inline keyboard for domain selection ──────────────────────────────

async function sendDomainKeyboard(chatId: number, prefix?: string) {
  const domains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();

  if (domains.length === 0) {
    await bot.sendMessage(chatId, "No domains configured. Run the seed script first.");
    return;
  }

  const rows = [];
  for (const d of domains) {
    const label = d.icon ? `${d.icon} ${d.label}` : d.label;
    rows.push([{ text: label, callback_data: `log:${d.id}` }]);
  }

  await bot.sendMessage(chatId, "📋 Select a domain to log:", {
    reply_markup: { inline_keyboard: rows },
  });
}

// /log — Show domain selection (inline keyboard)
bot.onText(/^\/log$/, async (msg) => {
  await sendDomainKeyboard(msg.chat.id);
});

// /log <domain> <value> [note] — Direct log with arguments
bot.onText(/^\/log\s+(.+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match![1].trim();

  // Parse: domain value [note...]
  // Support both "domain value note" and "domain value" formats
  const parts = input.split(/\s+/);
  
  if (parts.length < 2) {
    await bot.sendMessage(
      chatId,
      `⚠️ Usage: ${code("/log <domain> <value> [note]")}

Example: ${code("/log deep-work 3.5 focus session")}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Parse domain — could be multi-word (e.g., "Deep Work")
  // Strategy: try to find domain matching from the start
  let domainInput: string;
  let valueStr: string;
  let noteInput: string | undefined;

  // Try first word as domain id first
  const firstWord = parts[0];
  const firstDomain = await findDomain(firstWord);

  if (firstDomain) {
    domainInput = firstWord;
    valueStr = parts[1];
    noteInput = parts.slice(2).join(" ") || undefined;
  } else {
    // Try first two words as domain label (e.g., "Deep Work")
    const twoWords = parts.slice(0, 2).join(" ");
    const twoWordDomain = await findDomain(twoWords);
    if (twoWordDomain) {
      domainInput = twoWords;
      valueStr = parts[2];
      noteInput = parts.slice(3).join(" ") || undefined;
    } else {
      // Use first word as domain, let findDomain give the error
      domainInput = firstWord;
      valueStr = parts[1];
      noteInput = parts.slice(2).join(" ") || undefined;
    }
  }

  if (!valueStr) {
    await bot.sendMessage(
      chatId,
      `⚠️ Missing value. Usage: ${code("/log <domain> <value> [note]")}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const parsedValue = parseFloat(valueStr);
  if (isNaN(parsedValue)) {
    await bot.sendMessage(
      chatId,
      `⚠️ Invalid value: "${escapeHtml(valueStr)}". Please enter a number.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Find the domain
  const domain = await findDomain(domainInput);
  if (!domain) {
    // Show available domains
    const domainsText = await listDomainsMarkdown();
    await bot.sendMessage(
      chatId,
      `⚠️ Domain "${escapeHtml(domainInput)}" not found.

${domainsText}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Log the event
  const result = await logEvent(domain.id, parsedValue, noteInput);

  if (result.success) {
    await bot.sendMessage(chatId, result.message, { parse_mode: "HTML" });
  } else {
    await bot.sendMessage(chatId, `❌ ${escapeHtml(result.message)}`, {
      parse_mode: "HTML",
    });
  }
});

// /today — Today's summary
bot.onText(/^\/today$/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const summary = await todaySummary();
    await bot.sendMessage(chatId, summary, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Failed to get today's summary:", error);
    await bot.sendMessage(
      chatId,
      `❌ Failed to generate today's summary. Please try again later.`,
      { parse_mode: "HTML" }
    );
  }
});

// /stats — Weekly consistency trends
bot.onText(/^\/stats$/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const report = await weeklyTrendReport();
    await bot.sendMessage(chatId, report, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Failed to generate stats:", error);
    await bot.sendMessage(
      chatId,
      `❌ Failed to generate stats report. Please try again later.`,
      { parse_mode: "HTML" }
    );
  }
});

// /export — Export all data as JSON file
bot.onText(/^\/export$/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, "📦 Exporting data...", { parse_mode: "HTML" });

    const data = await exportAll();
    const json = exportToJSON(data);
    const tmpFile = join(tmpdir(), `life-quant-export-${Date.now()}.json`);

    writeFileSync(tmpFile, json, "utf-8");

    await bot.sendDocument(chatId, tmpFile, {
      caption: `📊 Life Quant Export — ${data.events.length} events, ${data.domains.length} domains`,
    });

    unlinkSync(tmpFile);
  } catch (error) {
    console.error("Failed to export data:", error);
    await bot.sendMessage(
      chatId,
      `❌ Failed to export data. Please try again later.`,
      { parse_mode: "HTML" }
    );
  }
});

// /snapshots — Generate weekly consistency snapshots
bot.onText(/^\/snapshots(?:\s+(\d+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const weeks = match?.[1] ? parseInt(match[1], 10) : 26;

  try {
    const msg1 = await bot.sendMessage(chatId, `⏳ Generating ${weeks} weeks of snapshots...`);
    const results = await generateSnapshots({ weeks });
    const summary = summarizeSnapshots(results);
    await bot.editMessageText(
      `✅ Snapshots generated!\n\n<code>${escapeHtml(summary)}</code>`,
      { chat_id: chatId, message_id: msg1.message_id, parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Failed to generate snapshots:", error);
    await bot.sendMessage(chatId, `❌ Failed to generate snapshots.`);
  }
});

// /correlate — Compute cross-domain correlations
bot.onText(/^\/correlate$/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, "⏳ Computing cross-domain correlations...");
    const results = await computeAllCorrelations();

    // Take top 5 strongest correlations for the Telegram message
    const top = [...results]
      .sort((a, b) => Math.abs(b.pearsonR) - Math.abs(a.pearsonR))
      .slice(0, 5);

    let text = `<b>Cross-Domain Correlations</b>\n\n`;
    for (const r of top) {
      const strength =
        Math.abs(r.pearsonR) >= 0.7
          ? "strong"
          : Math.abs(r.pearsonR) >= 0.4
            ? "moderate"
            : "weak";
      const dir = r.pearsonR > 0 ? "+" : "";
      const sig = r.significance < 0.05 ? " *" : "";
      text += `${dir}${r.pearsonR.toFixed(3)} (${strength}, n=${r.sampleSize})${sig}\n`;
    }
    text += `\n<i>Top 5 of ${results.length} pairs shown</i>`;
    if (results.some((r) => r.significance < 0.05)) {
      text += `\n<i>* p &lt; 0.05 (significant)</i>`;
    }

    await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Failed to compute correlations:", error);
    await bot.sendMessage(chatId, `❌ Failed to compute correlations.`);
  }
});

// /review — LLM weekly review
bot.onText(/^\/review(?:\s+(\d+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const weeks = match?.[1] ? parseInt(match[1], 10) : 4;

  try {
    const msg1 = await bot.sendMessage(chatId, "⏳ Generating weekly review...");
    const result = await generateWeeklyReview(weeks);

    if (result.error && !result.review) {
      await bot.editMessageText(`❌ ${escapeHtml(result.error)}`, {
        chat_id: chatId,
        message_id: msg1.message_id,
        parse_mode: "HTML",
      });
      return;
    }

    const text = `<b>Weekly Review</b>\n\n${escapeHtml(result.review)}`;
    // Telegram has 4096 char limit, truncate if needed
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "…" : text;
    await bot.editMessageText(truncated, {
      chat_id: chatId,
      message_id: msg1.message_id,
      parse_mode: "HTML",
    });
  } catch (error) {
    console.error("Failed to generate review:", error);
    await bot.sendMessage(chatId, "❌ Failed to generate weekly review.");
  }
});

// /burnout — Burnout risk assessment
bot.onText(/^\/burnout(?:\s+(\S+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const domainId = match?.[1] || undefined;

  try {
    const msg1 = await bot.sendMessage(chatId, "⏳ Computing burnout risk assessment...");
    const result = await computeBurnoutRisk(domainId);

    const text = formatBurnoutReport(result);
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "…" : text;

    await bot.editMessageText(truncated, {
      chat_id: chatId, message_id: msg1.message_id, parse_mode: "HTML",
    });
  } catch (error) {
    console.error("Failed to compute burnout risk:", error);
    await bot.sendMessage(chatId, "❌ Failed to compute burnout risk.");
  }
});

// /sessions [domain] [days] — Session analytics
bot.onText(/^\/sessions(?:\s+(\S+))?(?:\s+(\d+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const domainId = match?.[1] || undefined;
  const days = match?.[2] ? parseInt(match[2], 10) : 90;

  try {
    const msg1 = await bot.sendMessage(chatId, `⏳ Analyzing session patterns (last ${days} days)...`);
    const reports = await sessionReport(domainId, days);

    if (reports.length === 0) {
      await bot.editMessageText("No session data found.", {
        chat_id: chatId, message_id: msg1.message_id,
      });
      return;
    }

    const text = `<b>Session Patterns</b> (last ${days}d)\n\n${formatSessionReport(reports)}`;
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "…" : text;

    await bot.editMessageText(truncated, {
      chat_id: chatId, message_id: msg1.message_id, parse_mode: "HTML",
    });
  } catch (error) {
    console.error("Failed session analysis:", error);
    await bot.sendMessage(chatId, "❌ Failed to analyze sessions.");
  }
});

// /delete [id] — Delete (undo) an event
bot.onText(/^\/delete(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;

  // ── With ID: delete specific event ──
  if (match?.[1]) {
    const eventId = match[1].trim();
    try {
      const event = await db
        .select({
          id: schema.events.id,
          domainId: schema.events.domainId,
          value: schema.events.value,
          note: schema.events.note,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .get();

      if (!event) {
        await bot.sendMessage(chatId, `❌ Event not found: ${code(eventId)}`, { parse_mode: "HTML" });
        return;
      }

      await db.delete(schema.events).where(eq(schema.events.id, eventId)).run();
      await bot.sendMessage(
        chatId,
        `🗑 Deleted event: ${code(event.domainId)} = ${String(event.value)}${event.note ? ` (${escapeHtml(event.note)})` : ""}`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      console.error("Failed to delete event:", error);
      await bot.sendMessage(chatId, "❌ Failed to delete event.", { parse_mode: "HTML" });
    }
    return;
  }

  // ── Without ID: show recent events ──
  try {
    const recent = await db
      .select({
        id: schema.events.id,
        domainId: schema.events.domainId,
        value: schema.events.value,
        note: schema.events.note,
        timestamp: schema.events.timestamp,
        icon: schema.domains.icon,
        label: schema.domains.label,
      })
      .from(schema.events)
      .leftJoin(schema.domains, eq(schema.events.domainId, schema.domains.id))
      .orderBy(desc(schema.events.timestamp))
      .limit(5)
      .all();

    if (recent.length === 0) {
      await bot.sendMessage(chatId, "No events to delete.", { parse_mode: "HTML" });
      return;
    }

    let text = `<b>Recent events</b>\n${code("/delete <id>")} to remove one:\n\n`;
    for (const e of recent) {
      const icon = e.icon ?? "•";
      const label = e.label ?? e.domainId;
      const date = e.timestamp.slice(0, 10);
      const time = e.timestamp.slice(11, 16);
      const noteStr = e.note ? ` <i>— ${escapeHtml(e.note.slice(0, 30))}</i>` : "";
      text += `${icon} <b>${escapeHtml(label)}</b> = ${String(e.value)}  <i>${escapeHtml(date)}</i> <i>${escapeHtml(time)}</i>${noteStr}\n${code(e.id)}\n\n`;
    }

    await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Failed to list events for delete:", error);
    await bot.sendMessage(chatId, "❌ Failed to list events.", { parse_mode: "HTML" });
  }
});

// /csv — Export events as CSV file
bot.onText(/^\/csv$/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, "📦 Generating CSV export...");
    const csv = await exportEventsCSV();
    const tmpFile = join(tmpdir(), `life-quant-events-${Date.now()}.csv`);
    writeFileSync(tmpFile, csv, "utf-8");

    const lines = csv.split("\n").length - 1;
    await bot.sendDocument(chatId, tmpFile, {
      caption: `📊 Events CSV — ${lines} rows`,
    });

    unlinkSync(tmpFile);
  } catch (error) {
    console.error("Failed to export CSV:", error);
    await bot.sendMessage(chatId, "❌ Failed to export CSV.");
  }
});

// ─── Inline keyboard callbacks ──────────────────────────────────────────

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId || !query.data) return;

  const [action, ...rest] = query.data.split(":");

  if (action === "log") {
    const domainId = rest.join(":");
    conversations.set(chatId, { step: "awaiting_value", domainId });

    const domain = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.id, domainId))
      .get();

    if (!domain) {
      await bot.sendMessage(chatId, "❌ Domain not found. Try again.");
      return;
    }

    const range = domain.type === "boolean" ? "0 or 1" : `${domain.minValue ?? 0}–${domain.maxValue ?? 10}`;
    await bot.sendMessage(
      chatId,
      `Enter value for ${domain.icon ?? ""} <b>${escapeHtml(domain.label)}</b> (${range}):`,
      { parse_mode: "HTML" },
    );

    // Answer callback to remove loading state
    await bot.answerCallbackQuery(query.id);
  }
});

// Fallback for unrecognized messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Ignore commands handled above and non-text messages
  if (!text || text.startsWith("/")) return;

  // Check for pending conversation
  const conv = conversations.get(chatId);
  if (conv?.step === "awaiting_value") {
    conversations.delete(chatId);

    const parsedValue = parseFloat(text);
    if (isNaN(parsedValue)) {
      await bot.sendMessage(chatId, `⚠️ "${escapeHtml(text)}" is not a valid number. Use /log to try again.`, { parse_mode: "HTML" });
      return;
    }

    const result = await logEvent(conv.domainId, parsedValue);
    if (result.success) {
      await bot.sendMessage(chatId, result.message, { parse_mode: "HTML" });
    } else {
      await bot.sendMessage(chatId, `❌ ${escapeHtml(result.message)}`, { parse_mode: "HTML" });
    }
    return;
  }

  // Show hint for unrecognized messages
  await bot.sendMessage(
    chatId,
    `Not sure what to do. Try:
${code("/log <domain> <value> [note]")}  — Log an event
${code("/today")}                          — Today's summary
${code("/stats")}                          — Weekly trends
${code("/snapshots")}                      — Generate snapshots
${code("/correlate")}                      — Correlations
${code("/review")}                         — Weekly review
${code("/domains")}                        — List domains
${code("/export")}                         — Export data
${code("/csv")}                            — Export CSV
${code("/sessions")}                       — Session patterns
${code("/burnout")}                        — Burnout risk
${code("/anomalies")}                      — Detect anomalies
${code("/delete")}                         — Undo event
${code("/help")}                           — Show help`,
    { parse_mode: "HTML" }
  );
});

// /anomalies — Detect statistical anomalies
bot.onText(/^\/anomalies(?:\s+(\S+))?(?:\s+(\d+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const domainId = match?.[1] || undefined;
  const days = match?.[2] ? parseInt(match[2], 10) : 90;

  try {
    const msg1 = await bot.sendMessage(chatId, "⏳ Scanning for anomalies...");
    const result = await detectAnomalies(domainId, days);

    const text = formatAnomalyReport(result);
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "…" : text;

    await bot.editMessageText(truncated, {
      chat_id: chatId, message_id: msg1.message_id, parse_mode: "HTML",
    });
  } catch (error) {
    console.error("Failed to detect anomalies:", error);
    await bot.sendMessage(chatId, "❌ Failed to detect anomalies.");
  }
});

// ─── Startup ────────────────────────────────────────────────────────────

(async () => {
  const me = await bot.getMe();
  console.log("🤖 Life Quant Telegram Bot started!");
  console.log(`   Bot username: @${me.username}`);
  console.log("   Polling for messages... (Ctrl+C to stop)");
})();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down bot...");
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down bot...");
  bot.stopPolling();
  process.exit(0);
});
