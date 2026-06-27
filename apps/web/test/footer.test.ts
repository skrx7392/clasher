import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Footer } from "../app/components/Footer";

// renderToStaticMarkup keeps the test DOM-free; JSX in Footer.tsx is transpiled
// by esbuild's automatic runtime (vitest.config.ts).
const html = renderToStaticMarkup(createElement(Footer));

describe("Footer compliance (AC-7 / NFR-10 foundation)", () => {
  it("shows the Supercell 'not affiliated' Fan Content disclaimer", () => {
    expect(html).toMatch(/not affiliated with.*Supercell/i);
    expect(html).toContain("https://supercell.com/en/fan-content-policy/");
  });

  it("credits ClashKing for data", () => {
    expect(html).toContain("ClashKing");
    expect(html).toContain("https://clashk.ing");
  });

  it("credits cwlranking.vercel.app for the ranking (FR-44)", () => {
    expect(html).toContain("cwlranking.vercel.app");
  });
});
