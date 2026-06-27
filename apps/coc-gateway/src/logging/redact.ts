/**
 * Sensitive object keys that must never be logged. Matches the in-game
 * `token` from verifytoken (FR-4, NFR-11) plus general credential keys.
 */
const SENSITIVE_KEY = /token|authorization|api[-_]?key|secret|password|cookie/i;
const REDACTED = "[REDACTED]";

/**
 * Deep-redact sensitive values from an arbitrary structure before logging.
 * Any property whose KEY matches {@link SENSITIVE_KEY} is replaced with
 * `[REDACTED]`; nested objects/arrays are walked; cycles are handled. Pure — it
 * never mutates the input. This is the enforcement point for "verifytoken bodies
 * are redacted from logs/traces/error capture" (DESIGN §5/§10).
 */
export function redactSecrets(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(val, seen);
  }
  return out;
}
