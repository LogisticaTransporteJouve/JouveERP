import { expect, test } from "@playwright/test";

// AFIP-emit smoke. Loga, abre el Dialog, completa datos mínimos, dispara
// "Emitir y solicitar CAE" y espera a que el detalle muestre un CAE de
// 14 dígitos. Cierra el ciclo end-to-end de Fase E.
//
// Por qué está gateado por env:
//   - Necesita `AFIP_ENV=homo` + `AFIP_CUIT` + `AFIP_CERT` + `AFIP_KEY`
//     en el server (homologación). Sin eso, la action falla apenas pide
//     CAE.
//   - Necesita un POS habilitado para `jouve_fiscal` (`is_enabled=true`).
//     Configurarlo en `/admin/afip/puntos-de-venta` antes de correr.
//   - Necesita el runtime de Inngest local
//     (`pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest`).
//
// Para correrlo:
//   RUN_AFIP_E2E=1 pnpm test:e2e --grep "AFIP smoke"

const ENABLED = process.env.RUN_AFIP_E2E === "1";

test.describe("AFIP smoke — emite factura y espera CAE", () => {
  test.skip(
    !ENABLED,
    "RUN_AFIP_E2E=1 + AFIP creds + Inngest dev requeridos.",
  );
  // El roundtrip a homologación tarda ~5-8s, plus la pipeline de Inngest.
  // Damos 90s totales con buffer para arranque en frío.
  test.setTimeout(90_000);

  test("login → emitir → CAE", async ({ page }) => {
    await page.goto("/comprobantes");
    await expect(
      page.getByRole("heading", { name: /comprobantes/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^nuevo$/i }).click();
    const dialog = page.getByRole("dialog", { name: /nuevo comprobante/i });
    await expect(dialog).toBeVisible();

    // Cliente: PALLET SIRANS (en seed). Aparece en el popover apenas
    // tipeamos el nombre.
    const search = dialog.getByPlaceholder(/buscar por razón social/i);
    await search.click();
    await search.fill("PALLET SIRANS");
    await page
      .getByRole("button")
      .filter({ hasText: /pallet sirans/i })
      .first()
      .click();

    // El primer ítem (descripción libre + cantidad/precio). El form
    // siempre tiene una segunda fila "Seguro" que dejamos en blanco —
    // se filtra al submit cuando valor declarado es 0.
    const descInputs = dialog.getByPlaceholder(/^descripción$/i);
    await descInputs.first().fill("Smoke E2E AFIP");
    // Precio unitario en la primer fila (la fila "Seguro" usa "valor
    // declarado" como label, así que filtramos por placeholder $).
    const priceInputs = dialog.getByPlaceholder("$ 0,00");
    await priceInputs.first().fill("100");

    // Dispara la mutación. La action crea el draft y emite el evento de
    // Inngest; el dialog se cierra y navega a /comprobantes/[id].
    await dialog.getByRole("button", { name: /emitir y solicitar cae/i }).click();

    // Esperar la nav al detalle. La URL queda /comprobantes/<uuid>.
    await page.waitForURL(/\/comprobantes\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // El detalle hace polling cada 1.5s + tiene realtime. Esperamos a
    // que aparezca el CAE (14 dígitos numéricos).
    await expect(page.getByText(/^\d{14}$/)).toBeVisible({ timeout: 60_000 });

    // Sanity: aparece la card "Datos AFIP" con label "CAE".
    await expect(page.getByText(/datos afip/i)).toBeVisible();
    await expect(page.getByText(/^cae$/i).first()).toBeVisible();
  });
});
