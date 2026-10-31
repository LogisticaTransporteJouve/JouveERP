import { expect, type Page } from "@playwright/test";

import { STORAGE_STATE_PATH } from "./constants";

export const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? "tomas@jouve.test";
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD ?? "Test1234!";

/** Signs in through the login form and writes the shared storageState that
 *  every chromium test starts from. */
export async function signInAndSaveState(page: Page, baseURL: string) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /ingresar/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Sidebar defaults to icon-collapsed when the cookie is missing, which
  // hides text labels (user email, "Cerrar sesión") via Tailwind's
  // group-data-[collapsible=icon]:hidden — break the default for tests.
  await page
    .context()
    .addCookies([{ name: "sidebar_state", value: "true", url: baseURL }]);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
}
