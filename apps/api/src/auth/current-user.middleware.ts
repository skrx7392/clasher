import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env.schema";
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
 * The subject is taken from the `x-clasher-google-sub` header, which is a
 * SPOOFABLE stand-in, NOT authentication. It is therefore honored ONLY outside
 * production: in production the header is ignored, so guarded routes stay
 * default-deny (403) until M1 wires a verified Auth.js session (its `google_sub`
 * claim) in place of this header — keeping the same "DB is authoritative for role"
 * contract. There are no production-critical guarded routes in M0; the demo
 * `/admin/ping` simply isn't reachable until M1.
 */
@Injectable()
export class CurrentUserMiddleware implements NestMiddleware {
  constructor(
    private readonly users: UsersRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async use(req: RequestLike, _res: unknown, next: () => void): Promise<void> {
    // Refuse to trust the spoofable header once publicly reachable (production).
    if (this.env.NODE_ENV === "production") {
      next();
      return;
    }
    const raw = req.headers["x-clasher-google-sub"];
    const sub = Array.isArray(raw) ? raw[0] : raw;
    if (sub) {
      try {
        const user = await this.users.findByGoogleSub(sub);
        if (user) req.user = user;
      } catch {
        // Dev seam: a lookup failure (e.g. DB down) resolves to no user (default-deny).
        // Nest ignores a rejected middleware promise, so we must always reach next()
        // ourselves — otherwise the request would hang instead of returning.
      }
    }
    next();
  }
}
