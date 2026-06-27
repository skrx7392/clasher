/**
 * Server-only env access for the web app. Read LAZILY (functions, not top-level
 * constants) so `next build` succeeds without real values — the M0 scaffold ships
 * with placeholders and the real Google credentials land in M1 (D-1, NFR-3).
 *
 * AUTH_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are read directly by
 * Auth.js (see auth.config.ts) and are never exposed to the client.
 */

/**
 * Base URL of the NestJS API for server-side calls (the sign-in upsert). In prod
 * this is the in-cluster Service DNS `http://api.clasher-backend.svc.cluster.local:3000`
 * (reached over the existing web→api NetworkPolicy); locally it's the dev API.
 */
export function apiBaseUrl(): string {
  // Dev fallback uses :3001 because the API and `next dev` both default to :3000
  // (run the API on another port locally). Prod always sets API_BASE_URL.
  return process.env.API_BASE_URL ?? "http://localhost:3001";
}

/** True when Auth.js is serving over HTTPS (prod) — drives Secure/__Secure- cookies. */
export function useSecureCookies(): boolean {
  return (process.env.AUTH_URL ?? "").startsWith("https://");
}
