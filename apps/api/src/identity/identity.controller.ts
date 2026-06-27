import { Body, Controller, Get, Post, UsePipes } from "@nestjs/common";
import { UserRole } from "@clasher/shared";
import { UsersRepository, type User } from "./users.repository";
import { signInUpsertSchema, type SignInUpsertDto } from "./dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { Authenticated, Roles } from "../auth/roles.decorator";

/** Client-safe projection of a user (no internal columns beyond the model). */
interface UserView {
  id: string;
  googleSub: string;
  email: string | null;
  name: string | null;
  role: UserRole;
}

const toView = (u: User): UserView => ({
  id: u.id,
  googleSub: u.googleSub,
  email: u.email,
  name: u.name,
  role: u.role,
});

@Controller("identity")
export class IdentityController {
  constructor(private readonly users: UsersRepository) {}

  /**
   * Internal sign-in upsert, called by the web's Auth.js callback. Creates the
   * user with role `'none'` (DB default) or refreshes email/name; NEVER sets role
   * — the strict schema rejects any `role` field with a 400 (FR-2; DESIGN §5/§10).
   *
   * M0 NOTE: not yet restricted to the web origin; M1 adds caller authentication
   * + CSRF. It is safe by construction today because no field here can elevate a
   * role.
   */
  @Post("users/upsert")
  @UsePipes(new ZodValidationPipe(signInUpsertSchema))
  async upsert(@Body() body: SignInUpsertDto): Promise<UserView> {
    return toView(await this.users.upsertFromSignIn(body));
  }

  /** Current-user resolver — returns the caller's record, role read from the DB. */
  @Get("me")
  @Authenticated()
  me(@CurrentUser() user: User): UserView {
    return toView(user);
  }

  /**
   * Demo admin-only route that exercises default-deny role enforcement: a `'none'`
   * (or absent) caller gets 403; only an out-of-band-seeded admin reaches it.
   */
  @Get("admin/ping")
  @Roles(UserRole.Admin)
  adminPing(): { status: string } {
    return { status: "ok" };
  }
}
