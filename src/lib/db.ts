import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";

/**
 * Prisma 7 requires a driver adapter; the connection URL no longer lives in the
 * schema. See prisma.config.ts for the CLI side of the same configuration.
 */
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

/**
 * Next dev does hot module replacement, which would otherwise open a new pool
 * on every reload until Postgres refuses connections.
 */
export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
