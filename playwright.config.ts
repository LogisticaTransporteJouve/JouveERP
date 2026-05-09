import { defineConfig, devices } from "@playwright/test";

// E2E tests run against an already-running dev stack:
//   pnpm dlx supabase start
//   pnpm dev
//   pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest  (only for the AFIP-emit suite)
//
// We do NOT spawn the dev server from here on purpose — Next.js takes a
// while to compile on first hit and we'd rather fail fast if the dev
// process isn't already up.

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // shared auth state — one browser at a time
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    storageState: "tests/e2e/.auth/user.json",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: undefined },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
