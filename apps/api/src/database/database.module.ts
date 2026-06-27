import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env.schema";

/** DI token for the shared Postgres connection pool. */
export const DATABASE_POOL = Symbol("DATABASE_POOL");

/**
 * Global Postgres access (Clasher is the system of record — DESIGN §2). A single
 * lazy `pg.Pool` is shared across feature modules; `pg.Pool` does NOT open a
 * connection until the first query, so simply importing this module never touches
 * the database (the existing dummy-env boot tests stay green without a live PG).
 *
 * Inject the pool with `@Inject(DATABASE_POOL) pool: Pool`.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ENV],
      useFactory: (env: Env): Pool => new Pool({ connectionString: env.DATABASE_URL }),
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Drain the pool on shutdown so the process can exit cleanly (and tests close). */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
