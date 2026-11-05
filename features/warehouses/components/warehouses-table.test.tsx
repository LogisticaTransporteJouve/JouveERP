// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const warehouse = {
  id: "w1",
  name: "Depósito Norte",
  address: null,
  capacity_pallets: null,
  is_active: true,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-warehouses", () => ({
  useWarehouses: () => ({ data: [warehouse] }),
  useDeleteWarehouse: () => ({ mutate: vi.fn(), isPending: false }),
  useSetWarehouseActive: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./warehouse-dialog", () => ({ WarehouseDialog: () => null }));
vi.mock("./storage-areas-dialog", () => ({ StorageAreasDialog: () => null }));

const { WarehousesTable } = await import("./warehouses-table");

afterEach(cleanup);

describe("WarehousesTable: write controls follow warehouses:write", () => {
  it.each([
    ["warehouse", resolveAccess(["warehouse"]), true],
    [
      "warehouse with warehouses:write denied",
      resolveAccess(["warehouse"], ["warehouses:write"]),
      false,
    ],
  ])(
    "%s gets Nuevo depósito, the row menu and Activo: %s",
    (_, access, can) => {
      render(<WarehousesTable actorAccess={access} />);
      expect(screen.getByText("Depósito Norte")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Nuevo depósito/ }) !== null,
      ).toBe(can);
      expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
        can,
      );
      const toggle = screen.getByRole("switch", { name: "Activo" });
      expect(toggle.hasAttribute("disabled")).toBe(!can);
    },
  );
});
