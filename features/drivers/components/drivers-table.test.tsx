// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const driver = {
  id: "d1",
  full_name: "Juan Pérez",
  employee_id: null,
  cuit: null,
  license_number: null,
  license_category: null,
  phone: null,
  is_active: true,
  user_id: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
const confirmMock = vi.fn(async (_opts: { description?: string }) => false);
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => confirmMock,
}));
vi.mock("../hooks/use-drivers", () => ({
  useDrivers: () => ({ data: [driver] }),
  useDeleteDriver: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDriverActive: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./driver-dialog", () => ({ DriverDialog: () => null }));
vi.mock("./driver-link-dialog", () => ({ DriverLinkDialog: () => null }));

const { DriversTable } = await import("./drivers-table");

afterEach(cleanup);

const menuItem = (name: string) =>
  screen.queryByRole("menuitem", { name }) !== null;

describe("DriversTable: write controls follow drivers:write", () => {
  it.each([
    ["operations", resolveAccess(["operations"]), true],
    [
      "operations with drivers:write denied",
      resolveAccess(["operations"], ["drivers:write"]),
      false,
    ],
  ])("%s gets the driver write controls: %s", (_, access, can) => {
    render(<DriversTable actorAccess={access} />);
    expect(screen.getByText("Juan Pérez")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Nuevo chofer contratado/ }) !==
        null,
    ).toBe(can);
    expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
      can,
    );
    const toggle = screen.getByRole("switch", { name: "Activo" });
    expect(toggle.hasAttribute("disabled")).toBe(!can);
  });

  it("keeps «Vincular usuario» for a user who can link but not write", () => {
    render(
      <DriversTable
        actorAccess={resolveAccess(["admin"], ["drivers:write"])}
        linkableUsers={[]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Acciones" }), {
      key: "Enter",
    });
    expect(menuItem("Vincular usuario")).toBe(true);
    expect(menuItem("Editar")).toBe(false);
    expect(menuItem("Borrar")).toBe(false);
  });
});

// trips, fleet_documents and driver_settlements reference drivers ON DELETE
// RESTRICT: a driver with any of them cannot be deleted.
it("the delete confirmation says a driver with trips cannot be deleted", () => {
  render(<DriversTable actorAccess={resolveAccess(["operations"])} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Acciones" }), {
    key: "Enter",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Borrar" }));
  expect(confirmMock).toHaveBeenCalledWith(
    expect.objectContaining({
      description:
        "Si tiene viajes, documentos o rendiciones no se puede borrar: desactivalo.",
    }),
  );
});
