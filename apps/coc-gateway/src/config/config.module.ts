import { Global, Module } from "@nestjs/common";
import { validateEnv, type Env } from "./env.schema";

/** DI token for the validated, typed environment config. */
export const ENV = Symbol("ENV");

/**
 * Global config module. The provider factory validates `process.env`
 * SYNCHRONOUSLY at instantiation; a missing/invalid variable throws, making
 * NestFactory.create() reject and the process exit non-zero — fail-loud (NFR-6),
 * independent of Node's unhandled-rejection mode.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv(process.env) }],
  exports: [ENV],
})
export class AppConfigModule {}
