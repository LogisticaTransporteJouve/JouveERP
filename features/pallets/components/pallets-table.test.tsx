// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Pallet } from "../schema";

const pallet: Pallet = {
  id: "p1",
  warehouse_id: "w1",
  client_id: "c1",
  product_id: null,
  code: "P-001",
  quantity: 10,
  status: "en_deposito",
  entry_date: "2026-10-01",
  exit_date: null,
  notes: null,
  area_id: null,
  lot_number: null,
  lot_expiry: null,
  blocked_at: null,
  blocked_by: null,
  block_reason: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  warehouse: { name: "Central" },
  client: { legal_name: "Cliente" },
  product: null,
  area: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => async () => false,
}));
vi.mock("../hooks/use-pallets", () => ({
  usePallets: () => ({ data: [pallet] }),
  useDeletePallet: () => ({ mutate: vi.fn() }),
}));
vi.mock("./block-pallet-dialog", () => ({ BlockPalletDialog: () => null }));
vi.mock("./bulk-pallet-dialog", () => ({ BulkPalletDialog: () => null }));
vi.mock("./dispatch-pallets-dialog", () => ({
  DispatchPalletsDialog: () => null,
}));
vi.mock("./pallet-dialog", () => ({ PalletDialog: () => null }));

const { PalletsTable } = await import("./pallets-table");

function renderTable(canWrite: boolean, canMoveStock: boolean) {
  return render(
    <PalletsTable
      warehouseOptions={[]}
      clientOptions={[]}
      productOptions={[]}
      areaOptions={[]}
      canWrite={canWrite}
      canMoveStock={canMoveStock}
    />,
  );
}

afterEach(cleanup);

describe("PalletsTable gates", () => {
  it("offers create, bulk, selection and row actions with both permissions", () => {
    renderTable(true, true);
    expect(screen.getByText("Nuevo pallet")).toBeTruthy();
    expect(screen.getByText("Cargar varios")).toBeTruthy();
    expect(screen.getByLabelText("Seleccionar P-001")).toBeTruthy();
    expect(screen.getAllByLabelText("Acciones").length).toBeGreaterThan(0);
  });

  it("hides every stock-moving control without stock_movements:write", () => {
    renderTable(true, false);
    expect(screen.queryByText("Nuevo pallet")).toBeNull();
    expect(screen.queryByText("Cargar varios")).toBeNull();
    expect(screen.queryByLabelText("Seleccionar P-001")).toBeNull();
    // Edit and block stay: they need only pallets:write.
    expect(screen.getAllByLabelText("Acciones").length).toBeGreaterThan(0);
  });

  it("shows no row menu without pallets:write", () => {
    renderTable(false, false);
    expect(screen.queryByLabelText("Acciones")).toBeNull();
  });
});
