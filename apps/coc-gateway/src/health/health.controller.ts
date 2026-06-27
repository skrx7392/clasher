import { Controller, Get } from "@nestjs/common";

/** Liveness probe for k8s. Internal service — no `/api` prefix. */
@Controller()
export class HealthController {
  @Get("health")
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}
