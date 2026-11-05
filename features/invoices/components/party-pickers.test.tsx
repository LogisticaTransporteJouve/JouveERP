// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The client, supplier and NC/ND-origin pickers: a disabled picker shows the
// picked party with no way to change it; a failed search says so with
// «Reintentar» instead of inviting a duplicate; «Nuevo» shows only to who can
// create; a user who cannot read the parties is told so.

type Access = { canRead: boolean; canCreate: boolean } | undefined;
type Search = {
  data: undefined;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
};

const h = vi.hoisted(() => ({
  clientAccess: undefined as Access,
  supplierAccess: undefined as Access,
  search: {} as Search,
  refetch: vi.fn(),
  getClientById: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: h.toastError } }));
vi.mock("@/features/clients/actions/clients-actions", () => ({
  getClientByIdAction: h.getClientById,
}));
vi.mock("@/features/clients/components/client-form", () => ({
  ClientForm: ({ onSuccess }: { onSuccess: (id: string) => void }) => (
    <button type="button" onClick={() => onSuccess("new-client")}>
      stub-guardar
    </button>
  ),
}));
vi.mock("@/features/clients/hooks/use-clients", () => ({
  useClientsSearch: () => h.search,
  useClientPickerAccess: () => h.clientAccess,
}));
vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({
  getSupplierByIdAction: vi.fn(),
}));
vi.mock("@/features/suppliers/components/supplier-form", () => ({
  SupplierForm: () => null,
}));
vi.mock("@/features/suppliers/hooks/use-suppliers", () => ({
  useSuppliersSearch: () => h.search,
  useSupplierPickerAccess: () => h.supplierAccess,
}));
vi.mock("../hooks/use-invoices", () => ({
  useOriginSearch: () => h.search,
}));

const { ClientPicker } = await import("./client-picker");
const { OriginPicker } = await import("./origin-picker");
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
const FULL = { canRead: true, canCreate: true };

beforeEach(() => {
  h.clientAccess = FULL;
  h.supplierAccess = FULL;
  h.refetch.mockReset();
  h.getClientById.mockReset();
  h.toastError.mockReset();
  h.search = {
    data: undefined,
    isFetching: false,
    isError: false,
    refetch: h.refetch,
  };
});
afterEach(cleanup);

const openSearch = () => fireEvent.focus(screen.getByRole("textbox"));

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

describe("a failed search", () => {
  it.each([
    [
      "ClientPicker",
      () => <ClientPicker value={null} onChange={() => {}} isFiscal />,
      "No se pudieron buscar los clientes.",
    ],
    [
      "SupplierPicker",
      () => <SupplierPicker value={null} onChange={() => {}} isFiscal />,
      "No se pudieron buscar los proveedores.",
    ],
    [
      "OriginPicker",
      () => <OriginPicker value={null} onChange={() => {}} />,
      "No se pudieron buscar las facturas.",
    ],
  ])(
    "%s says so with «Reintentar», not «Sin resultados»",
    (_name, picker, message) => {
      h.search = { ...h.search, isError: true };
      render(picker());
      openSearch();
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByText(/Sin resultados|No hay resultados/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
      expect(h.refetch).toHaveBeenCalledOnce();
    },
  );
});

describe("«Nuevo» and the read permission", () => {
  it("«Nuevo» shows only to who can create the party", () => {
    render(<ClientPicker value={null} onChange={() => {}} isFiscal />);
    expect(screen.getByRole("button", { name: "Nuevo cliente" })).toBeTruthy();
    cleanup();
    h.clientAccess = { canRead: true, canCreate: false };
    render(<ClientPicker value={null} onChange={() => {}} isFiscal />);
    expect(screen.queryByRole("button", { name: "Nuevo cliente" })).toBeNull();
    openSearch();
    expect(screen.getByText("Empezá a tipear para buscar.")).toBeTruthy();
  });

  it("«Nuevo proveedor» and the suggested one show only to who can create", () => {
    const suggested = { legal_name: "Nuevo SA", cuit: null };
    h.supplierAccess = { canRead: true, canCreate: false };
    render(
      <SupplierPicker
        value={null}
        onChange={() => {}}
        isFiscal
        suggestedNew={suggested}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Nuevo proveedor" }),
    ).toBeNull();
    expect(screen.queryByText(/Crear proveedor/)).toBeNull();
    expect(
      screen.getByText("El proveedor del comprobante todavía no está cargado."),
    ).toBeTruthy();
  });

  it("no «Nuevo» while the access is still unknown", () => {
    h.clientAccess = undefined;
    render(<ClientPicker value={null} onChange={() => {}} isFiscal />);
    expect(screen.queryByRole("button", { name: "Nuevo cliente" })).toBeNull();
  });

  it("a user who cannot read clients is told so, with no search", () => {
    h.clientAccess = { canRead: false, canCreate: false };
    render(<ClientPicker value={null} onChange={() => {}} isFiscal disabled />);
    expect(
      screen.getByText("No tenés permiso para ver clientes."),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reintentar/ })).toBeNull();
  });

  it("a user who cannot read suppliers is told so, with no search", () => {
    h.supplierAccess = { canRead: false, canCreate: false };
    render(<SupplierPicker value={null} onChange={() => {}} isFiscal />);
    expect(
      screen.getByText("No tenés permiso para ver proveedores."),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("creating from the picker", () => {
  it("picks the created client", async () => {
    const onChange = vi.fn();
    h.getClientById.mockResolvedValue({
      ok: true,
      data: { ...PARTY, id: "new-client" },
    });
    render(<ClientPicker value={null} onChange={onChange} isFiscal />);
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    fireEvent.click(screen.getByText("stub-guardar"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: "new-client" }),
      ),
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("says why when the created client cannot be read back", async () => {
    const onChange = vi.fn();
    h.getClientById.mockResolvedValue({
      ok: false,
      error: "No tenés permiso para ver clientes.",
    });
    render(<ClientPicker value={null} onChange={onChange} isFiscal />);
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    fireEvent.click(screen.getByText("stub-guardar"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "El cliente se creó, pero no se pudo elegir: buscalo y elegilo.",
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
