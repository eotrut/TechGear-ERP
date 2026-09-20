import { z } from "zod";

/**
 * Environment contract. SPEC section 8 requires env vars to be validated at
 * startup rather than read ad hoc, so a misconfigured deployment fails loudly
 * on boot instead of quietly at the first query.
 *
 * Import this module for `env.DATABASE_URL`; never read `process.env` directly.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters. Generate one with: npx auth secret"),
  AUTH_URL: z.url("AUTH_URL must be an absolute URL, for example http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration.\n${issues}\n\nCopy .env.example to .env.local and fill in the values.`,
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();
