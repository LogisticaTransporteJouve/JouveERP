// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoicingChannelSummary } from "@/lib/scope";

// Editing a recibo keeps its client (the update does not take one): the
// client shows read-only, a failed read says so, and the allocations list
// the receipt's own client's documents either way.

const h = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/receipts",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/hooks/use-usd-rate-prefill", () => ({
  useUsdRatePrefill: () => {},
}));
vi.mock("@/features/clients/hooks/use-clients", () => ({
  useClientByIdOptional: () => h.client,
}));
vi.mock("@/features/invoices/components/client-picker", () => ({
  ClientPicker: (props: {
    value: { legal_name: string } | null;
    disabled?: boolean;
  }) => (
    <span>{`picker value=${props.value?.legal_name ?? "none"} disabled=${props.disabled ?? false}`}</span>
  ),
}));
vi.mock("../hooks/use-receipts", () => ({
  useCreateReceipt: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateReceipt: () => ({ mutate: vi.fn(), isPending: false }),
  useNextReceiptNumero: () => ({ next: null, isFirst: false }),
  useReceiptUsdRate: () => ({ data: undefined }),
}));
vi.mock("./allocations-picker", () => ({
  AllocationsPicker: (props: { clientId: string | null }) => (
    <span>{`allocations client=${props.clientId}`}</span>
  ),
}));
vi.mock("./payment-lines-editor", () => ({ PaymentLinesEditor: () => null }));
vi.mock("./retentions-editor", () => ({ RetentionsEditor: () => null }));

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { ReceiptForm } = await import("./receipt-form");

const FISCAL: InvoicingChannelSummary = {
  id: "jouve_fiscal",
  name: "Jouve",
  is_fiscal: true,
  is_active: true,
};

const RECEIPT = {
  receipt: {
    id: "r1",
    channel_id: "jouve_fiscal",
    punto_venta: 1,
    numero: 7,
    client_id: "client-1",
    receipt_date: "2026-11-01",
    total_amount: 100,
    currency: "ARS",
    cotizacion: null,
    notes: null,
    status: "issued",
  },
  payment_lines: [],
  allocations: [{ invoice_id: "inv-1", amount_applied: 100 }],
  rejected_check_allocations: [],
  retentions: [],
  checks_by_line: {},
};

function renderEdit() {
  render(
    <ScopeProvider channels={[FISCAL]} initialFiscalFilter="fiscal">
      <ReceiptForm
        mode="edit"
        channels={[FISCAL]}
        accounts={[]}
        receipt={RECEIPT as never}
        canEditRetentions
      />
    </ScopeProvider>,
  );
}

beforeEach(() => {
  h.refetch.mockReset();
  h.client = {
    data: {
      id: "client-1",
      legal_name: "ACME SA",
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

describe("ReceiptForm edit client", () => {
  it("shows the receipt's client read-only", () => {
    renderEdit();
    expect(screen.getByText("picker value=ACME SA disabled=true")).toBeTruthy();
    expect(screen.getByText("allocations client=client-1")).toBeTruthy();
  });

  it("says a failed client read with «Reintentar» and keeps the allocations", () => {
    h.client = { data: undefined, isError: true, refetch: h.refetch };
    renderEdit();
    expect(
      screen.getByText("No se pudo leer el cliente del recibo."),
    ).toBeTruthy();
    expect(screen.queryByText(/^picker/)).toBeNull();
    expect(screen.getByText("allocations client=client-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.refetch).toHaveBeenCalledOnce();
  });

  it("says so for a client read but not found, instead of loading forever", () => {
    h.client = {
      data: null,
      isSuccess: true,
      isError: false,
      refetch: h.refetch,
    };
    renderEdit();
    expect(
      screen.getByText("No se pudo leer el cliente del recibo."),
    ).toBeTruthy();
    expect(screen.getByText("allocations client=client-1")).toBeTruthy();
  });
});
