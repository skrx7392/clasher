import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { runner as migrationRunner } from "node-pg-migrate";

const PORT = 54329;
const DB = "clasher_test";
const dataDir = mkdtempSync(join(tmpdir(), "clasher-db-"));
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const databaseUrl = `postgres://postgres:postgres@localhost:${PORT}/${DB}`;

const ALL_TABLES = [
  "users",
  "account_ownership",
  "accounts",
  "persons",
  "person_accounts",
  "clans",
  "clan_registrations",
  "war_snapshots",
  "cwl_seasons",
  "warlog_entries",
  "tracking_coverage",
  "member_war_attacks",
  "member_war_stats",
  "giveaways",
  "giveaway_rules",
  "giveaway_entries",
  "giveaway_draws",
  "giveaway_winners",
  "ranking_configs",
];

let pg: EmbeddedPostgres;
let client: Client;

async function tableNames(): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public'",
  );
  return rows.map((r) => r.table_name);
}

beforeAll(async () => {
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
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
    log: () => {},
  });
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
  await pg?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("migrations (DESIGN §3)", () => {
  it("migrate up created every §3 table", async () => {
    const names = await tableNames();
    for (const t of ALL_TABLES) expect(names, `missing table ${t}`).toContain(t);
  });

  it("users.role defaults to 'none' (least privilege)", async () => {
    await client.query("insert into users (google_sub) values ('sub-1')");
    const { rows } = await client.query<{ role: string }>(
      "select role from users where google_sub = 'sub-1'",
    );
    expect(rows[0]?.role).toBe("none");
  });

  it("users.role rejects values outside the allowed set", async () => {
    await expect(
      client.query("insert into users (google_sub, role) values ('sub-bad', 'superadmin')"),
    ).rejects.toThrow();
  });

  it("account_ownership has NO token column (NFR-11)", async () => {
    const { rows } = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'account_ownership'",
    );
    expect(rows.map((r) => r.column_name)).not.toContain("token");
  });

  it("war_snapshots UNIQUE(war_identity, source) — both sources kept, dup rejected", async () => {
    const ins = (src: string) =>
      client.query(
        "insert into war_snapshots (war_identity, source, clan_tag, war_type, raw_json) values ('w1', $1, '#C', 'regular', '{}')",
        [src],
      );
    await ins("official");
    await ins("clashking"); // different source for same war is allowed
    await expect(ins("official")).rejects.toThrow(); // duplicate (war_identity, source) rejected
  });

  it("member_war_attacks per-attack PK (war_identity, source, attacker_tag, attack_order)", async () => {
    const ins = (order: number) =>
      client.query(
        "insert into member_war_attacks (war_identity, source, attacker_tag, attack_order) values ('w1', 'official', '#A', $1)",
        [order],
      );
    await ins(1);
    await ins(2); // a second attack by the same attacker is allowed
    await expect(ins(1)).rejects.toThrow(); // same attack_order rejected
  });

  it("giveaways.num_winners must be >= 1 and giveaway_draws is single-shot", async () => {
    await client.query("insert into clans (clan_tag) values ('#C')");
    const { rows } = await client.query<{ id: string }>(
      "insert into giveaways (clan_tag, entity_granularity, num_winners) values ('#C', 'account', 1) returning id",
    );
    const id = rows[0]?.id;
    await expect(
      client.query(
        "insert into giveaways (clan_tag, entity_granularity, num_winners) values ('#C', 'account', 0)",
      ),
    ).rejects.toThrow();
    // single-shot: a second draw row for the same giveaway is rejected (giveaway_id PK)
    await client.query("insert into giveaway_draws (giveaway_id) values ($1)", [id]);
    await expect(
      client.query("insert into giveaway_draws (giveaway_id) values ($1)", [id]),
    ).rejects.toThrow();
  });

  it("migrate down cleanly reverses (all §3 tables dropped)", async () => {
    await migrationRunner({
      databaseUrl,
      dir: migrationsDir,
      direction: "down",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => {},
    });
    const names = await tableNames();
    for (const t of ALL_TABLES) expect(names, `table ${t} not dropped`).not.toContain(t);
  });
});
