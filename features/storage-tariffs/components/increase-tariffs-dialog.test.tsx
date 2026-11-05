// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageTariff } from "../schema";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format")>()),
  todayInAR: () => "2026-11-01",
}));
vi.mock("../hooks/use-storage-tariffs", () => ({
  useIncreaseStorageTariffs: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { IncreaseTariffsDialog } = await import("./increase-tariffs-dialog");

const tariff = (
  id: string,
  legalName: string,
  patch: Partial<StorageTariff> = {},
): StorageTariff => ({
  id,
  client_id: id,
  client: { legal_name: legalName },
  area_id: null,
  area_label: null,
  migrated_to_client_tariffs_at: null,
  rate_per_pallet: 100,
  period: "monthly",
  handling_in: 0,
  handling_out: 0,
  valid_from: "2026-01-01",
  valid_to: null,
  is_active: true,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  ...patch,
});

afterEach(cleanup);

describe("IncreaseTariffsDialog preview", () => {
  it("leaves out a tariff moved to the client's tarifario, like the action", () => {
    render(
      <IncreaseTariffsDialog
        open
        onOpenChange={() => {}}
        tariffs={[
          tariff("c1", "Acme"),
          tariff("c2", "Beta", {
            migrated_to_client_tariffs_at: "2026-11-04T00:00:00Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Afecta 1 tarifa(s): Acme.")).toBeTruthy();
  });

  it("says there is nothing to raise when every tariff moved", () => {
    render(
      <IncreaseTariffsDialog
        open
        onOpenChange={() => {}}
        tariffs={[
          tariff("c2", "Beta", {
            migrated_to_client_tariffs_at: "2026-11-04T00:00:00Z",
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("No hay tarifas vigentes anteriores a esa fecha."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Aplicar aumento" }),
    ).toHaveProperty("disabled", true);
  });
});
