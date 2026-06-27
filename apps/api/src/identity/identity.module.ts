import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { UsersRepository } from "./users.repository";

/**
 * Users + role model (M0 #15): the sign-in upsert and current-user lookups.
 * Account ownership, persons, and admin-driven account linking land in M1+.
 */
@Module({
  controllers: [IdentityController],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class IdentityModule {}
