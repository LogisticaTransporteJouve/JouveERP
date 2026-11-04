// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { CostCenter } from "../schema";

const center: CostCenter = {
  id: "cc1",
  code: "FLOTA",
  name: "Flota",
  description: null,
  is_active: true,
  vehicle_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-cost-centers", () => ({
  useCostCenters: () => ({ data: [center] }),
  useCostCenterVehicles: () => ({ data: [] }),
  useDeleteCostCenter: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./cost-center-dialog", () => ({ CostCenterDialog: () => null }));

const { CostCentersTable } = await import("./cost-centers-table");

afterEach(cleanup);

describe("CostCentersTable: write controls follow accounting:write", () => {
  it.each([
    ["finance", resolveAccess(["finance"]), true],
    ["fiscal_reader", resolveAccess(["fiscal_reader"]), false],
    [
      "admin with accounting:write denied",
      resolveAccess(["admin"], ["accounting:write"]),
      false,
    ],
  ])("%s sees Nuevo centro and the row menu: %s", (_, access, visible) => {
    render(<CostCentersTable actorAccess={access} />);
    expect(screen.getByText("Flota")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Nuevo centro/ }) !== null,
    ).toBe(visible);
    expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
      visible,
    );
  });
});
