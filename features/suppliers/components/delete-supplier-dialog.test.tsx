// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Supplier } from "../schema";

const h = vi.hoisted(() => ({
  refs: {
    data: undefined as unknown,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-suppliers", () => ({
  useSupplierReferences: () => h.refs,
  useSetSupplierActive: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSupplier: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { DeleteSupplierDialog } = await import("./delete-supplier-dialog");

afterEach(cleanup);

// The dialog reads only these fields.
const supplier = {
  id: "c1",
  legal_name: "Proveedor S.A.",
  cuit: null,
  is_active: true,
} satisfies Partial<Supplier> as Supplier;

describe("DeleteSupplierDialog", () => {
  it("shows a failed references read with «Reintentar», not an endless check", () => {
    render(<DeleteSupplierDialog supplier={supplier} />);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(
      screen.getByText("No se pudo verificar si tiene movimientos asociados."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Verificando si tiene movimientos asociados…"),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Desactivar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.refs.refetch).toHaveBeenCalled();
  });
});
