import { expect, test } from "./fixtures";

// AFIP-emit smoke (gated by RUN_AFIP_E2E=1). Requires AFIP_ENV=homo +
// creds, a POS habilitado para `jouve_fiscal`, y el runtime de Inngest
// local. Run: `RUN_AFIP_E2E=1 pnpm test:e2e --grep "AFIP smoke"`.

const ENABLED = process.env.RUN_AFIP_E2E === "1";

test.describe("AFIP smoke — emite factura y espera CAE", () => {
  test.skip(
    !ENABLED,
    "RUN_AFIP_E2E=1 + AFIP creds + Inngest dev requeridos.",
  );
  // Homologación roundtrip ~5-8s + pipeline de Inngest + arranque en frío.
  test.setTimeout(90_000);

  test("login → emitir → CAE", async ({ page }) => {
    await page.goto("/comprobantes");
    await expect(
      page.getByRole("heading", { name: /comprobantes/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^nuevo$/i }).click();
    const dialog = page.getByRole("dialog", { name: /nuevo comprobante/i });
    await expect(dialog).toBeVisible();

    const search = dialog.getByPlaceholder(/buscar por razón social/i);
    await search.click();
    await search.fill("PALLET SIRANS");
    await page
      .getByRole("button")
      .filter({ hasText: /pallet sirans/i })
      .first()
      .click();

    // .first() en ambos: la fila "Seguro" comparte placeholder con la
    // fila editable y queda al final.
    await dialog.getByPlaceholder(/^descripción$/i).first().fill("Smoke E2E AFIP");
    await dialog.getByPlaceholder("$ 0,00").first().fill("100");

    await dialog.getByRole("button", { name: /emitir y solicitar cae/i }).click();

    await page.waitForURL(/\/comprobantes\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByText(/^\d{14}$/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/datos afip/i)).toBeVisible();
    await expect(page.getByText(/^cae$/i).first()).toBeVisible();
  });
});
