import { validateEnv } from "./env.schema";

describe("validateEnv (NFR-6 fail-loud config)", () => {
  const valid = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    REDIS_QUEUE_URL: "redis://localhost:6379/0",
    REDIS_CACHE_URL: "redis://localhost:6379/1",
  };

  it("parses valid env and applies defaults", () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it("throws an actionable error naming a missing required var", () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid URL", () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });
});
