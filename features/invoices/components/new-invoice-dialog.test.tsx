// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoicingChannelSummary } from "@/lib/scope";

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  pos: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/invoices",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("../hooks/use-invoices", () => ({
  useEnabledPos: () => h.pos,
  useInvoiceDetailOnDemand: () => ({ data: undefined }),
  useIssueFiscalInvoice: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock("./client-picker", () => ({ ClientPicker: () => null }));
vi.mock("./origin-picker", () => ({ OriginPicker: () => null }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { NewInvoiceDialog } = await import("./new-invoice-dialog");

const FISCAL: InvoicingChannelSummary = {
  id: "jouve_fiscal",
  name: "Jouve",
  is_fiscal: true,
  is_active: true,
};

const CLIENT = {
  id: "client-1",
  legal_name: "ACME SA",
  display_name: null,
  cuit: "30712345678",
  iva_condition: "responsable_inscripto" as const,
  is_fiscal: true,
};

function open() {
  render(
    <ScopeProvider channels={[FISCAL]} initialFiscalFilter="fiscal">
      <NewInvoiceDialog channels={[FISCAL]} initialClient={CLIENT} />
    </ScopeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Nuevo/ }));
}

function field(label: string): HTMLInputElement {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

async function savedItems(): Promise<
  Array<{ quantity: number; unit_price: number }>
> {
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
  return h.mutate.mock.calls[0]?.[0]?.items;
}

beforeEach(() => {
  h.mutate.mockReset();
  h.toast.error.mockReset();
  h.pos = {
    data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
    isSuccess: true,
    isError: false,
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe("NewInvoiceDialog item amounts", () => {
  it.each([
    ["15.000", "15.000", 15000],
    ["1.500,50", "1.500,50", 1500.5],
    ["1500,5", "1.500,5", 1500.5],
  ])("reads a typed price %s as es-AR (%s → %s)", async (typed, shown, n) => {
    open();
    fireEvent.change(field("Descripción"), { target: { value: "Flete" } });
    fireEvent.change(field("Precio unitario"), { target: { value: typed } });
    expect(field("Precio unitario").value).toBe(shown);
    const items = await savedItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 1, unit_price: n });
  });

  it.each([
    ["15.000", 15000],
    ["1500.50", 1500.5],
    ["15.5", 15.5],
  ])("typing %s key by key saves %s", async (keys, n) => {
    open();
    fireEvent.change(field("Descripción"), { target: { value: "Flete" } });
    const price = field("Precio unitario");
    for (const key of keys) {
      fireEvent.change(price, { target: { value: price.value + key } });
    }
    fireEvent.blur(price);
    const items = await savedItems();
    expect(items[0]).toMatchObject({ unit_price: n });
  });

  it("reads a typed quantity as es-AR, up to the column's 4 decimals", async () => {
    open();
    fireEvent.change(field("Descripción"), { target: { value: "Flete" } });
    fireEvent.change(field("Cantidad"), { target: { value: "1.250,12345" } });
    expect(field("Cantidad").value).toBe("1.250,1234");
    fireEvent.change(field("Precio unitario"), { target: { value: "10" } });
    const items = await savedItems();
    expect(items[0]).toMatchObject({ quantity: 1250.1234, unit_price: 10 });
  });

  it("bills the Seguro line at 1 % of the declared value typed in es-AR", async () => {
    open();
    fireEvent.change(field("Descripción"), { target: { value: "Flete" } });
    fireEvent.change(field("Precio unitario"), { target: { value: "100" } });
    fireEvent.change(field("Valor declarado"), {
      target: { value: "2.000.000" },
    });
    const items = await savedItems();
    expect(items[1]).toMatchObject({ quantity: 0.01, unit_price: 2_000_000 });
  });
});

describe("NewInvoiceDialog puntos de venta read", () => {
  it("says a failed read and retries it, instead of hiding the field", () => {
    const refetch = vi.fn();
    h.pos = { data: undefined, isSuccess: false, isError: true, refetch };
    open();
    expect(
      screen.getByText("No se pudieron cargar los puntos de venta."),
    ).toBeTruthy();
    expect(screen.queryByText(/Sin POS habilitados/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("keeps «Sin POS habilitados» for a channel read with none", () => {
    h.pos = { data: [], isSuccess: true, isError: false };
    open();
    expect(screen.getByText(/Sin POS habilitados/)).toBeTruthy();
    expect(
      screen.queryByText("No se pudieron cargar los puntos de venta."),
    ).toBeNull();
  });
});
