import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 no longer accepts `url` inside the schema datasource, and it no
 * longer loads .env automatically. Next.js reads .env.local, so we load that
 * first and fall back to .env, which keeps one set of credentials for both the
 * app and the CLI.
 */
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed/index.ts",
  },
});
