import { defineConfig } from "vitest/config";

/**
 * Two projects.
 *
 *   unit  Pure logic. No database, runs anywhere.
 *   db    The stock ledger against a real Postgres: transactions, row locks and
 *         the races they exist to prevent cannot be tested with mocks. Runs in
 *         its own database (techgear_erp_test), created and migrated by the
 *         global setup, so the seeded demo data is never touched.
 *
 * `npm test` runs both. Set SKIP_DB_TESTS=1 to run only the unit project on a
 * machine without Postgres.
 */
export default defineConfig({
  resolve: {
    // Vite resolves the "@/*" alias from tsconfig natively.
    tsconfigPaths: true,
  },
  test: {
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["tests/integration/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // Files share one database; running them one at a time keeps each
          // file's concurrency tests the only concurrency in flight.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
