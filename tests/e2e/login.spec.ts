import { expect, test } from "./fixtures";
import { signInAndSaveState, TEST_EMAIL } from "./sign-in";

// Login flow uses the storageState saved by auth.setup.ts. These tests
// either inherit that auth (already on dashboard) or sign out and verify
// the unauth surface explicitly.

test.describe("authenticated dashboard", () => {
  test("renders the dashboard for a logged-in user", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    // Sidebar shows the user's email in the footer.
    await expect(
      page
        .getByText(TEST_EMAIL)
        // A user without a name shows the email as the name too.
        .first(),
    ).toBeVisible();
  });
});

test.describe("logout", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("logout returns to /auth/login", async ({ page, baseURL }) => {
    // supabase.auth.signOut() revokes every session of the user, including
    // the shared storageState one. Sign out from a session of its own, then
    // sign back in and rewrite the shared state for the tests that follow
    // (and for this test's retries).
    await signInAndSaveState(page, baseURL ?? "http://localhost:3000");
    // Sign-out lives in the sidebar's user menu.
    await page.getByRole("button", { name: TEST_EMAIL }).click();
    await page.getByRole("menuitem", { name: /cerrar sesión/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });

    await signInAndSaveState(page, baseURL ?? "http://localhost:3000");
  });
});

test.describe("login form (unauthenticated)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows an error on bad credentials", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill("nope@invalid.test");
    await page.getByLabel("Contraseña").fill("wrong-password");
    await page.getByRole("button", { name: /ingresar/i }).click();
    // The action surfaces a generic message; we just check it renders. Next's
    // route announcer is an empty role="alert" too, so match on content.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible(
      { timeout: 5_000 },
    );
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
