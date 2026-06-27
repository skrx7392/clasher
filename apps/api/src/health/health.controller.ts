import { Controller, Get } from "@nestjs/common";

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
  /** Liveness: the process is up and serving. */
  @Get("health")
  liveness(): HealthStatus {
    return { status: "ok" };
  }

  /**
   * Readiness: safe to receive traffic. Real dependency checks (Postgres, Redis)
   * are added when those are wired (#5/#7); until then there is nothing to check.
   */
  @Get("ready")
  readiness(): ReadinessStatus {
    return { status: "ok", checks: {} };
  }
}
