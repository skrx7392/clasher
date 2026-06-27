import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { THEMES, THEME_IDS, DEFAULT_THEME } from "../app/themes";

const tokensCss = readFileSync(new URL("../app/styles/tokens.css", import.meta.url), "utf8");

/** Color tokens every theme block must declare (kept in sync with :root). */
function colorTokensIn(block: string): Set<string> {
  return new Set(block.match(/--clr-[a-z-]+/g) ?? []);
}

/** Parse `--name: value;` and `color-scheme: value;` declarations from a block. */
function declarationsIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--clr-[a-z-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    const key = m[1];
    const value = m[2];
    if (key && value) out[key] = value.trim();
  }
  return out;
}

/** Extract the body of a `selector { … }` block from the CSS source. */
function blockBody(css: string, selector: string): string | null {
  const start = css.indexOf(selector + " {");
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return close === -1 ? null : css.slice(open + 1, close);
}

describe("theme registry (single source of truth)", () => {
  it("exposes multiple themes with unique ids", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(2);
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
  });

  it("default theme is registered", () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME);
  });

  it("every theme has a label and description", () => {
    for (const t of THEMES) {
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
    }
  });

  it("registry ids and tokens.css [data-theme] blocks match EXACTLY (no orphans either way)", () => {
    const cssThemeIds = [...tokensCss.matchAll(/\[data-theme="([a-z]+)"\]/g)].map((m) => m[1]);
    expect(new Set(cssThemeIds)).toEqual(new Set(THEME_IDS));
  });

  it("every theme block declares the SAME color tokens as :root (no silent fallback)", () => {
    const rootTokens = colorTokensIn(blockBody(tokensCss, ":root") ?? "");
    expect(rootTokens.size).toBeGreaterThan(0);
    for (const id of THEME_IDS) {
      const body = blockBody(tokensCss, `[data-theme="${id}"]`);
      expect(body, `missing [data-theme="${id}"] block`).not.toBeNull();
      expect(colorTokensIn(body ?? ""), `theme "${id}" is missing color tokens`).toEqual(
        rootTokens,
      );
    }
  });

  it(":root palette equals the DEFAULT_THEME (one canonical SSR/no-JS default)", () => {
    const root = declarationsIn(blockBody(tokensCss, ":root") ?? "");
    const def = declarationsIn(blockBody(tokensCss, `[data-theme="${DEFAULT_THEME}"]`) ?? "");
    // Compare only the keys present in the default theme block (color tokens +
    // color-scheme); :root additionally holds shared non-color tokens.
    for (const [key, value] of Object.entries(def)) {
      expect(root[key], `:root.${key} should match the ${DEFAULT_THEME} theme`).toBe(value);
    }
  });
});
