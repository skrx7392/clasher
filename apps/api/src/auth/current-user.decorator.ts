import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { User } from "../identity/users.repository";

/**
 * Injects the resolved current user (or `undefined` if unauthenticated). The user
 * is attached by {@link CurrentUserMiddleware}; its `role` is authoritative from
 * the DB, never from request input. Guard a route with `@Authenticated()` /
 * `@Roles()` to guarantee a non-null user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User | undefined => {
    return ctx.switchToHttp().getRequest<{ user?: User }>().user;
  },
);
