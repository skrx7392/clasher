/**
 * @clasher/shared — single source of truth for cross-cutting constants and
 * value types shared across `apps/web`, `apps/api`, and `apps/coc-gateway`.
 *
 * Import via the workspace protocol, e.g. in an app's package.json:
 *   "@clasher/shared": "workspace:*"
 * then `import { COC_TAG_REGEX, CocRole } from "@clasher/shared";`
 */

/**
 * Clan member roles, using the EXACT string values returned by the Clash of
 * Clans API. Note: the API value `admin` corresponds to the in-game role
 * "Elder" — there is no in-game role literally named "admin" (ANALYSIS roles,
 * DESIGN §5).
 */
export enum CocRole {
  Leader = "leader",
  CoLeader = "coLeader",
  /** API value `admin` == in-game "Elder". */
  Elder = "admin",
  Member = "member",
  NotMember = "notMember",
}

/**
 * In-game roles permitted to register a clan in Clasher: leader or co-leader
 * only (REQUIREMENTS FR — "only clans where the user is leader or co-leader").
 */
export const CLAN_MANAGER_ROLES: readonly CocRole[] = [CocRole.Leader, CocRole.CoLeader];

/** True iff an in-game role may register/manage a clan in Clasher. */
export function canManageClan(role: CocRole): boolean {
  return CLAN_MANAGER_ROLES.includes(role);
}

/**
 * Application-level user role for authorization WITHIN Clasher — distinct from
 * the in-game {@link CocRole} above. `admin` performs account linking in the
 * pilot (DESIGN §5).
 */
export enum UserRole {
  None = "none",
  Manager = "manager",
  Admin = "admin",
}

/** War type for snapshots and rolled-up stats (DESIGN §3). */
export enum WarType {
  Regular = "regular",
  Cwl = "cwl",
}

/**
 * Provenance of a war snapshot. The ingest-and-own model records where each
 * snapshot came from so historical (ClashKing) and live (official) data can
 * coexist under a single `UNIQUE(war_identity, source)` (DESIGN §3, §4).
 */
export enum SnapshotSource {
  ClashKing = "clashking",
  Official = "official",
  FirstParty = "first_party",
}

/**
 * Allowlist for Clash of Clans player/clan tags. Tags begin with `#` and use a
 * restricted uppercase alphabet (the letter `O` is intentionally excluded to
 * avoid confusion with `0`).
 *
 * This regex is the ONLY definition of the tag shape in the codebase; it backs
 * the SSRF / path-injection guard that must run before any tag is interpolated
 * into an upstream CoC/ClashKing API path (DESIGN §4). Do not duplicate it.
 */
export const COC_TAG_REGEX = /^#[0289PYLQGRJCUV]{3,}$/;

/** Returns true iff `tag` is a syntactically valid CoC tag (including the leading `#`). */
export function isValidCocTag(tag: string): boolean {
  return COC_TAG_REGEX.test(tag);
}

/**
 * Normalize a user-supplied tag to canonical form: trim surrounding whitespace,
 * uppercase, and add a single leading `#` if one is missing. Returns the
 * canonical tag, or `null` if the result is not a valid tag — malformed input
 * (including a stray extra `#`, e.g. `##PYL`) is rejected, never repaired.
 *
 * Invalid characters are rejected, never silently rewritten (e.g. a typo `O`
 * for `0` yields `null` rather than a guessed tag) — callers must surface the
 * rejection to the user.
 */
export function normalizeCocTag(input: string): string | null {
  const trimmed = input.trim().toUpperCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return COC_TAG_REGEX.test(withHash) ? withHash : null;
}

/**
 * URL-encode a valid tag for use in an upstream API path (`#` -> `%23`).
 *
 * Fail-closed: throws if `tag` is not a valid CoC tag, so a malformed or
 * injection-bearing value can never reach an upstream URL even when a caller
 * forgets to validate first. This is the last line of the SSRF / path-injection
 * guard (DESIGN §4); prefer {@link normalizeCocTag} to validate user input.
 */
export function encodeCocTag(tag: string): string {
  if (!isValidCocTag(tag)) {
    throw new Error("encodeCocTag: refusing to encode an invalid CoC tag");
  }
  return encodeURIComponent(tag);
}
