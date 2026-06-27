/**
 * Sensitive object keys whose VALUES must never be logged. Matches the in-game
 * `token` from verifytoken (FR-4, NFR-11) plus general credential keys.
 * Intentionally broad (substring) — on the one service that holds the official
 * key, over-redacting a benign field (e.g. `tokenCount`) is an acceptable price
 * for never leaking a credential.
 */
const SENSITIVE_KEY = /token|authorization|api[-_]?key|secret|password|cookie/i;
const REDACTED = "[REDACTED]";

/** JWT-shaped value (the official CoC key is a JWT); three base64url segments. */
const JWT_RE = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/**
 * `token=… / authorization: bearer … / api-key: …` inside a string (URLs,
 * headers, messages). The value must be secret-length (≥16 of a token charset)
 * so benign hints like `COC_API_KEY: Required` are not mangled; long keys/tokens
 * are also covered by literal-secret and JWT scrubbing above.
 */
const INLINE_SECRET_RE =
  /((?:authorization|token|api[_-]?key)["':=\s]+(?:bearer\s+)?|bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi;

export interface RedactOptions {
  /** Literal secret strings (e.g. the official key) to scrub from ANY string. */
  secrets?: readonly string[];
}

/** Scrub secrets out of a single string value (literals, JWTs, inline key=value). */
export function redactString(input: string, secrets: readonly string[] = []): string {
  let out = input;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(JWT_RE, REDACTED);
  out = out.replace(INLINE_SECRET_RE, (_m, label: string) => `${label}${REDACTED}`);
  return out;
}

/**
 * Deep-redact secrets from an arbitrary structure before logging — the
 * enforcement point for "verifytoken/keys are redacted from logs/traces/error
 * capture" (DESIGN §5/§10, NFR-11, FR-4). Pure (never mutates input):
 *  - sensitive KEYS → `[REDACTED]`;
 *  - string VALUES (incl. error messages/stacks, URLs) are scrubbed for known
 *    secrets, JWTs, and inline `token=…` patterns;
 *  - `Error` → `{name, message, stack}` (scrubbed) so error logs stay useful;
 *  - `Map`/`Set`/`Date` are normalized instead of flattening to `{}`;
 *  - functions (incl. a hostile `toJSON`) are dropped so `JSON.stringify` can't
 *    re-materialize raw data;
 *  - cycles are handled.
 */
export function redactSecrets(
  value: unknown,
  options: RedactOptions = {},
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  const secrets = options.secrets ?? [];

  if (typeof value === "string") return redactString(value, secrets);
  if (typeof value === "function") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, secrets),
      ...(value.stack ? { stack: redactString(value.stack, secrets) } : {}),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) out[String(k)] = redactSecrets(v, options, seen);
    return out;
  }
  if (value instanceof Set) return [...value].map((v) => redactSecrets(v, options, seen));
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, options, seen));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "function") continue; // drop functions incl. toJSON
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(val, options, seen);
  }
  return out;
}
