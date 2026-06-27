import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("redacts a token at any depth, leaving other fields intact", () => {
    const input = {
      tag: "#PYL",
      req: { body: { token: "SUPERSECRET", note: "keep" } },
    };
    const out = redactSecrets(input) as typeof input;
    expect(out.req.body.token).toBe("[REDACTED]");
    expect(out.req.body.note).toBe("keep");
    expect(out.tag).toBe("#PYL");
  });

  it("redacts general credential keys (authorization, api-key, password, secret, cookie)", () => {
    const out = redactSecrets({
      authorization: "Bearer x",
      apiKey: "k",
      "api-key": "k2",
      password: "p",
      secret: "s",
      cookie: "c",
    }) as Record<string, string>;
    for (const v of Object.values(out)) expect(v).toBe("[REDACTED]");
  });

  it("walks arrays and does not mutate the input", () => {
    const input = { items: [{ token: "a" }, { token: "b" }] };
    const out = redactSecrets(input) as { items: { token: string }[] };
    expect(out.items.map((i) => i.token)).toEqual(["[REDACTED]", "[REDACTED]"]);
    expect(input.items[0]?.token).toBe("a"); // original untouched
  });

  it("handles cycles without throwing", () => {
    const a: Record<string, unknown> = { token: "x" };
    a.self = a;
    const out = redactSecrets(a) as Record<string, unknown>;
    expect(out.token).toBe("[REDACTED]");
    expect(out.self).toBe("[Circular]");
  });

  it("passes through primitives unchanged", () => {
    expect(redactSecrets("hi")).toBe("hi");
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBeNull();
  });
});
