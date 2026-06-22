"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function logEvent(input: {
  domainId: string;
  value: number;
  note?: string;
}) {
  try {
    await db.insert(schema.events).values({
      id: crypto.randomUUID(),
      domainId: input.domainId,
      value: input.value,
      note: input.note ?? null,
      timestamp: new Date().toISOString(),
      source: "web",
    });
    revalidatePath("/");
    return { success: true as const };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function deleteEvent(id: string) {
  try {
    await db.delete(schema.events).where(eq(schema.events.id, id)).run();
    revalidatePath("/");
    return { success: true as const };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function getRecentEvents(limit = 10) {
  return db
    .select({
      id: schema.events.id,
      domainId: schema.events.domainId,
      domainLabel: schema.domains.label,
      domainIcon: schema.domains.icon,
      value: schema.events.value,
      note: schema.events.note,
      timestamp: schema.events.timestamp,
    })
    .from(schema.events)
    .innerJoin(schema.domains, eq(schema.events.domainId, schema.domains.id))
    .orderBy(desc(schema.events.timestamp))
    .limit(limit)
    .all();
}
