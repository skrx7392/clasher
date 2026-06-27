import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Each db test file boots its own embedded Postgres; run files serially so
    // they don't contend (each still uses an ephemeral port as belt-and-braces).
    fileParallelism: false,
    // Booting a real embedded Postgres + running migrations takes a few seconds.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
