// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const vehicle = {
  id: "v1",
  patente: "AB123CD",
  alias: null,
  vehicle_type: "camion",
  brand: null,
  model: null,
  year: null,
  is_active: true,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-vehicles", () => ({
  useVehicles: () => ({ data: [vehicle] }),
  useDeleteVehicle: () => ({ mutate: vi.fn(), isPending: false }),
  useSetVehicleActive: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./vehicle-dialog", () => ({ VehicleDialog: () => null }));

const { VehiclesTable } = await import("./vehicles-table");

afterEach(cleanup);

describe("VehiclesTable: write controls follow vehicles:write", () => {
  it.each([
    ["operations", resolveAccess(["operations"]), true],
    [
      "operations with vehicles:write denied",
      resolveAccess(["operations"], ["vehicles:write"]),
      false,
    ],
  ])(
    "%s gets Nuevo vehículo, the row menu and Activo: %s",
    (_, access, can) => {
      render(<VehiclesTable actorAccess={access} />);
      expect(screen.getByText("AB123CD")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Nuevo vehículo/ }) !== null,
      ).toBe(can);
      expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
        can,
      );
      const toggle = screen.getByRole("switch", { name: "Activo" });
      expect(toggle.hasAttribute("disabled")).toBe(!can);
    },
  );
});
