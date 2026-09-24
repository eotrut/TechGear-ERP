import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { recomputeSegments } from "../src/features/customers/services/segments";

/**
 * Recompute every customer's segment and rollups from order history.
 *
 * Orders move a customer's segment as they complete, but nothing happens at
 * the moment a customer goes quiet, so Dormant needs a clock. This is that
 * clock: run it nightly from cron or a scheduled job (decision D-9). The same
 * function backs the "Refresh segments" button on the customer directory.
 *
 * Usage: npm run db:segments
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const result = await prisma.$transaction((tx) => recomputeSegments(tx, new Date()));
  console.log(`Recomputed ${result.customers} customers, ${result.changed} changed segment.`);
  for (const [segment, count] of Object.entries(result.counts)) {
    console.log(`  ${segment.padEnd(8)} ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
