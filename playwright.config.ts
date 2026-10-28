import { defineConfig, devices } from "@playwright/test";

import { STORAGE_STATE_PATH } from "./tests/e2e/constants";

// E2E tests run against an already-running dev stack:
//   pnpm dlx supabase start
//   pnpm dev
//   pnpm dev:inngest  (only for the AFIP-emit suite)
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
  },
  projects: [
    {
      // storageState lives on the chromium project (not global `use`) so
      // setup starts clean — a global storageState fails with ENOENT on
      // fresh checkouts before the file is written.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
    },
  ],
});
