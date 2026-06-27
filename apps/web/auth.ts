import NextAuth, { type NextAuthResult } from "next-auth";
import { authConfig } from "./auth.config";

// Explicit NextAuthResult[...] annotations are required: without them, tsc cannot
// portably name the inferred types under pnpm's nested layout (TS2742).
const nextAuth = NextAuth(authConfig);

/** Auth.js route handlers — powers /api/auth/* (see app/api/auth/[...nextauth]). */
export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
/** Read the current session in server components/actions. */
export const auth: NextAuthResult["auth"] = nextAuth.auth;
/** Trigger sign-in / sign-out from server actions. */
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
