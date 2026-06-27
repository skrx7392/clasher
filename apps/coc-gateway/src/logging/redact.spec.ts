import { redactSecrets, redactString } from "./redact";

describe("redactSecrets — keys", () => {
  it("redacts a token at any depth, leaving other fields intact", () => {
    const input = { tag: "#PYL", req: { body: { token: "SUPERSECRET", note: "keep" } } };
    const out = redactSecrets(input) as typeof input;
    expect(out.req.body.token).toBe("[REDACTED]");
    expect(out.req.body.note).toBe("keep");
    expect(out.tag).toBe("#PYL");
  });

  it("redacts general credential keys", () => {
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
    expect(input.items[0]?.token).toBe("a");
  });

  it("handles cycles", () => {
    const a: Record<string, unknown> = { token: "x" };
    a.self = a;
    const out = redactSecrets(a) as Record<string, unknown>;
    expect(out.token).toBe("[REDACTED]");
    expect(out.self).toBe("[Circular]");
  });
});

describe("redactSecrets — string values (the realistic leak paths)", () => {
  it("scrubs a known literal secret embedded in any string", () => {
    const out = redactSecrets("calling https://api/x?foo=KEY12345", { secrets: ["KEY12345"] });
    expect(out).not.toContain("KEY12345");
    expect(out).toContain("[REDACTED]");
  });

  it("scrubs JWT-shaped values (the official key is a JWT)", () => {
    const jwt = "eyJhbGciOiJ.eyJpc3MiOiJ.QWxsRGF0YUhlcmU";
    expect(redactString(`Authorization header: ${jwt}`)).not.toContain(jwt);
  });

  it("scrubs inline token=/bearer patterns (secret-length values) in URLs and headers", () => {
    const tok = "abcDEF1234567890wxyz"; // 20 chars, secret-length
    expect(redactString(`GET /v1?token=${tok}`)).not.toContain(tok);
    expect(redactString(`authorization: Bearer ${tok}`)).not.toContain(tok);
  });

  it("does NOT mangle a benign short label:value (e.g. config hints)", () => {
    expect(redactString("COC_API_KEY: Required")).toBe("COC_API_KEY: Required");
  });
});

describe("redactSecrets — non-plain objects (keep logs useful, block bypasses)", () => {
  it("normalizes Error to {name,message,stack} and scrubs the known key from the message", () => {
    const KEY = "OFFICIAL-KEY-LEAKME99";
    const err = new Error(`request to https://x?auth=${KEY} failed`);
    const out = redactSecrets(err, { secrets: [KEY] }) as {
      name: string;
      message: string;
      stack?: string;
    };
    expect(out.name).toBe("Error");
    expect(out.message).not.toContain(KEY);
  });

  it("normalizes Map/Set/Date instead of flattening to {}", () => {
    expect(redactSecrets(new Map([["a", 1]]))).toEqual({ a: 1 });
    expect(redactSecrets(new Set([1, 2]))).toEqual([1, 2]);
    expect(typeof redactSecrets(new Date(0))).toBe("string");
  });

  it("drops toJSON so JSON.stringify cannot re-materialize raw secrets", () => {
    const hostile = { toJSON: () => ({ token: "REMATERIALIZED" }) };
    const out = redactSecrets(hostile);
    expect(JSON.stringify(out)).not.toContain("REMATERIALIZED");
  });
});
