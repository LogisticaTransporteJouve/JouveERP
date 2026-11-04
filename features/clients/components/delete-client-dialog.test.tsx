// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Client } from "../schema";

const h = vi.hoisted(() => ({
  refs: {
    data: undefined as unknown,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-clients", () => ({
  useClientReferences: () => h.refs,
  useSetClientActive: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteClient: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { DeleteClientDialog } = await import("./delete-client-dialog");

afterEach(cleanup);

// The dialog reads only these fields.
const client = {
  id: "c1",
  legal_name: "Acme S.A.",
  cuit: null,
  is_active: true,
} satisfies Partial<Client> as Client;

describe("DeleteClientDialog", () => {
  it("shows a failed references read with «Reintentar», not an endless check", () => {
    render(<DeleteClientDialog client={client} />);
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
