import { RedactingLogger } from "./redacting.logger";

describe("RedactingLogger (NFR-11 / FR-4)", () => {
  function capture(secrets: string[] = []) {
    const lines: string[] = [];
    return { logger: new RedactingLogger({ sink: (l) => lines.push(l), secrets }), lines };
  }

  it("a token in a request body never appears in any emitted log line", () => {
    const { logger, lines } = capture();
    const TOKEN = "abc123-IN-GAME-TOKEN";
    logger.log("incoming verifytoken request", { req: { body: { token: TOKEN } } });
    logger.error({ message: "upstream failed", req: { headers: { authorization: TOKEN } } });
    const all = lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("[REDACTED]");
  });

  it("scrubs the configured key even from a plain STRING message", () => {
    const KEY = "OFFICIAL-KEY-99887766";
    const { logger, lines } = capture([KEY]);
    logger.error(`proxy GET failed: https://cocproxy/v1/clans?auth=${KEY}`);
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("scrubs the key out of an Error stack/message", () => {
    const KEY = "OFFICIAL-KEY-99887766";
    const { logger, lines } = capture([KEY]);
    logger.error(new Error(`request to https://x?token=${KEY} failed`));
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("emits structured JSON with level and message", () => {
    const { logger, lines } = capture();
    logger.warn("heads up");
    const record = JSON.parse(lines[0] ?? "{}") as { level: string; message: string };
    expect(record.level).toBe("warn");
    expect(record.message).toBe("heads up");
  });
});
