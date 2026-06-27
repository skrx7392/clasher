import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";

/**
 * Authorization scaffold (M0 #15): registers the global default-deny
 * {@link RolesGuard}. The current-user resolver middleware is applied by
 * IdentityModule (which owns the controller it guards). Auth.js Google sign-in
 * runs in the web app; the verified-session binding (replacing the M0 header seam)
 * lands in M1 (DESIGN §2, D-1).
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class AuthModule {}
