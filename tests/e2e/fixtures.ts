import { test as base } from "@playwright/test";

// Hides the Next.js dev overlay (<nextjs-portal>) which intercepts
// pointer events and breaks clicks on overlapping UI. Import test/expect
// from here instead of @playwright/test.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent =
        "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }";
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
