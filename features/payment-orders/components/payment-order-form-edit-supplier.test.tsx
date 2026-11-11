// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoicingChannelSummary } from "@/lib/scope";

// Editing an orden de pago keeps its supplier (the update does not take
// one): the supplier shows read-only, a failed read says so, and the
// allocations list the order's own supplier's facturas either way.

const h = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  refetch: vi.fn(),
  access: undefined as { canRead: boolean; canCreate: boolean } | undefined,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/payment-orders",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/hooks/use-usd-rate-prefill", () => ({
  useUsdRatePrefill: () => {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/features/checks/actions/checks-actions", () => ({
  listEnCarteraChecksAction: vi.fn(),
}));
vi.mock("@/features/suppliers/hooks/use-suppliers", () => ({
  useSupplierByIdOptional: () => h.client,
  useSupplierPickerAccess: () => h.access,
}));
vi.mock("@/features/suppliers/components/supplier-picker", () => ({
  SupplierPicker: (props: {
    value: { legal_name: string } | null;
    disabled?: boolean;
  }) => (
    <span>{`picker value=${props.value?.legal_name ?? "none"} disabled=${props.disabled ?? false}`}</span>
  ),
}));
vi.mock("../hooks/use-payment-orders", () => ({
  useCreatePaymentOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePaymentOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useNextPaymentOrderNumero: () => ({ next: null, isFirst: false }),
  usePaymentOrderUsdRate: () => ({ data: undefined }),
}));
vi.mock("./allocations-picker", () => ({
  AllocationsPicker: (props: { supplierId: string | null }) => (
    <span>{`allocations supplier=${props.supplierId}`}</span>
  ),
}));
vi.mock("./payment-lines-editor", () => ({ PaymentLinesEditor: () => null }));

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { PaymentOrderForm } = await import("./payment-order-form");

const FISCAL: InvoicingChannelSummary = {
  id: "jouve_fiscal",
  name: "Jouve",
  is_fiscal: true,
  is_active: true,
};

const PAYMENT_ORDER = {
  paymentOrder: {
    id: "po1",
    channel_id: "jouve_fiscal",
    punto_venta: 1,
    numero: 7,
    supplier_id: "supplier-1",
    supplier_legal_name: "Proveedor SA",
    supplier_cuit: "30712345678",
    payment_date: "2026-11-01",
    total_amount: 100,
    currency: "ARS",
    cotizacion: null,
    notes: null,
    status: "issued",
  },
  payment_lines: [],
  allocations: [{ purchase_invoice_id: "pi-1", amount_applied: 100 }],
  rejected_check_allocations: [],
};

function renderEdit() {
  render(
    <ScopeProvider channels={[FISCAL]} initialFiscalFilter="fiscal">
      <PaymentOrderForm
        mode="edit"
        accounts={[]}
        paymentOrder={PAYMENT_ORDER as never}
      />
    </ScopeProvider>,
  );
}

beforeEach(() => {
  h.access = { canRead: true, canCreate: true };
  h.refetch.mockReset();
  h.client = {
    data: {
      id: "supplier-1",
      legal_name: "Proveedor SA",
      display_name: null,
      cuit: "30712345678",
      iva_condition: "responsable_inscripto",
      is_fiscal: true,
    },
    isSuccess: true,
    isError: false,
    refetch: h.refetch,
  };
});
afterEach(cleanup);

describe("PaymentOrderForm edit supplier", () => {
  it("shows the order's supplier read-only", () => {
    renderEdit();
    expect(
      screen.getByText("picker value=Proveedor SA disabled=true"),
    ).toBeTruthy();
    expect(screen.getByText("allocations supplier=supplier-1")).toBeTruthy();
  });

  it("says a failed supplier read with «Reintentar» and keeps the allocations", () => {
    h.client = { data: undefined, isError: true, refetch: h.refetch };
    renderEdit();
    expect(
      screen.getByText("No se pudo leer el proveedor de la orden de pago."),
    ).toBeTruthy();
    expect(screen.queryByText(/^picker/)).toBeNull();
    expect(screen.getByText("allocations supplier=supplier-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.refetch).toHaveBeenCalledOnce();
  });

  it("a user denied suppliers:read gets the picker, not a «Reintentar» that cannot work", () => {
    h.access = { canRead: false, canCreate: false };
    h.client = { data: undefined, isError: true, refetch: h.refetch };
    renderEdit();
    expect(
      screen.queryByText("No se pudo leer el proveedor de la orden de pago."),
    ).toBeNull();
    expect(screen.getByText("picker value=none disabled=true")).toBeTruthy();
    expect(screen.getByText("allocations supplier=supplier-1")).toBeTruthy();
  });
});
