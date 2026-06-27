import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { ENV } from "./config/config.module";
import type { Env } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  // abortOnError:false hands startup failures (e.g. invalid config thrown by the
  // ENV factory) to our catch below instead of Nest's internal exit path, so a
  // single place owns fail-loud behavior (NFR-6).
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  configureApp(app);
  // Fire lifecycle hooks (onModuleDestroy) on SIGTERM/SIGINT — what k8s sends —
  // so the Postgres pool drains cleanly on shutdown (DatabaseModule).
  app.enableShutdownHooks();

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
