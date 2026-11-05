// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const record = {
  id: "m1",
  service_date: "2026-11-01",
  vehicle: { patente: "AB123CD" },
  kind: "service",
  description: "Cambio de aceite",
  cost: null,
  odometer_km: null,
  next_service_date: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-maintenance", () => ({
  useMaintenance: () => ({ data: [record] }),
  useDeleteMaintenance: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./maintenance-dialog", () => ({ MaintenanceDialog: () => null }));

const { MaintenanceTable } = await import("./maintenance-table");

afterEach(cleanup);

describe("MaintenanceTable: write controls follow maintenance:write", () => {
  it.each([
    ["operations", resolveAccess(["operations"]), true],
    [
      "operations with maintenance:write denied",
      resolveAccess(["operations"], ["maintenance:write"]),
      false,
    ],
  ])("%s gets Nuevo mantenimiento and the row menu: %s", (_, access, can) => {
    render(
      <MaintenanceTable
        actorAccess={access}
        vehicleOptions={[]}
        voucherAccess={{ purchaseInvoices: false, transactions: false }}
      />,
    );
    expect(screen.getByText("Cambio de aceite")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Nuevo mantenimiento/ }) !== null,
    ).toBe(can);
    expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
      can,
    );
  });
});
