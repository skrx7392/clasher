import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@clasher/shared";

export const ROLES_KEY = "clasher:roles";
export const AUTH_REQUIRED_KEY = "clasher:authRequired";

/**
 * Restrict a route to the given role(s). Default-deny: the {@link RolesGuard}
 * returns 403 for any caller whose DB role is not in the list (FR-2, DESIGN §10).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Require any authenticated user (no specific role); role still read from the DB. */
export const Authenticated = () => SetMetadata(AUTH_REQUIRED_KEY, true);
