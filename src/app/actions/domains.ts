"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function getDomains() {
  return db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.archived, false))
    .all();
}
