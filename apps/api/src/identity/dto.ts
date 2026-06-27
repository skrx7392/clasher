import { z } from "zod";

/**
 * Payload for the sign-in upsert, sent by the web's Auth.js callback.
 *
 * `.strict()` is load-bearing: it REJECTS any unknown field — including `role` —
 * with a 400, so a client cannot smuggle a role through the only user-writing
 * endpoint. Role is never accepted from a request (FR-2; DESIGN §5/§10).
 */
export const signInUpsertSchema = z
  .object({
    googleSub: z.string().trim().min(1, "googleSub is required"),
    email: z.string().email().nullish(),
    name: z.string().trim().min(1).nullish(),
  })
  .strict();

export type SignInUpsertDto = z.infer<typeof signInUpsertSchema>;
