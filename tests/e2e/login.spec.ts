import { expect, test } from "@playwright/test";

// Login flow uses the storageState saved by auth.setup.ts. These tests
// either inherit that auth (already on dashboard) or sign out and verify
// the unauth surface explicitly.

test.describe("authenticated dashboard", () => {
  test("renders the dashboard for a logged-in user", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    // Sidebar shows the user's email in the footer.
    await expect(page.getByText(process.env.E2E_USER_EMAIL ?? "tomas@jouve.test")).toBeVisible();
  });

  test("logout returns to /auth/login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /cerrar sesión/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

test.describe("login form (unauthenticated)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows an error on bad credentials", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill("nope@invalid.test");
    await page.getByLabel("Contraseña").fill("wrong-password");
    await page.getByRole("button", { name: /ingresar/i }).click();
    // The action surfaces a generic message; we just check it renders.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
