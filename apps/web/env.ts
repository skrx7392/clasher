/**
 * Server-only env access for the web app. Read LAZILY (functions, not top-level
 * constants) so `next build` succeeds without real values — the M0 scaffold ships
 * with placeholders and the real Google credentials land in M1 (D-1, NFR-3).
 *
 * AUTH_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are read directly by
 * Auth.js (see auth.config.ts) and are never exposed to the client.
 */

/**
 * Production *runtime* (not the build phase). `next build` runs with
 * NODE_ENV=production too, but sets NEXT_PHASE=phase-production-build — we must NOT
 * fail there (the M0 build ships without real values). Only the running server
 * should fail-closed on missing config (NFR-6).
 */
function isProdRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build"
  );
}

/**
 * Base URL of the NestJS API for server-side calls (the sign-in upsert). In prod
 * this is the in-cluster Service DNS `http://api.clasher-backend.svc.cluster.local:3000`
 * (reached over the existing web→api NetworkPolicy); locally it's the dev API.
 * Fails closed at runtime if unset in production rather than posting to localhost.
 */
export function apiBaseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (url) {
    // Validate the shape: a malformed value (e.g. host:port without a scheme) would
    // otherwise only fail later inside the sign-in best-effort catch and be swallowed.
    if (!/^https?:\/\//.test(url)) {
      throw new Error(`API_BASE_URL must be an http(s) URL (got '${url}')`);
    }
    return url;
  }
  if (isProdRuntime()) throw new Error("API_BASE_URL is required in production");
  // Dev fallback uses :3001 because the API and `next dev` both default to :3000.
  return "http://localhost:3001";
}

/**
 * True when Auth.js is serving over HTTPS (prod) — drives Secure/__Secure- cookies.
 * Fails closed at runtime: production MUST set an https `AUTH_URL`, otherwise we'd
 * silently downgrade the session cookie to non-Secure.
 */
export function useSecureCookies(): boolean {
  const secure = (process.env.AUTH_URL ?? "").startsWith("https://");
  if (!secure && isProdRuntime()) {
    throw new Error("AUTH_URL must be an https:// origin in production (Secure cookies)");
  }
  return secure;
}
