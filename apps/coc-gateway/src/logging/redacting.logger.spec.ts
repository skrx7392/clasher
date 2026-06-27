import { RedactingLogger } from "./redacting.logger";

describe("RedactingLogger (NFR-11 / FR-4)", () => {
  function capture() {
    const lines: string[] = [];
    return { logger: new RedactingLogger((l) => lines.push(l)), lines };
  }

  it("a token submitted in a request body never appears in any emitted log line", () => {
    const { logger, lines } = capture();
    const TOKEN = "abc123-IN-GAME-TOKEN";

    logger.log("incoming verifytoken request", { req: { body: { token: TOKEN } } });
    logger.error({ message: "upstream failed", req: { headers: { authorization: TOKEN } } });

    const all = lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("[REDACTED]");
  });

  it("emits structured JSON with the level and message", () => {
    const { logger, lines } = capture();
    logger.warn("heads up");
    const record = JSON.parse(lines[0] ?? "{}") as { level: string; message: string };
    expect(record.level).toBe("warn");
    expect(record.message).toBe("heads up");
  });
});
