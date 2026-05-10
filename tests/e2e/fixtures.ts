import { test as base } from "@playwright/test";

// Extended Playwright `test` that hides the Next.js dev overlay
// (`<nextjs-portal>`) before any test runs. The portal element listens for
// pointer events globally and intercepts clicks on overlapping UI — most
// painfully on buttons in the bottom corners (e.g. the sidebar's "Cerrar
// sesión" footer button). Hiding it via CSS keeps prod parity since the
// portal isn't rendered in production anyway.
//
// Use this `test` instead of importing from "@playwright/test" directly:
//
//   import { test, expect } from "./fixtures";
//
// `expect` is re-exported for convenience.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent =
        "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }";
      // The DOMContentLoaded listener guards against the script running
      // before <head> exists (rare but possible during early navigations).
      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.addEventListener("DOMContentLoaded", () =>
          document.head.appendChild(style),
        );
      }
    });
    // ESLint mistakes Playwright's `use` callback for React's `use()` hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect } from "@playwright/test";
