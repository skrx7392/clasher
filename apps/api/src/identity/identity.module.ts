import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { UsersRepository } from "./users.repository";
import { CurrentUserMiddleware } from "../auth/current-user.middleware";

/**
 * Users + role model (M0 #15): the sign-in upsert and current-user lookups.
 * Account ownership, persons, and admin-driven account linking land in M1+.
 *
 * Owns the controller, so it also applies the {@link CurrentUserMiddleware} to it
 * (the middleware needs UsersRepository, which lives here) — keeping a single
 * import site for the controller. The global RolesGuard lives in AuthModule.
 */
@Module({
  controllers: [IdentityController],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class IdentityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CurrentUserMiddleware).forRoutes(IdentityController);
  }
}
