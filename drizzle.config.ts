import { defineConfig } from "drizzle-kit";

const tursoUrl = process.env.TURSO_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "sqlite",
  // drizzle-kit's sqlite dialect accepts authToken for libSQL/Turso URLs,
  // even though the generated type only lists `url`.
  dbCredentials: {
    url: tursoUrl ?? process.env.DB_PATH ?? "data.db",
    ...(tursoUrl ? { authToken: tursoAuthToken } : {}),
  },
});

