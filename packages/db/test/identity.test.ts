import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { runner as migrationRunner } from "node-pg-migrate";
// @ts-expect-error -- plain ESM script (allowJs); imported here to test the real seed.
import { seedAdmin } from "../scripts/seed-admin.mjs";

/**
 * Real-Postgres proof of the #15 role invariants (FR-2; DESIGN §3/§5/§10):
 * default role 'none', the sign-in upsert never elevates/demotes, the CHECK
 * constraint rejects bogus roles, and the out-of-band seed promotes to admin.
 * This is the authoritative DB-level coverage; the api proves the HTTP wiring.
 */
const DB = "clasher_test";
const dataDir = mkdtempSync(join(tmpdir(), "clasher-identity-"));
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

let pg: EmbeddedPostgres;
let client: Client;

// The sign-in upsert SQL MUST mirror apps/api UsersRepository.upsertFromSignIn:
// role is absent from both the INSERT columns and the DO UPDATE SET.
const UPSERT_SQL = `INSERT INTO users (google_sub, email, name)
   VALUES ($1, $2, $3)
   ON CONFLICT (google_sub)
   DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
   RETURNING role`;

beforeAll(async () => {
  const port = await freePort();
  const databaseUrl = `postgres://postgres:postgres@localhost:${port}/${DB}`;
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  await migrationRunner({
    databaseUrl,
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
    singleTransaction: true,
    log: () => {},
  });
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
}, 120_000);

afterAll(async () => {
  await client?.end();
  await pg?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await client.query("TRUNCATE users CASCADE");
});

it("a new user defaults to role 'none' (least privilege)", async () => {
  const { rows } = await client.query(
    "INSERT INTO users (google_sub) VALUES ($1) RETURNING role",
    ["sub-1"],
  );
  expect(rows[0].role).toBe("none");
});

it("the CHECK constraint rejects any role outside {none,manager,admin}", async () => {
  await expect(
    client.query("INSERT INTO users (google_sub, role) VALUES ($1, $2)", ["sub-2", "superuser"]),
  ).rejects.toThrow();
});

it("the sign-in upsert never elevates or demotes an existing role", async () => {
  await seedAdmin(client, { googleSub: "sub-admin" }); // role=admin
  const { rows } = await client.query(UPSERT_SQL, ["sub-admin", "new@example.com", "Renamed"]);
  expect(rows[0].role).toBe("admin"); // preserved
  // ...and the email/name WERE refreshed:
  const after = await client.query("SELECT email, name FROM users WHERE google_sub = $1", [
    "sub-admin",
  ]);
  expect(after.rows[0]).toEqual({ email: "new@example.com", name: "Renamed" });
});

it("the upsert creates new users at 'none', not elevated", async () => {
  const { rows } = await client.query(UPSERT_SQL, ["sub-fresh", null, null]);
  expect(rows[0].role).toBe("none");
});

describe("out-of-band seed", () => {
  it("promotes an existing user to admin by google_sub", async () => {
    await client.query("INSERT INTO users (google_sub) VALUES ($1)", ["sub-x"]);
    const user = await seedAdmin(client, { googleSub: "sub-x" });
    expect(user.role).toBe("admin");
  });

  it("pre-seeds an admin by google_sub before first sign-in", async () => {
    const user = await seedAdmin(client, { googleSub: "sub-pre" });
    expect(user.role).toBe("admin");
    const { rows } = await client.query("SELECT role FROM users WHERE google_sub = $1", [
      "sub-pre",
    ]);
    expect(rows[0].role).toBe("admin");
  });

  it("promotes by email when the user exists", async () => {
    await client.query("INSERT INTO users (google_sub, email) VALUES ($1, $2)", [
      "sub-e",
      "boss@example.com",
    ]);
    const user = await seedAdmin(client, { email: "boss@example.com" });
    expect(user.role).toBe("admin");
  });

  it("refuses to seed by email when no such user exists", async () => {
    await expect(seedAdmin(client, { email: "ghost@example.com" })).rejects.toThrow(/no user/);
  });

  it("requires exactly one of google_sub / email", async () => {
    await expect(seedAdmin(client, {})).rejects.toThrow(/exactly one/);
    await expect(seedAdmin(client, { googleSub: "a", email: "b@c.d" })).rejects.toThrow(
      /exactly one/,
    );
  });
});
