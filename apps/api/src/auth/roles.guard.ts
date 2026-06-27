import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@clasher/shared";
import { AUTH_REQUIRED_KEY, ROLES_KEY } from "./roles.decorator";
import type { User } from "../identity/users.repository";

/**
 * Global authorization guard (default-deny). Routes carrying no `@Roles()` /
 * `@Authenticated()` metadata are public (M0 has no implicitly-protected routes
 * yet). For a guarded route, a caller with no resolved user is denied, and a
 * `@Roles()` route additionally requires the user's role — read from the DB by
 * the middleware, never asserted by the client — to be in the allowed set
 * (FR-2; DESIGN §10).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const authRequired = this.reflector.getAllAndOverride<boolean>(AUTH_REQUIRED_KEY, targets);

    if (!roles && !authRequired) return true; // public route

    const user = context.switchToHttp().getRequest<{ user?: User }>().user;
    if (!user) throw new ForbiddenException("authentication required");

    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException("insufficient role");
    }
    return true;
  }
}
