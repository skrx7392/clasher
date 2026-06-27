import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { ENV } from "./config/config.module";
import type { Env } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  Logger.log(`Clasher API listening on :${env.PORT} (prefix /api)`, "Bootstrap");
}

// Fail loud: any startup error (e.g. invalid config) exits non-zero regardless
// of Node's unhandled-rejection mode, so a misconfigured pod never looks healthy.
bootstrap().catch((err: unknown) => {
  Logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err), "Bootstrap");
  process.exit(1);
});
