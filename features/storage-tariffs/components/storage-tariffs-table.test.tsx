// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const tariff = {
  id: "st1",
  client: { legal_name: "Acme" },
  area_label: null,
  migrated_to_client_tariffs_at: null,
  rate_per_pallet: 100,
  period: "monthly",
  handling_in: 10,
  handling_out: 10,
  valid_from: "2026-01-01",
  valid_to: null,
  is_active: true,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-storage-tariffs", () => ({
  useStorageTariffs: () => ({ data: [tariff] }),
  useDeleteStorageTariff: () => ({ mutate: vi.fn(), isPending: false }),
  useSetStorageTariffActive: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./storage-tariff-dialog", () => ({ StorageTariffDialog: () => null }));
vi.mock("./increase-tariffs-dialog", () => ({
  IncreaseTariffsDialog: () => null,
}));

const { StorageTariffsTable } = await import("./storage-tariffs-table");

afterEach(cleanup);

describe("StorageTariffsTable: write controls follow storage_billing:issue", () => {
  it.each([
    ["finance", resolveAccess(["finance"]), true],
    [
      "finance with storage_billing:issue denied",
      resolveAccess(["finance"], ["storage_billing:issue"]),
      false,
    ],
  ])("%s gets the tariff write controls: %s", (_, access, can) => {
    render(<StorageTariffsTable actorAccess={access} clientOptions={[]} />);
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Nueva tarifa/ }) !== null,
    ).toBe(can);
    expect(screen.queryByRole("button", { name: /Aumentar %/ }) !== null).toBe(
      can,
    );
    expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
      can,
    );
    const toggle = screen.getByRole("switch", { name: "Activo" });
    expect(toggle.hasAttribute("disabled")).toBe(!can);
  });
});
