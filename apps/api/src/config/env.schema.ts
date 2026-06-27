import { z } from "zod";

/**
 * Environment contract for the API. Every variable the service genuinely needs
 * is required here so misconfiguration is caught at startup, not at first use.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_QUEUE_URL: z.string().url(),
  REDIS_CACHE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate the process environment at startup. Throws an actionable error that
 * lists every missing/invalid variable, so the service fails loud rather than
 * booting with silent defaults (NFR-6). Returned value becomes the validated
 * config consumed via Nest's ConfigService.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
