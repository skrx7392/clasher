import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env.schema";
import { SingleKeyTokenPool, type TokenPool } from "./token-pool";
import { NoopRateLimiter } from "./rate-limiter";

/** DI tokens for the outbound-CoC seams. */
export const TOKEN_POOL = Symbol("TOKEN_POOL");
export const RATE_LIMITER = Symbol("RATE_LIMITER");

/**
 * Holds the outbound-CoC building blocks. The token pool is constructed FROM the
 * validated config key, so the official key lives only inside this service's
 * runtime (DESIGN §1/§9). Real proxy calls are wired onto these seams in M1/M2.
 */
@Module({
  providers: [
    {
      provide: TOKEN_POOL,
      useFactory: (env: Env): TokenPool => new SingleKeyTokenPool(env.COC_API_KEY),
      inject: [ENV],
    },
    { provide: RATE_LIMITER, useValue: new NoopRateLimiter() },
  ],
  exports: [TOKEN_POOL, RATE_LIMITER],
})
export class CocModule {}
