import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { THEMES, THEME_IDS, DEFAULT_THEME } from "../app/themes";

const tokensCss = readFileSync(new URL("../app/styles/tokens.css", import.meta.url), "utf8");

describe("theme registry (single source of truth)", () => {
  it("exposes multiple themes with unique ids", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(2);
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
  });

  it("default theme is registered", () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME);
  });

  it("every theme has a label, description, and gradient swatch", () => {
    for (const t of THEMES) {
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.swatch).toContain("gradient");
    }
  });

  it("every theme id has a matching [data-theme] block in tokens.css (no drift)", () => {
    for (const id of THEME_IDS) {
      expect(tokensCss).toContain(`[data-theme="${id}"]`);
    }
  });
});
