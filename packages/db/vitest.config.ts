import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Booting a real embedded Postgres + running migrations takes a while
    // (and the binary may download on first run).
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
