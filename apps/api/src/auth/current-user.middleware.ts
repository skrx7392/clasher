import { Injectable, type NestMiddleware } from "@nestjs/common";
import { UsersRepository, type User } from "../identity/users.repository";

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  user?: User;
}

/**
 * M0 SCAFFOLD SEAM (DESIGN §2, D-1). Resolves the "current user" for
 * `@CurrentUser()` / `RolesGuard` by looking up an EXISTING user in the DB and
 * attaching `{ ..., role }` to the request. The role ALWAYS comes from the DB —
 * the request can never assert it (FR-2; DESIGN §10).
 *
 * In M0 the subject is taken from the `x-clasher-google-sub` header as a stand-in.
 * This is NOT authentication and must not be relied on to protect real secrets;
 * M1 replaces the header with a verified Auth.js session (its `google_sub` claim),
 * keeping this same "DB is authoritative for role" contract. An absent or unknown
 * subject yields no user, which the guard treats as default-deny.
 */
@Injectable()
export class CurrentUserMiddleware implements NestMiddleware {
  constructor(private readonly users: UsersRepository) {}

  async use(req: RequestLike, _res: unknown, next: () => void): Promise<void> {
    const raw = req.headers["x-clasher-google-sub"];
    const sub = Array.isArray(raw) ? raw[0] : raw;
    if (sub) {
      const user = await this.users.findByGoogleSub(sub);
      if (user) req.user = user;
    }
    next();
  }
}
