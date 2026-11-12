// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Supplier } from "../schema";

const h = vi.hoisted(() => ({
  refs: {
    data: undefined as { total: number } | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  setActive: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-suppliers", () => ({
  useSupplierReferences: () => h.refs,
  useSetSupplierActive: () => ({ mutate: h.setActive, isPending: false }),
  useDeleteSupplier: () => ({ mutate: h.remove, isPending: false }),
}));

const { DeactivateSupplierDialog, ReactivateSupplierButton } =
  await import("./deactivate-supplier-dialog");

afterEach(() => {
  cleanup();
  h.setActive.mockReset();
  h.remove.mockReset();
  h.refs.data = undefined;
  h.refs.isError = false;
});

// The dialog reads only these fields.
const supplier = {
  id: "c1",
  legal_name: "Acme S.A.",
  cuit: null,
  is_active: true,
} satisfies Partial<Supplier> as Supplier;

function openDialog() {
  render(<DeactivateSupplierDialog supplier={supplier} />);
  fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
}

describe("DeactivateSupplierDialog", () => {
  it("deactivates even while the references read failed", () => {
    h.refs.isError = true;
    openDialog();
    expect(
      screen.getByText("No se pudo verificar si tiene movimientos asociados."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Eliminar definitivamente" }),
    ).toBeNull();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Desactivar",
      }),
    );
    expect(h.setActive).toHaveBeenCalledWith(
      { id: "c1", is_active: false },
      expect.anything(),
    );
  });

  it("offers deleting for good only without movements", () => {
    h.refs.data = { total: 0 };
    openDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Eliminar definitivamente" }),
    );
    expect(h.remove).toHaveBeenCalledWith("c1", expect.anything());
  });

  it("hides deleting for good when it has movements", () => {
    h.refs.data = { total: 3 };
    openDialog();
    expect(
      screen.queryByRole("button", { name: "Eliminar definitivamente" }),
    ).toBeNull();
  });
});

describe("ReactivateSupplierButton", () => {
  it("sets the proveedor active again", () => {
    render(
      <ReactivateSupplierButton supplier={{ ...supplier, is_active: false }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reactivar" }));
    expect(h.setActive).toHaveBeenCalledWith(
      { id: "c1", is_active: true },
      expect.anything(),
    );
  });
});
