// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/dialog";
import type { InvoicingChannelSummary } from "@/lib/scope";

import { arcaVoucherToDraft } from "../lib/arca-received-draft";
import type { PurchaseInvoiceDraft } from "../lib/purchase-invoice-draft";
import type { ReceivedVoucher } from "../schema";

// Accepting an ARCA voucher shows what ARCA informed as a summary and only
// the imputación as inputs, and still saves the voucher's own values.

const h = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/purchases/arca",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/files/hooks/use-attachments", () => ({
  fetchSignedUrl: vi.fn(),
}));
vi.mock("../hooks/use-purchase-invoices", () => ({
  usePurchaseInvoiceByIdOptional: () => ({ data: undefined, isError: false }),
  usePurchaseInvoiceItems: () => ({ data: undefined, isError: false }),
  useCreatePurchaseInvoice: () => ({ mutate: h.mutate, isPending: false }),
  useNextInternalPurchaseNumero: () => ({ data: undefined, error: null }),
  usePurchaseInvoiceDuplicate: () => ({ data: null }),
  useUpdatePurchaseInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/suppliers/hooks/use-suppliers", () => ({
  useSupplierByIdOptional: () => ({ data: null, isFetching: false }),
}));
vi.mock("@/features/suppliers/components/supplier-picker", () => ({
  SupplierPicker: ({ value }: { value: { legal_name: string } | null }) => (
    <span>{value?.legal_name ?? "Sin proveedor"}</span>
  ),
}));
vi.mock("@/features/cost-centers/hooks/use-cost-centers", () => ({
  useCostTagOptions: () => ({
    data: { expenseAccounts: [], costCenters: [], inactiveCostCenters: [] },
    isPending: false,
  }),
}));
vi.mock("@/features/hr/hooks/use-employees", () => ({
  useEmployeeOptions: () => ({ data: [], isError: false }),
}));

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { PurchaseInvoiceDraftDialogContent } =
  await import("./purchase-invoice-draft-dialog");

afterEach(() => {
  cleanup();
  h.mutate.mockReset();
});

const FISCAL: InvoicingChannelSummary = {
  id: "jouve_fiscal",
  name: "Jouve",
  is_fiscal: true,
  is_active: true,
};

const voucher: ReceivedVoucher = {
  id: "v1",
  issuer_cuit: "30712345678",
  issuer_name: "Gomería Sur SRL",
  cbte_tipo: 1,
  kind: "factura",
  letter: "A",
  punto_venta: 44,
  numero: 10,
  fecha: "2026-10-20",
  cae: "76123456789012",
  moneda: "PES",
  cotizacion: null,
  imp_neto_gravado: 1000,
  imp_no_gravado: 50,
  imp_op_exentas: 0,
  imp_iva: 210,
  imp_trib: 0,
  imp_total: 1260,
  trib_breakdown: {},
  iva_breakdown: [],
  status: "pending_review",
  discard_reason: null,
  purchase: null,
  supplier: {
    id: "s1",
    legal_name: "Gomería Sur SRL",
    display_name: null,
    cuit: "30712345678",
    iva_condition: "responsable_inscripto",
  },
};

function renderAccept() {
  const draft: PurchaseInvoiceDraft = {
    origin: "arca",
    data: arcaVoucherToDraft(voucher),
    source: null,
    submitCreate: vi.fn(),
  };
  render(
    <ScopeProvider channels={[FISCAL]} initialFiscalFilter="fiscal">
      <Dialog open>
        <PurchaseInvoiceDraftDialogContent
          draft={draft}
          onCreated={() => {}}
          onClose={() => {}}
        />
      </Dialog>
    </ScopeProvider>,
  );
}

describe("PurchaseInvoiceForm accepting an ARCA voucher", () => {
  it("shows the voucher as a summary and only the imputación as inputs", () => {
    renderAccept();
    const summary = screen.getByRole("region", { name: "Comprobante" });
    const s = within(summary);
    expect(s.getByText("Gomería Sur SRL")).toBeTruthy();
    expect(summary.textContent).toContain("Factura A00044-00000010");
    expect(s.getByText("76123456789012")).toBeTruthy();
    expect(s.getByText("$ 1.000,00")).toBeTruthy();
    expect(s.getByText("$ 50,00")).toBeTruthy();
    expect(s.getByText("$ 210,00")).toBeTruthy();
    expect(s.getByText("$ 1.260,00")).toBeTruthy();
    expect(
      s.getByText(
        "Se guarda con una línea por alícuota, con los importes de ARCA:",
      ),
    ).toBeTruthy();
    // No identity or amount inputs, and no empty Vto. CAE.
    expect(summary.querySelector("input, textarea")).toBeNull();
    for (const label of [
      "Tipo",
      "Letra",
      "Punto de venta",
      "Número",
      "Fecha",
      "Neto",
      "Total",
      "Moneda",
      "CAE proveedor (opcional)",
      "Vto. CAE proveedor",
    ]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }

    const imputacion = screen.getByRole("region", { name: "Imputación" });
    const i = within(imputacion);
    for (const label of [
      "Canal",
      "Vencimiento de pago",
      "Cuenta de gasto",
      "Centro de costo",
      "A cargo de empleado",
      "Notas",
    ]) {
      expect(i.getByLabelText(label)).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: "Aceptar comprobante" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cargar factura" })).toBeNull();
  });

  it("saves the voucher's identity and amounts as ARCA informed them", async () => {
    renderAccept();
    fireEvent.click(
      screen.getByRole("button", { name: "Aceptar comprobante" }),
    );
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(h.mutate.mock.calls[0]?.[0]).toMatchObject({
      supplier_id: "s1",
      channel_id: "jouve_fiscal",
      kind: "factura",
      letter: "A",
      punto_venta: 44,
      numero: 10,
      fecha: "2026-10-20",
      imp_neto: 1000,
      imp_no_gravado: 50,
      imp_op_exentas: 0,
      imp_iva: 210,
      imp_trib: 0,
      imp_total: 1260,
      moneda: "PES",
      cotizacion: 1,
      cae_proveedor: "76123456789012",
      cae_vto_proveedor: null,
    });
  });
});
