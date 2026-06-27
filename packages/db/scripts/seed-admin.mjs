// Out-of-band admin seed (DESIGN §5/§10, FR-2). This is the ONLY path that sets
// role='admin'; it is a CLI run by an operator with DB credentials and is NOT
// reachable via any API route.
//
//   DATABASE_URL=postgres://... node scripts/seed-admin.mjs --google-sub <sub>
//   (wired as `pnpm --filter @clasher/db seed:admin -- --google-sub <sub>`)
//
// Promotion is keyed ONLY on google_sub (the Google subject claim), which is unique
// and must be obtained from a TRUSTED source (Google, or the admin reading their own
// subject after signing in). Email-based seeding is intentionally DISABLED in M0:
// the sign-in upsert (`POST /api/identity/users/upsert`) is still unauthenticated,
// so anyone could pre-create a row binding a target email to an attacker-controlled
// google_sub — and `UPDATE ... WHERE email = ?` would then promote the attacker
// (admin takeover). Email seeding can return once that upsert is trusted (M1).
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

/**
 * Set a user's role to 'admin', keyed on google_sub (created if absent, else
 * promoted). Email-based seeding is disabled (see file header).
 * @param {import('pg').Client | import('pg').Pool} client connected pg client
 * @param {{ googleSub?: string }} target
 * @returns {Promise<{ id: string, google_sub: string, email: string | null, role: string }>}
 */
export async function seedAdmin(client, { googleSub } = {}) {
  if (!googleSub) {
    throw new Error("--google-sub is required (email-based seeding is disabled in M0)");
  }
  // Upsert: creates an admin row if the user hasn't signed in yet, else promotes.
  const { rows } = await client.query(
    `INSERT INTO users (google_sub, role) VALUES ($1, 'admin')
     ON CONFLICT (google_sub) DO UPDATE SET role = 'admin'
     RETURNING id, google_sub, email, role`,
    [googleSub],
  );
  return rows[0];
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--google-sub") out.googleSub = argv[(i += 1)];
    else if (argv[i] === "--email")
      throw new Error("email seeding is disabled in M0; seed by --google-sub (see file header)");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return out;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const user = await seedAdmin(client, parseArgs(process.argv.slice(2)));
    console.log(
      `Promoted to admin: ${user.google_sub} (${user.email ?? "no email"}) -> role=${user.role}`,
    );
  } finally {
    await client.end();
  }
}

// Run as a CLI only when invoked directly — importing it (tests) must not connect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`seed-admin failed: ${err.message}`);
    process.exitCode = 1;
  });
}
