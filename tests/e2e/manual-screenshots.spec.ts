import path from "node:path";

import { test } from "@playwright/test";

import { GUIDE_PAGES } from "../../features/guide/manual/content";

// `pnpm manual:screenshots`: a real screenshot of every screen the user guide
// documents, against the local seeded stack (pnpm dev:up + pnpm seed:all),
// to compare with the guide's replicas. Skipped in a normal `pnpm test:e2e`.
// Routes with a parameter ("/invoices/[id]") are skipped: they need a record.

const OUT = path.join("test-results", "manual-screenshots");

const ROUTES = [
  ...new Set(
    GUIDE_PAGES.flatMap((p) => p.sections.flatMap((s) => s.routes)).filter(
      (r) => !r.includes("["),
    ),
  ),
].sort();

test.describe("manual screenshots", () => {
  test.skip(
    !process.env.MANUAL_SCREENSHOTS,
    "Run with pnpm manual:screenshots.",
  );

  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page.screenshot({
        path: path.join(OUT, `${route.slice(1).replace(/\//g, "__")}.png`),
        fullPage: true,
      });
    });
  }
});
