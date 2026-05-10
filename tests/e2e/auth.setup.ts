import { expect, test as setup } from "@playwright/test";

const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? "tomas@jouve.test";
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD ?? "Test1234!";

const STORAGE_PATH = "tests/e2e/.auth/user.json";

setup("authenticate", async ({ page, baseURL }) => {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /ingresar/i }).click();

  // The login form redirects to /dashboard on success.
  await expect(page).toHaveURL(/\/dashboard/);

  // Persist the sidebar in expanded state so subsequent tests can locate
  // text-only elements (user email, "Cerrar sesión" label) — the layout
  // defaults to icon-collapsed when the cookie is missing, which hides
  // the labels via `group-data-[collapsible=icon]:hidden`.
  await page.context().addCookies([
    {
      name: "sidebar_state",
      value: "true",
      url: baseURL,
    },
  ]);

  await page.context().storageState({ path: STORAGE_PATH });
});
