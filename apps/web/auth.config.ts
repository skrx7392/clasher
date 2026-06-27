import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { apiBaseUrl, useSecureCookies } from "./env";
import { upsertUserViaApi } from "./lib/upsert-user";

const secure = useSecureCookies();

/**
 * Auth.js (v5) configuration — Google OAuth (OpenID Connect; `openid email
 * profile`), scaffolded for M0 (FR-1; DESIGN §2). The real Google credentials are
 * a prereq of the M1 auth slice (D-1); here the client id/secret and AUTH_SECRET
 * are read from the environment (placeholders documented in .env.example), never
 * hard-coded and never sent to the client (NFR-3).
 *
 * Split out from `auth.ts` (the NextAuth() call) so this config object is unit-
 * testable without initialising the runtime.
 *
 * COOKIES & CSRF (DESIGN §10): the session cookie is HttpOnly + Secure (in prod) +
 * SameSite. SameSite is **Lax**, not Strict: the OAuth callback is a top-level
 * cross-site redirect back from Google, and a Strict cookie would not be sent on
 * that navigation, breaking sign-in. CSRF is covered by Auth.js's built-in CSRF
 * token (a double-submit cookie); origin checks are fully enforced in M1
 * (see apps/web/AUTH.md).
 */
export const authConfig: NextAuthConfig = {
  // AUTH_SECRET is read from the environment by Auth.js automatically (not set here
  // so the M0 build needs no value). `?? ""` keeps the client placeholders typed as
  // string — an empty value leaves the provider inert until the real Google
  // credentials arrive in M1 (D-1), which is the intended M0 scaffold state.
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  cookies: {
    sessionToken: {
      name: secure ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
  },
  callbacks: {
    /**
     * On sign-in, upsert the user into the API (role defaults to 'none'). M0 is
     * best-effort: a failed upsert (e.g. API unreachable, no real creds yet) is
     * logged but does not block the sign-in scaffold. M1 makes it authoritative.
     */
    async signIn({ user, profile }) {
      const googleSub = profile?.sub ?? user.id;
      if (!googleSub) return false;
      try {
        await upsertUserViaApi(
          { googleSub, email: user.email ?? null, name: user.name ?? null },
          apiBaseUrl(),
        );
      } catch (err) {
        console.warn(`[auth] user upsert failed (M0 best-effort): ${String(err)}`);
      }
      return true;
    },
  },
};
