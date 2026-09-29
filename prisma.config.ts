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

// `prisma generate` runs on `npm install` (postinstall) and never connects, so
// a fresh clone can install before .env.local exists. Everything else needs
// the database and fails here with instructions rather than deep in Prisma.
const generating = process.argv.includes("generate");

if (!databaseUrl && !generating) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed/index.ts",
  },
});
