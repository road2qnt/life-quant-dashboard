import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Local SQLite file (CLI/bot/seed) OR remote Turso (Vercel + multi-device).
// Turso wins if TURSO_URL is set; otherwise fall back to a local file path.
const tursoUrl = process.env.TURSO_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl && !process.env.DB_PATH) {
  // Default local file path for dev without Turso configured
  process.env.DB_PATH = "data.db";
}

// libSQL requires a URL scheme. Bare file paths need "file:" prefix.
function toLibsqlUrl(rawPath: string): string {
  if (/^(https?|libsql|file):/.test(rawPath)) return rawPath;
  return `file:${rawPath}`;
}

const client = createClient(
  tursoUrl
    ? { url: tursoUrl, authToken: tursoAuthToken }
    : { url: toLibsqlUrl(process.env.DB_PATH!) }
);

export const db = drizzle(client, { schema });
export { schema };
