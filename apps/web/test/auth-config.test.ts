import { describe, it, expect, beforeAll, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";

// Auth.js reads these at import time (auth.config.ts computes cookie security from
// AUTH_URL). Set a prod-like HTTPS origin so Secure cookies are asserted.
let authConfig: NextAuthConfig;

beforeAll(async () => {
  process.env.AUTH_URL = "https://clasher.skpodduturi.dev";
  process.env.AUTH_SECRET = "test-secret";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  ({ authConfig } = await import("../auth.config"));
});

describe("auth.config (#15)", () => {
  it("uses the Google provider", () => {
    const ids = authConfig.providers.map((p) => (typeof p === "function" ? p().id : p.id));
    expect(ids).toContain("google");
  });

  it("uses stateless JWT sessions", () => {
    expect(authConfig.session?.strategy).toBe("jwt");
  });

  it("session cookie is HttpOnly + Secure + SameSite (DESIGN §10)", () => {
    const opts = authConfig.cookies?.sessionToken?.options;
    expect(opts?.httpOnly).toBe(true);
    expect(opts?.secure).toBe(true);
    // Lax (not Strict) so the cross-site OAuth callback still carries the cookie.
    expect(opts?.sameSite).toBe("lax");
    expect(authConfig.cookies?.sessionToken?.name).toBe("__Secure-authjs.session-token");
  });

  it("signIn fails closed on a production API misconfiguration (does not swallow it)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_BASE_URL", undefined);
    try {
      const signIn = authConfig.callbacks?.signIn;
      if (!signIn) throw new Error("signIn callback is not configured");
      const call = signIn as unknown as (p: unknown) => Promise<unknown>;
      // A prod config error (apiBaseUrl throws) must reject sign-in, not return true.
      await expect(call({ user: { id: "u1" }, profile: { sub: "u1" } })).rejects.toThrow(
        /API_BASE_URL/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
