// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const load = {
  id: "f1",
  load_date: "2026-11-01",
  vehicle: { patente: "AB123CD" },
  liters: 100,
  amount: 50000,
  station: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-fuel", () => ({
  useFuelLoads: () => ({ data: [load] }),
  useDeleteFuelLoad: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./fuel-dialog", () => ({ FuelDialog: () => null }));
vi.mock("./fuel-import-dialog", () => ({ FuelImportDialog: () => null }));
vi.mock("./fuel-ticket-dialog", () => ({ FuelTicketDialog: () => null }));

const { FuelTable } = await import("./fuel-table");

afterEach(cleanup);

const voucherAccess = { purchaseInvoices: false, transactions: false };
const menuItem = (name: string) =>
  screen.queryByRole("menuitem", { name }) !== null;

describe("FuelTable: write controls follow fuel:write", () => {
  it.each([
    ["operations", resolveAccess(["operations"]), true],
    [
      "operations with fuel:write denied",
      resolveAccess(["operations"], ["fuel:write"]),
      false,
    ],
  ])(
    "%s gets Nueva carga, Importar resumen and the row menu: %s",
    (_, access, can) => {
      render(
        <FuelTable
          actorAccess={access}
          vehicleOptions={[]}
          tripOptions={[]}
          voucherAccess={voucherAccess}
          fileAccess={null}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /Nueva carga/ }) !== null,
      ).toBe(can);
      expect(
        screen.queryByRole("button", { name: /Importar resumen/ }) !== null,
      ).toBe(can);
      expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
        can,
      );
    },
  );

  it("keeps «Ticket o remito» for a reader of files without fuel:write", () => {
    render(
      <FuelTable
        actorAccess={resolveAccess(["operations"], ["fuel:write"])}
        vehicleOptions={[]}
        tripOptions={[]}
        voucherAccess={voucherAccess}
        fileAccess={{ write: false, delete: true }}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Acciones" }), {
      key: "Enter",
    });
    expect(menuItem("Ticket o remito")).toBe(true);
    expect(menuItem("Editar")).toBe(false);
    expect(menuItem("Borrar")).toBe(false);
  });
});
