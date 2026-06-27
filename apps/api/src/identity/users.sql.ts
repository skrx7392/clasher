// Canonical SQL for the `users` table. Shared between the api repository (which
// runs it in production) and the packages/db real-Postgres tests (which prove its
// semantics) so the TESTED statement is the EXECUTED one — no silent drift. Kept
// dependency-free on purpose so both the api (CJS) and the db tests (ESM) import it.

export const USER_COLUMNS = "id, google_sub, email, name, role, created_at";

/**
 * Idempotent sign-in upsert keyed on `google_sub`.
 *
 * - `role` is intentionally ABSENT from both the INSERT column list (new rows take
 *   the DB default `'none'`) and the `DO UPDATE SET`, so it is never written on a
 *   request-reachable path (FR-2; DESIGN §3/§5/§10).
 * - identity fields are WRITE-ONCE: `COALESCE(users.col, EXCLUDED.col)` only fills
 *   a NULL, so this endpoint cannot OVERWRITE an existing user's email/name. Until
 *   the M1 verified-session binding makes the caller trusted, this prevents an
 *   unauthenticated caller from tampering with another user's identity. (M1 with a
 *   trusted caller does authoritative refreshes.)
 */
export const UPSERT_FROM_SIGNIN_SQL = `INSERT INTO users (google_sub, email, name)
   VALUES ($1, $2, $3)
   ON CONFLICT (google_sub)
   DO UPDATE SET email = COALESCE(users.email, EXCLUDED.email),
                 name  = COALESCE(users.name,  EXCLUDED.name)
   RETURNING ${USER_COLUMNS}`;
