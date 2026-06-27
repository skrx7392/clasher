import { defineConfig } from "vitest/config";

export default defineConfig({
  // Use the automatic JSX runtime (matches Next) so components render without a
  // React import; renderToStaticMarkup needs no DOM, so the node env suffices.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
