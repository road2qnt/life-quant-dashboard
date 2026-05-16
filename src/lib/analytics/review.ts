import { eq, desc, and, sql } from "drizzle-orm";
import { db, schema } from "../db";

export interface WeeklyReviewData {
  domainId: string;
  label: string;
  icon: string | null;
  weekStart: string;
  consistency: number;
  totalValue: number;
  numEvents: number;
  trend: string;
  avgValue: number;
  activeDays: number;
  maxValue: number;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  domains: WeeklyReviewData[];
  rawPrompt: string;
  review: string;
  error?: string;
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00.000Z");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

export async function fetchLatestSnapshots(weeks?: number): Promise<Map<string, WeeklyReviewData[]>> {
  const weeksBack = weeks ?? 4;

  const snapshots = await db
    .select({
      domainId: schema.weeklySnapshots.domainId,
      weekStart: schema.weeklySnapshots.weekStart,
      consistency: schema.weeklySnapshots.consistency,
      totalValue: schema.weeklySnapshots.totalValue,
      numEvents: schema.weeklySnapshots.numEvents,
      trend: schema.weeklySnapshots.trend,
      metadata: schema.weeklySnapshots.metadata,
    })
    .from(schema.weeklySnapshots)
    .orderBy(desc(schema.weeklySnapshots.weekStart))
    .limit(weeksBack * 20) // Rough upper bound
    .all();

  // Get domain info
  const domains = await db
    .select({ id: schema.domains.id, label: schema.domains.label, icon: schema.domains.icon, maxValue: schema.domains.maxValue })
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();
  const domainMap = new Map(domains.map((d) => [d.id, d]));

  // Group by domain
  const byDomain = new Map<string, WeeklyReviewData[]>();

  for (const snap of snapshots) {
    const info = domainMap.get(snap.domainId);
    if (!info) continue;

    const meta = snap.metadata ? JSON.parse(snap.metadata) : {};

    const data: WeeklyReviewData = {
      domainId: snap.domainId,
      label: info.label,
      icon: info.icon,
      weekStart: snap.weekStart,
      consistency: snap.consistency ?? 0,
      totalValue: snap.totalValue ?? 0,
      numEvents: snap.numEvents ?? 0,
      trend: snap.trend ?? "insufficient",
      avgValue: meta.avgValue ?? 0,
      activeDays: meta.activeDays ?? 0,
      maxValue: info.maxValue ?? 10,
    };

    if (!byDomain.has(snap.domainId)) byDomain.set(snap.domainId, []);
    byDomain.get(snap.domainId)!.push(data);
  }

  return byDomain;
}

function buildPrompt(byDomain: Map<string, WeeklyReviewData[]>): string {
  let prompt = `I track my daily habits using a life quant dashboard. Here are my weekly consistency scores for the past few weeks. Each domain is scored 0.0-1.0 (higher = more consistent). Trend shows if I'm improving, declining, or stable.

`;
  let domainCount = 0;

  for (const [domainId, snapshots] of byDomain) {
    const latest = snapshots[0];
    domainCount++;

    const scores = snapshots.map((s) => s.consistency.toFixed(3)).join(", ");
    prompt += `Domain: ${latest.icon ?? ""} ${latest.label} (${domainId})
  Weekly scores: ${scores}
  Trend: ${latest.trend}
  Latest consistency: ${(latest.consistency * 100).toFixed(0)}%
  Active days this week: ${latest.activeDays}/7
  Avg value per day: ${latest.avgValue.toFixed(1)}/${latest.maxValue}

`;
  }

  prompt += `Please write a brief weekly review (2-3 paragraphs):
1. Overall assessment of my consistency across domains
2. Notable trends or changes
3. One specific, actionable recommendation for next week

Write in a supportive, direct tone. No fluff. Use plain text.`;

  return prompt;
}

function getConfig() {
  return {
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  };
}

async function callLLM(prompt: string): Promise<string> {
  const config = getConfig();

  if (!config.apiKey) {
    throw new Error(
      "LLM_API_KEY not set. Set it in .env to enable weekly reviews.\n" +
      "  LLM_API_KEY=sk-...\n" +
      "  LLM_MODEL=gpt-4o-mini (optional, default)\n" +
      "  LLM_BASE_URL=https://api.openai.com/v1 (optional)",
    );
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "You are a life coach analyzing personal tracking data. Be insightful, direct, and supportive. No markdown, no bullet points unless necessary. Write in plain paragraphs.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM API error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "No response generated.";
}

export async function generateWeeklyReview(weeks?: number): Promise<WeeklyReview> {
  const byDomain = await fetchLatestSnapshots(weeks);

  if (byDomain.size === 0) {
    return {
      weekStart: "",
      weekEnd: "",
      domains: [],
      rawPrompt: "",
      review: "No snapshot data found. Run snapshots first:\n  npx tsx src/cli/data.ts snapshots",
      error: "No data",
    };
  }

  // Get the week range from the first domain's snapshots
  const firstDomain = byDomain.values().next().value!;
  const weekStart = firstDomain[firstDomain.length - 1]?.weekStart ?? "";
  const weekEnd = firstDomain[0]?.weekStart ?? "";

  const domains = Array.from(byDomain.values()).flat();
  const rawPrompt = buildPrompt(byDomain);

  try {
    const review = await callLLM(rawPrompt);
    return { weekStart, weekEnd, domains, rawPrompt, review };
  } catch (err) {
    return {
      weekStart,
      weekEnd,
      domains,
      rawPrompt,
      review: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
