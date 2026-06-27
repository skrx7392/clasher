import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { IdentityModule } from "../identity/identity.module";
import { IdentityController } from "../identity/identity.controller";
import { RolesGuard } from "./roles.guard";
import { CurrentUserMiddleware } from "./current-user.middleware";

/**
 * Authorization scaffold (M0 #15): a global default-deny {@link RolesGuard} plus
 * the {@link CurrentUserMiddleware} that resolves the caller and reads their role
 * from the DB. Auth.js Google sign-in itself runs in the web app; the
 * verified-session binding (replacing the M0 header seam) lands in M1
 * (DESIGN §2, D-1).
 */
@Module({
  imports: [IdentityModule],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // M0: only the identity routes consume @CurrentUser()/@Roles(); M1 broadens
    // this as protected feature routes (clans, giveaways) come online.
    consumer.apply(CurrentUserMiddleware).forRoutes(IdentityController);
  }
}
