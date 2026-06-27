import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../database/database.module";

interface HealthStatus {
  status: "ok";
}

interface ReadinessStatus {
  status: "ok" | "degraded";
  checks: Record<string, "ok" | "down">;
}

/**
 * Liveness/readiness endpoints for k8s probes. With the global `/api` prefix
 * these resolve to `GET /api/health` and `GET /api/ready` (DESIGN §8).
 */
@Controller()
export class HealthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Liveness: the process is up and serving. */
  @Get("health")
  liveness(): HealthStatus {
    return { status: "ok" };
  }

  /**
   * Readiness: safe to receive traffic. Postgres is now a hard dependency of the
   * request path (identity), so probe it with a cheap `SELECT 1` and fail the
   * probe (503) when it is unreachable — otherwise k8s would route traffic to a
   * pod that cannot serve. (Redis checks join here when its request paths land.)
   */
  @Get("ready")
  async readiness(): Promise<ReadinessStatus> {
    try {
      await this.pool.query("SELECT 1");
    } catch {
      throw new ServiceUnavailableException({
        status: "degraded",
        checks: { postgres: "down" },
      });
    }
    return { status: "ok", checks: { postgres: "ok" } };
  }
}
