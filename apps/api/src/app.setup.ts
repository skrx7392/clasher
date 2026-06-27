import type { INestApplication } from "@nestjs/common";

/**
 * Apply the cross-cutting app configuration shared by the real bootstrap
 * (`main.ts`) and the e2e tests, so what the tests exercise is exactly what runs
 * in production (notably the global `/api` prefix — DESIGN §8).
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix("api");
  return app;
}
