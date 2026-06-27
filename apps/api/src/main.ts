import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import type { Env } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Whole REST surface lives under /api (DESIGN §8).
  app.setGlobalPrefix("api");

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get("PORT", { infer: true });

  await app.listen(port);
  Logger.log(`Clasher API listening on :${port} (prefix /api)`, "Bootstrap");
}

void bootstrap();
