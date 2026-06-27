import { describe, it, expect } from "vitest";
import {
  COC_TAG_REGEX,
  CocRole,
  UserRole,
  WarType,
  SnapshotSource,
  CLAN_MANAGER_ROLES,
  canManageClan,
  isValidCocTag,
  normalizeCocTag,
  encodeCocTag,
} from "../src/index";

describe("COC_TAG_REGEX / isValidCocTag — SSRF / path-injection guard (DESIGN §4)", () => {
  it("accepts well-formed tags from the restricted alphabet", () => {
    for (const tag of ["#PYL", "#2PP", "#0289PYLQGRJCUV", "#90GVL9YR"]) {
      expect(isValidCocTag(tag)).toBe(true);
    }
  });

  it("rejects tags missing the leading #, too short, or lowercase", () => {
    for (const tag of ["", "#", "#PY", "PYL", "#pyl"]) {
      expect(isValidCocTag(tag)).toBe(false);
    }
  });

  it("rejects characters outside the alphabet (note: O is excluded to avoid 0 confusion)", () => {
    for (const tag of ["#OYL", "#PYI", "#PYL!", "#PY L", "#PY-L"]) {
      expect(isValidCocTag(tag)).toBe(false);
    }
  });

  it("rejects path/query/fragment injection payloads", () => {
    for (const tag of ["#PYL/../../etc", "#PYL/clans", "#PYL?x=1", "#PYL#frag", "#PYL%2F"]) {
      expect(isValidCocTag(tag)).toBe(false);
    }
  });

  it("is anchored without the multiline flag — embedded/trailing newlines cannot smuggle a valid line", () => {
    expect(COC_TAG_REGEX.multiline).toBe(false);
    for (const tag of ["#PYL\n", "\n#PYL", "#PYL\nEVIL", "#EVIL\n#PYL"]) {
      expect(isValidCocTag(tag)).toBe(false);
    }
  });

  it("is length-bounded: accepts up to 15 chars, rejects 16+ (no oversized paths)", () => {
    expect(isValidCocTag("#" + "P".repeat(15))).toBe(true);
    expect(isValidCocTag("#" + "P".repeat(16))).toBe(false);
  });

  it("has no catastrophic-backtracking blowup on a large input", () => {
    const huge = "#" + "P".repeat(2_000_000);
    const start = performance.now();
    expect(isValidCocTag(huge)).toBe(false);
    expect(performance.now() - start).toBeLessThan(250);
  });

  it("is runtime-safe against non-string input (cannot be coerced past the guard)", () => {
    // RegExp.test would coerce these to strings; the typeof guard must reject them.
    for (const notAString of [["#PYL"], { toString: () => "#PYL" }, 123, null, undefined]) {
      expect(isValidCocTag(notAString as unknown)).toBe(false);
      expect(normalizeCocTag(notAString as unknown)).toBeNull();
      expect(() => encodeCocTag(notAString as unknown)).toThrow();
    }
  });
});

describe("normalizeCocTag", () => {
  it("trims, uppercases, and adds a single leading #", () => {
    expect(normalizeCocTag("  pyl ")).toBe("#PYL");
    expect(normalizeCocTag("#pyl")).toBe("#PYL");
    expect(normalizeCocTag("90gvl9yr")).toBe("#90GVL9YR");
  });

  it("trims surrounding whitespace (incl. newlines/tabs) before validating", () => {
    expect(normalizeCocTag("#PYL\n")).toBe("#PYL");
    expect(normalizeCocTag("\t  #PYL  ")).toBe("#PYL");
  });

  it("rejects (returns null) malformed input rather than repairing it", () => {
    // Includes an INTERNAL newline (#PY\nL) — trim only strips the ends, so this
    // stays invalid and cannot smuggle a second line past the guard.
    for (const input of ["", "#", "PY", "##PYL", "#OYL", "#PY\nL", "p y l"]) {
      expect(normalizeCocTag(input)).toBeNull();
    }
  });
});

describe("encodeCocTag — fail-closed", () => {
  it("encodes # to %23 for a valid tag", () => {
    expect(encodeCocTag("#PYL")).toBe("%23PYL");
  });

  it("throws on any invalid tag (cannot reach an upstream URL)", () => {
    for (const bad of ["PYL", "#PYL/../x", "#PYL?x=1", "#pyl", ""]) {
      expect(() => encodeCocTag(bad)).toThrow();
    }
  });
});

describe("role / enum values match the CoC API exactly", () => {
  it("CocRole string values", () => {
    expect(CocRole.Leader).toBe("leader");
    expect(CocRole.CoLeader).toBe("coLeader");
    // API `admin` == in-game "Elder"
    expect(CocRole.Elder).toBe("admin");
    expect(CocRole.Member).toBe("member");
    expect(CocRole.NotMember).toBe("notMember");
  });

  it("other enums", () => {
    expect(UserRole.None).toBe("none");
    expect(WarType.Cwl).toBe("cwl");
    expect(SnapshotSource.ClashKing).toBe("clashking");
    expect(SnapshotSource.FirstParty).toBe("first_party");
  });

  it("canManageClan is true only for leader / co-leader", () => {
    expect(CLAN_MANAGER_ROLES).toEqual([CocRole.Leader, CocRole.CoLeader]);
    expect(canManageClan(CocRole.Leader)).toBe(true);
    expect(canManageClan(CocRole.CoLeader)).toBe(true);
    expect(canManageClan(CocRole.Elder)).toBe(false);
    expect(canManageClan(CocRole.Member)).toBe(false);
    expect(canManageClan(CocRole.NotMember)).toBe(false);
  });
});
