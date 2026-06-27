/** Safe upper bound for outbound CoC calls through the proxy (DESIGN §9). */
export const COC_MAX_RPS = 10;

/**
 * Throttle for outbound CoC calls. A real token-bucket (~{@link COC_MAX_RPS}/s,
 * with 429 backoff) lands with live calls in M2; this stub makes the seam exist
 * now so callers depend on the interface, not a concrete limiter.
 */
export interface RateLimiter {
  /** Resolves when a request slot is available. */
  acquire(): Promise<void>;
}

/** No-op limiter placeholder (no live calls yet). */
export class NoopRateLimiter implements RateLimiter {
  acquire(): Promise<void> {
    return Promise.resolve();
  }
}
