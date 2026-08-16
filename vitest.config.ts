import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests for the pure logic — pricing, balances, who is checked in, what
// an approval writes. No database and no browser: every function under test
// takes values and returns values, which is why these run in a second and can
// go in front of every commit.
//
// The database layer has its own suite (npm run test:policies), and neither
// replaces the other: that one proves what Postgres will refuse, this one
// proves what the app calculates.
export default defineConfig({
  resolve: {
    // The same @/ alias tsconfig.json declares, so tests import modules by
    // the path the app uses rather than by relative guesswork.
    alias: { "@": path.resolve(__dirname, "./") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
