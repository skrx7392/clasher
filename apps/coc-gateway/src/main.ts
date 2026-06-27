import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { ENV } from "./config/config.module";
import type { Env } from "./config/env.schema";
import { RedactingLogger } from "./logging/redacting.logger";

async function bootstrap(): Promise<void> {
  // Redacting logger is the app-wide logger from the very first line so no
  // token can ever reach a log (NFR-11). abortOnError:false routes startup
  // failures to the catch below for a single fail-loud owner (NFR-6).
  const app = await NestFactory.create(AppModule, {
    logger: new RedactingLogger(),
    abortOnError: false,
  });

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  Logger.log(`coc-gateway listening on :${env.PORT}`, "Bootstrap");
}

bootstrap().catch((err: unknown) => {
  Logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err), "Bootstrap");
  process.exit(1);
});
