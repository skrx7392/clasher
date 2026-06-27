// Out-of-band admin seed (DESIGN §5/§10, FR-2). This is the ONLY path that sets
// role='admin'; it is a CLI run by an operator with DB credentials and is NOT
// reachable via any API route. Promote by google_sub (works before or after the
// user's first sign-in) or by email (the user must have signed in already, since
// google_sub is required and unique).
//
//   DATABASE_URL=postgres://... node scripts/seed-admin.mjs --google-sub <sub>
//   DATABASE_URL=postgres://... node scripts/seed-admin.mjs --email <email>
//
// Wired as `pnpm --filter @clasher/db seed:admin -- --google-sub <sub>`.
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

/**
 * Set a user's role to 'admin'. Accepts exactly one of { googleSub, email }.
 * @param {import('pg').Client | import('pg').Pool} client connected pg client
 * @param {{ googleSub?: string, email?: string }} target
 * @returns {Promise<{ id: string, google_sub: string, email: string | null, role: string }>}
 */
export async function seedAdmin(client, { googleSub, email } = {}) {
  if (Boolean(googleSub) === Boolean(email)) {
    throw new Error("provide exactly one of --google-sub or --email");
  }

  if (googleSub) {
    // Upsert: creates an admin row if the user hasn't signed in yet, else promotes.
    const { rows } = await client.query(
      `INSERT INTO users (google_sub, role) VALUES ($1, 'admin')
       ON CONFLICT (google_sub) DO UPDATE SET role = 'admin'
       RETURNING id, google_sub, email, role`,
      [googleSub],
    );
    return rows[0];
  }

  // `email` is NOT unique (only google_sub is), so an email can match >1 row.
  // Run in a transaction and REFUSE to commit on an ambiguous match, so the seed
  // never silently over-promotes. --google-sub (unique) is the safe primary path.
  await client.query("BEGIN");
  try {
    const { rows } = await client.query(
      `UPDATE users SET role = 'admin' WHERE email = $1
       RETURNING id, google_sub, email, role`,
      [email],
    );
    if (rows.length === 0) {
      throw new Error(
        `no user with email '${email}'. Seed by --google-sub, or have them sign in first.`,
      );
    }
    if (rows.length > 1) {
      throw new Error(
        `refusing to promote ${rows.length} users sharing email '${email}'; seed by --google-sub`,
      );
    }
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--google-sub") out.googleSub = argv[(i += 1)];
    else if (argv[i] === "--email") out.email = argv[(i += 1)];
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
