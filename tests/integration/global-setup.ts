import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import pg from "pg";
import type { TestProject } from "vitest/node";

/**
 * Creates, migrates and empties the test database once per run.
 *
 * The URL is the development DATABASE_URL with the database name swapped for
 * `<name>_test`, unless TEST_DATABASE_URL says otherwise. Tests receive it
 * through Vitest's provide/inject rather than process.env, so nothing in a
 * test can accidentally connect to the demo data.
 */

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local, or set SKIP_DB_TESTS=1.",
    );
  }
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  url.pathname = `/${name}_test`;
  return url.toString();
}

export default async function setup(project: TestProject): Promise<void> {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  if (process.env.SKIP_DB_TESTS === "1") {
    project.provide("databaseUrl", "");
    return;
  }

  const testUrl = testDatabaseUrl();
  const databaseName = new URL(testUrl).pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (!/^[a-z0-9_]+$/i.test(databaseName) || !databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run database tests against "${databaseName}": the name must end in _test.`,
    );
  }

  // Create the database through the maintenance connection if it is missing.
  const admin = new URL(testUrl);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Postgres is not reachable for the database tests (${(error as Error).message}). ` +
        `Start it with "npm run db:up", or set SKIP_DB_TESTS=1 to run only the unit tests.`,
    );
  }
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }

  // Same migrations the app runs, so the CHECK constraints are the real ones.
  execFileSync(
    process.execPath,
    [join("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: "pipe",
    },
  );

  // Start every run from empty tables.
  const test = new pg.Client({ connectionString: testUrl });
  await test.connect();
  try {
    const { rows } = await test.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`,
    );
    if (rows.length > 0) {
      await test.query(
        `TRUNCATE TABLE ${rows.map((row) => `"${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
  } finally {
    await test.end();
  }

  project.provide("databaseUrl", testUrl);
}
