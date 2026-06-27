import { Test } from "@nestjs/testing";
import { AppConfigModule } from "../src/config/config.module";

/**
 * Proves the config WIRING (not just the validator in isolation): instantiating
 * AppConfigModule runs the sync factory, so a missing required variable aborts
 * module construction — which is what makes NestFactory.create() reject and the
 * process fail loud at boot (NFR-6).
 */
describe("Config fail-loud at boot (NFR-6 wiring)", () => {
  it("aborts module init when a required env var is missing", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(
        Test.createTestingModule({ imports: [AppConfigModule] }).compile(),
      ).rejects.toThrow(/DATABASE_URL/);
    } finally {
      process.env.DATABASE_URL = saved;
    }
  });
});
