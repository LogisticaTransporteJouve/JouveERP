// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Client } from "../schema";

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
vi.mock("../hooks/use-clients", () => ({
  useClientReferences: () => h.refs,
  useSetClientActive: () => ({ mutate: h.setActive, isPending: false }),
  useDeleteClient: () => ({ mutate: h.remove, isPending: false }),
}));

const { DeactivateClientDialog, ReactivateClientButton } =
  await import("./deactivate-client-dialog");

afterEach(() => {
  cleanup();
  h.setActive.mockReset();
  h.remove.mockReset();
  h.refs.data = undefined;
  h.refs.isError = false;
});

// The dialog reads only these fields.
const client = {
  id: "c1",
  legal_name: "Acme S.A.",
  cuit: null,
  is_active: true,
} satisfies Partial<Client> as Client;

function openDialog() {
  render(<DeactivateClientDialog client={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
}

describe("DeactivateClientDialog", () => {
  it("deactivates even while the references read failed", () => {
    h.refs.isError = true;
    openDialog();
    expect(
      screen.getByText("No se pudo verificar si tiene movimientos asociados."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Eliminar definitivamente" }),
    ).toBeNull();
    const buttons = screen.getAllByRole("button", { name: "Desactivar" });
    fireEvent.click(buttons[buttons.length - 1]);
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

describe("ReactivateClientButton", () => {
  it("sets the cliente active again", () => {
    render(<ReactivateClientButton client={{ ...client, is_active: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivar" }));
    expect(h.setActive).toHaveBeenCalledWith(
      { id: "c1", is_active: true },
      expect.anything(),
    );
  });
});
