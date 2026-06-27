/**
 * Sensitive object keys whose VALUES must never be logged. Matches the in-game
 * `token` from verifytoken (FR-4, NFR-11) plus general credential keys.
 * Intentionally broad (substring) — on the one service that holds the official
 * key, over-redacting a benign field (e.g. `tokenCount`) is an acceptable price
 * for never leaking a credential.
 */
const SENSITIVE_KEY = /token|authorization|api[-_]?key|secret|password|cookie/i;
const REDACTED = "[REDACTED]";
const REDACTED_BINARY = "[REDACTED_BINARY]";

/** JWT-shaped value (the official CoC key is a JWT); three base64url segments. */
const JWT_RE = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/** `token=… / authorization: bearer … / api-key: …` inside a string (URLs, headers, messages). */
const INLINE_SECRET_RE =
  /((?:authorization|token|api[_-]?key)["':=\s]+(?:bearer\s+)?|bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;

export interface RedactOptions {
  /** Literal secret strings (e.g. the official key) to scrub from ANY string. */
  secrets?: readonly string[];
}

/**
 * A captured inline value is treated as a secret when it contains a digit or is
 * long (≥16). This catches realistic tokens/keys (e.g. `token=ABC12345`) while
 * leaving benign all-letter words after a label (e.g. `COC_API_KEY: Required`)
 * intact, so config/error hints stay actionable.
 */
function looksSecret(value: string): boolean {
  return /\d/.test(value) || value.length >= 16;
}

/** Scrub secrets out of a single string value (literals, JWTs, inline key=value). */
export function redactString(input: string, secrets: readonly string[] = []): string {
  let out = input;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(JWT_RE, REDACTED);
  out = out.replace(INLINE_SECRET_RE, (match: string, label: string, value: string) =>
    looksSecret(value) ? `${label}${REDACTED}` : match,
  );
  return out;
}

function isBinary(value: object): boolean {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return true;
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/**
 * Deep-redact secrets from an arbitrary structure before logging — the
 * enforcement point for "verifytoken/keys are redacted from logs/traces/error
 * capture" (DESIGN §5/§10, NFR-11, FR-4). Pure (never mutates input):
 *  - sensitive KEYS (objects and Maps) → `[REDACTED]`;
 *  - string VALUES (error messages/stacks, URLs) scrubbed for known secrets,
 *    JWTs, and inline `token=…` patterns;
 *  - `Error` → `{name, message, stack, cause}` (all scrubbed);
 *  - `Map`/`Set`/`Date` normalized instead of flattening to `{}`;
 *  - `Buffer`/`ArrayBuffer`/typed arrays → `[REDACTED_BINARY]` (could hold a key);
 *  - functions (incl. a hostile `toJSON`) dropped so `JSON.stringify` can't
 *    re-materialize raw data;
 *  - cycles handled.
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

  if (isBinary(value)) return REDACTED_BINARY;

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message, secrets),
    };
    if (value.stack) out.stack = redactString(value.stack, secrets);
    if (value.cause !== undefined) out.cause = redactSecrets(value.cause, options, seen);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) {
      const key = String(k);
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(v, options, seen);
    }
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
