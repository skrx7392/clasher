import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { UserRole } from "@clasher/shared";
import { DATABASE_POOL } from "../database/database.module";

/** A Clasher user identity (DESIGN §3 `users`). */
export interface User {
  id: string;
  googleSub: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  createdAt: Date;
}

interface UserRow {
  id: string;
  google_sub: string;
  email: string | null;
  name: string | null;
  role: string;
  created_at: Date;
}

const SELECT_COLUMNS = "id, google_sub, email, name, role, created_at";

function toUser(row: UserRow): User {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    name: row.name,
    // The DB CHECK constrains role to exactly the UserRole values, so this cast is safe.
    role: row.role as UserRole,
    createdAt: row.created_at,
  };
}

/**
 * Read/write access to the `users` table.
 *
 * SECURITY INVARIANT (FR-2; DESIGN §3/§5/§10): `role` is NEVER written by any
 * method here. The sign-in upsert omits `role` from its INSERT column list (so a
 * new row gets the DB default `'none'`) and from its `DO UPDATE SET` (so an
 * existing user's role is preserved). Role is changed ONLY by the out-of-band
 * seed (`packages/db/scripts/seed-admin.mjs`), never on a request path. The
 * real-Postgres proof of these semantics lives in `packages/db` identity tests.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Idempotent sign-in upsert keyed on `google_sub`. Creates the user with the
   * default role `'none'` or refreshes `email`/`name`; never touches `role`.
   */
  async upsertFromSignIn(input: {
    googleSub: string;
    email?: string | null | undefined;
    name?: string | null | undefined;
  }): Promise<User> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (google_sub, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (google_sub)
       DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
       RETURNING ${SELECT_COLUMNS}`,
      [input.googleSub, input.email ?? null, input.name ?? null],
    );
    const row = rows[0];
    // RETURNING on a guaranteed insert-or-update always yields exactly one row.
    if (!row) throw new Error("upsert returned no row");
    return toUser(row);
  }

  /** Resolve a user by their Google subject claim (role authoritative from DB). */
  async findByGoogleSub(googleSub: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT ${SELECT_COLUMNS} FROM users WHERE google_sub = $1`,
      [googleSub],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }
}
