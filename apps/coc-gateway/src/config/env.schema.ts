import { z } from "zod";

/**
 * Environment contract for the coc-gateway. This service is the SOLE holder of
 * the official Clash of Clans key, so it is required here and fails loud if
 * absent (DESIGN §1/§9, NFR-6/NFR-11).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3100),
  COC_API_KEY: z.string().min(1, "the official Clash of Clans API key is required"),
  // All outbound CoC traffic goes through the RoyaleAPI proxy (whitelist
  // 45.79.218.79), never api.clashofclans.com directly in the pilot (ANALYSIS §1.1).
  COC_PROXY_BASE_URL: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), "must be an http(s) URL")
    .default("https://cocproxy.royaleapi.dev/v1"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate the process environment at startup. Throws an actionable, per-variable
 * error so the service fails loud rather than booting misconfigured (NFR-6). The
 * error message lists variable names only — never values (no key leakage).
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
