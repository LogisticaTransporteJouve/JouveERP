import { expect, test as setup } from "@playwright/test";

const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? "tomas@jouve.test";
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD ?? "Test1234!";

const STORAGE_PATH = "tests/e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /ingresar/i }).click();

  // The login form redirects to /dashboard on success.
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().storageState({ path: STORAGE_PATH });
});
