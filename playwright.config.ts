import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// End-to-end tests: a real browser, the real app, the real database.
//
// These run against the SANDBOX Supabase project — the one on Cesar's own
// account, holding no client's data. That is what makes them possible at all:
// they sign dogs in, approve enrollments and retire dogs, which is not
// something you do to a business that is open.
//
// Before running, check `.env.local` points at the sandbox and not at a
// client's project. See docs/E2E-TESTS.md.

// Credentials come from .env.e2e, which is gitignored and which you fill in
// yourself. Loaded by hand rather than with dotenv: one fewer dependency for
// eight lines of parsing.
const envFile = path.resolve(__dirname, ".env.e2e");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

// No webServer here on purpose. The dev server picks its own port when 3000
// is taken, so guessing would start a second copy or collide with the first.
// Start it yourself and pass the port it printed.
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // One at a time. These share a database, and two workers approving
  // enrollments at once would race over the same review queue.
  workers: 1,
  fullyParallel: false,
  // A flake here usually means a slow round trip to Supabase rather than a
  // broken app, so one retry locally and two on CI.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    // Kept only for failures — a passing run should leave nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Signs in once and saves the sessions the gated specs reuse, so no test
    // spends thirty seconds typing a password it could have inherited.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "public",
      testMatch: /public\..*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "staff",
      testMatch: /staff\..*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: ".auth/staff.json" },
    },
    {
      name: "kiosk",
      testMatch: /kiosk\..*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: ".auth/kiosk.json" },
    },
  ],
});
