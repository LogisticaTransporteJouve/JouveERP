import { readdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "./fixtures";

// No dashboard screen may scroll sideways on a phone. The page scrolls in
// `main[data-slot=sidebar-inset]` (not the document), so that is the element
// whose content must fit its width. Every static route under app/(dashboard)
// is visited, so a new screen is covered without editing this list; routes
// with a parameter ("/invoices/[id]") are skipped: they need a record.

// Playwright runs from the repo root (where playwright.config.ts lives).
const DASHBOARD = path.resolve("app/(dashboard)");

function routes(dir: string, prefix: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const own = entries.some((e) => e.isFile() && e.name === "page.tsx")
    ? [prefix || "/"]
    : [];
  return [
    ...own,
    ...entries
      .filter((e) => e.isDirectory() && !e.name.includes("["))
      .flatMap((e) => routes(path.join(dir, e.name), `${prefix}/${e.name}`)),
  ];
}

const ROUTES = routes(DASHBOARD, "").sort();

test.describe("phone width (360 px)", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("finds the dashboard routes", () => {
    expect(ROUTES).toContain("/invoices");
  });

  for (const route of ROUTES) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await page.goto(route);
      const main = page.locator("main[data-slot=sidebar-inset]");
      await expect(main).toBeVisible();
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await main.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(
        scrollWidth,
        `${route} is wider than the screen`,
      ).toBeLessThanOrEqual(clientWidth);
    });
  }
});
