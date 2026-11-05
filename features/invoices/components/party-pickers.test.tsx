// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A disabled picker shows the picked party with no way to change it: an edit
// whose update ignores the party.

vi.mock("@/features/clients/actions/clients-actions", () => ({
  getClientByIdAction: vi.fn(),
}));
vi.mock("@/features/clients/components/client-form", () => ({
  ClientForm: () => null,
}));
vi.mock("@/features/clients/hooks/use-clients", () => ({
  useClientsSearch: () => ({ data: undefined, isFetching: false }),
}));
vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({
  getSupplierByIdAction: vi.fn(),
}));
vi.mock("@/features/suppliers/components/supplier-form", () => ({
  SupplierForm: () => null,
}));
vi.mock("@/features/suppliers/hooks/use-suppliers", () => ({
  useSuppliersSearch: () => ({ data: undefined, isFetching: false }),
}));

const { ClientPicker } = await import("./client-picker");
const { SupplierPicker } =
  await import("@/features/suppliers/components/supplier-picker");

const PARTY = {
  id: "p1",
  legal_name: "ACME SA",
  display_name: null,
  cuit: "30712345678",
  iva_condition: "responsable_inscripto" as const,
  is_fiscal: true,
};

afterEach(cleanup);

describe("disabled pickers", () => {
  it("ClientPicker offers «Cambiar cliente» only when enabled", () => {
    render(<ClientPicker value={PARTY} onChange={() => {}} isFiscal />);
    expect(
      screen.getByRole("button", { name: "Cambiar cliente" }),
    ).toBeTruthy();
    cleanup();
    render(
      <ClientPicker value={PARTY} onChange={() => {}} isFiscal disabled />,
    );
    expect(screen.getByText("ACME SA")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cambiar cliente" }),
    ).toBeNull();
  });

  it("SupplierPicker offers «Cambiar proveedor» only when enabled", () => {
    render(<SupplierPicker value={PARTY} onChange={() => {}} isFiscal />);
    expect(
      screen.getByRole("button", { name: "Cambiar proveedor" }),
    ).toBeTruthy();
    cleanup();
    render(
      <SupplierPicker value={PARTY} onChange={() => {}} isFiscal disabled />,
    );
    expect(screen.getByText("ACME SA")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cambiar proveedor" }),
    ).toBeNull();
  });

  it("a disabled picker with nothing picked yet offers no search", () => {
    render(<ClientPicker value={null} onChange={() => {}} isFiscal disabled />);
    expect(screen.getByText("Cargando…")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
