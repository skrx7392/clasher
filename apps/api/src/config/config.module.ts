import { Global, Module } from "@nestjs/common";
import { validateEnv, type Env } from "./env.schema";

/** DI token for the validated, typed environment config. */
export const ENV = Symbol("ENV");

/**
 * Global config module. The provider factory validates `process.env`
 * SYNCHRONOUSLY at module instantiation; a missing/invalid variable throws,
 * which makes `NestFactory.create()` reject and the process exit non-zero —
 * fail-loud (NFR-6), with no silent defaults and without depending on Node's
 * unhandled-rejection mode.
 *
 * Inject the typed config with `@Inject(ENV) env: Env`.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv(process.env) }],
  exports: [ENV],
})
export class AppConfigModule {}
