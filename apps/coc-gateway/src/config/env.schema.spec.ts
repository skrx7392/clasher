import { validateEnv } from "./env.schema";

describe("validateEnv (NFR-6 fail-loud)", () => {
  it("parses valid env and defaults the proxy base URL", () => {
    const env = validateEnv({ COC_API_KEY: "k" });
    expect(env.COC_API_KEY).toBe("k");
    expect(env.COC_PROXY_BASE_URL).toBe("https://cocproxy.royaleapi.dev/v1");
    expect(env.PORT).toBe(3100);
  });

  it("throws when the official key is missing (and names it, not its value)", () => {
    expect(() => validateEnv({})).toThrow(/COC_API_KEY/);
  });

  it("rejects a non-http proxy URL", () => {
    expect(() => validateEnv({ COC_API_KEY: "k", COC_PROXY_BASE_URL: "ftp://x" })).toThrow(
      /COC_PROXY_BASE_URL/,
    );
  });
});
