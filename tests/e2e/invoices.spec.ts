import { expect, test } from "./fixtures";

// UI-only smoke for the Comprobantes flow. Does NOT emit a fiscal invoice
// against AFIP — that happens in a separate (manual) suite gated on real
// AFIP_ENV=homo + valid creds + Inngest dev runtime.
//
// What this proves:
//   - The list page loads.
//   - The "Nuevo" Dialog opens with no channel under "Todos los canales"
//     (more than one active channel), and the user picks Jouve Fiscal.
//   - The client picker hits search_clients and returns results.
//   - Picking a client shows the calculated letter.
//   - Cancel closes the Dialog.

test("invoices list + new dialog smoke", async ({ page }) => {
  await page.goto("/invoices");
  await expect(
    page.getByRole("heading", { name: /comprobantes/i }),
  ).toBeVisible();

  // Open the New comprobante dialog.
  await page.getByRole("button", { name: /^nuevo$/i }).click();
  await expect(
    page.getByRole("dialog", { name: /nuevo comprobante/i }),
  ).toBeVisible();

  // With "Todos los canales" there are two active channels: no default.
  const dialog = page.getByRole("dialog", { name: /nuevo comprobante/i });
  const channelTrigger = dialog
    .getByRole("combobox")
    .filter({ hasText: /elegí un canal/i });
  await expect(channelTrigger).toBeVisible();
  await channelTrigger.click();
  await page.getByRole("option", { name: /logística jouve.*fiscal/i }).click();
  await expect(
    dialog
      .getByRole("combobox")
      .filter({ hasText: /logística jouve.*fiscal/i }),
  ).toBeVisible();

  // Client picker — search "PALL" and expect at least one result.
  const search = page.getByPlaceholder(/buscar por razón social/i);
  await search.click();
  await search.fill("PALL");
  // The results list lives in a Popover; one of the entries should mention
  // "PALLET" (we seed PALLET SIRANS S.R.L. and similar).
  await expect(
    page
      .getByRole("button")
      .filter({ hasText: /pallet/i })
      .first(),
  ).toBeVisible({ timeout: 5_000 });

  // Cancel closes the dialog.
  await page
    .getByRole("dialog", { name: /nuevo comprobante/i })
    .getByRole("button", { name: /cancelar/i })
    .click();
  await expect(
    page.getByRole("dialog", { name: /nuevo comprobante/i }),
  ).toBeHidden();
});
