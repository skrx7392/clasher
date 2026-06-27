import { isValidCocTag, CocRole } from "@clasher/shared";

describe("@clasher/shared workspace import from apps/api (closes #1 AC)", () => {
  it("resolves via the workspace protocol and the SSRF guard works", () => {
    expect(isValidCocTag("#PYL")).toBe(true);
    expect(isValidCocTag("#bad/inject")).toBe(false);
    expect(CocRole.Elder).toBe("admin");
  });
});
