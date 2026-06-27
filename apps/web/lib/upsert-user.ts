export interface UpsertUserInput {
  googleSub: string;
  email?: string | null;
  name?: string | null;
}

/**
 * Persist the signed-in user via the NestJS API (DESIGN §5 step 1). Sends ONLY
 * identity fields — `googleSub`, `email`, `name` — and NEVER a role: role is not
 * self-settable (FR-2), and the API additionally rejects any unknown field. The
 * server (DB) assigns the default role `'none'`.
 */
export async function upsertUserViaApi(input: UpsertUserInput, apiBaseUrl: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/identity/users/upsert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      googleSub: input.googleSub,
      email: input.email ?? null,
      name: input.name ?? null,
    }),
  });
  if (!res.ok) {
    throw new Error(`user upsert failed: ${res.status} ${res.statusText}`);
  }
}
