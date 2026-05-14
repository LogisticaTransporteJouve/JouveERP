import { expect, test } from "./fixtures";

// Smoke E2E del subsistema de chat. Asume:
//   - Supabase local corriendo
//   - pnpm seed:dev ejecutado (deja el user del .env listo)
//   - Migraciones aplicadas
//
// Cubre el happy path: self-channel funciona end-to-end + perfil
// guarda nombre + el chat invita ⌘K para buscar. NO incluye flows
// multi-user (DM con otro empleado): eso requiere dos sesiones
// paralelas; va en una suite específica si llega el dolor.

test.describe("Chat — self channel happy path", () => {
  test.setTimeout(30_000);

  test("perfil → /chat redirige al self → mensaje aparece en el thread", async ({
    page,
  }) => {
    // 1. Setear nombre en el perfil (necesario para que el avatar/
    //    "X está escribiendo" rendericen algo legible).
    await page.goto("/profile");
    await expect(
      page.getByRole("heading", { name: /mi perfil/i }),
    ).toBeVisible();

    const firstName = page.getByLabel("Nombre");
    const lastName = page.getByLabel("Apellido");
    await firstName.fill("Tomás");
    await lastName.fill("Dziurdzia");
    await page.getByRole("button", { name: /guardar cambios/i }).click();
    await expect(page.getByText(/perfil actualizado/i)).toBeVisible();

    // 2. Ir al chat: la home redirige al self channel.
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/);

    // 3. Mandar un mensaje en el self channel.
    const composer = page.getByPlaceholder(/escribí un mensaje/i);
    await composer.fill("nota de prueba e2e");
    await composer.press("Enter");

    // 4. El mensaje debería verse en el thread inmediatamente
    //    (optimistic + realtime).
    await expect(page.getByText("nota de prueba e2e")).toBeVisible();

    // 5. El sidebar debería listar el canal "Mis notas".
    await expect(page.getByText(/mis notas/i).first()).toBeVisible();
  });

  test("⌘K abre el dialog de búsqueda", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);

    await page.keyboard.press("Meta+k");
    await expect(
      page.getByPlaceholder(/buscá una palabra/i),
    ).toBeVisible();

    // Cerrar el dialog con Escape para no contaminar el siguiente test.
    await page.keyboard.press("Escape");
  });

  test("el bell del header está visible y abre el popover", async ({ page }) => {
    await page.goto("/dashboard");
    const bell = page.getByRole("button", { name: /notificaciones/i });
    await expect(bell).toBeVisible();

    await bell.click();
    await expect(page.getByText(/notificaciones/i).first()).toBeVisible();
  });
});

test.describe("Chat — nuevo DM dialog", () => {
  test("abre el dialog de nuevo chat con tabs Persona/Grupo", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);

    await page.getByRole("button", { name: /nuevo/i }).click();
    await expect(
      page.getByRole("heading", { name: /nuevo chat/i }),
    ).toBeVisible();

    await expect(page.getByRole("tab", { name: /persona/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /grupo/i })).toBeVisible();

    // Cambiar a la tab de grupo y verificar que aparece el input nombre.
    await page.getByRole("tab", { name: /grupo/i }).click();
    await expect(
      page.getByPlaceholder(/nombre del grupo/i),
    ).toBeVisible();
  });
});
