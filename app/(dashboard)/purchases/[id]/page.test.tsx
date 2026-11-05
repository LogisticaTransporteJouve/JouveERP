// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, resolveAccess } from "@/lib/auth/permissions";

const h = vi.hoisted(() => ({
  access: null as Access | null,
  pending: [] as { id: string; outstanding: number }[],
  openRes: null as unknown,
  itemsRes: null as unknown,
  allocCalls: 0,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "jouve_fiscal", name: "Jouve", is_fiscal: true },
          }),
        }),
      }),
    }),
  }),
}));
vi.mock(
  "@/features/purchase-invoices/actions/purchase-invoices-actions",
  () => ({
    getPurchaseInvoiceByIdAction: async () => ({
      ok: true,
      data: {
        id: "pi-1",
        kind: "factura",
        letter: "A",
        punto_venta: 2,
        numero: 15,
        status: "registered",
        fecha: "2026-11-01",
        channel_id: "jouve_fiscal",
        moneda: "PES",
        supplier_id: "s1",
        supplier_legal_name: "Proveedor SA",
        supplier_cuit: "30712345678",
        imp_neto: 100,
        imp_iva: 21,
        imp_trib: 0,
        imp_total: 121,
        amount_breakdown: null,
        cae_proveedor: null,
        cae_vto_proveedor: null,
        fch_vto_pago: null,
        motivo_nc_nd: null,
        notes: null,
      },
    }),
    getPurchaseInvoiceAllocationsAction: async () => {
      h.allocCalls += 1;
      return { ok: true, data: [] };
    },
    getPurchaseInvoiceOpenAction: async () => h.openRes,
    getPurchaseInvoiceItemsAction: async () => h.itemsRes,
  }),
);
vi.mock("@/features/purchase-invoices/actions/impute-remitos-actions", () => ({
  getPurchaseImputationsAction: async () => ({
    ok: true,
    data: { imputedTo: null, remitos: [] },
  }),
}));
vi.mock("@/features/payment-orders/actions/payment-orders-actions", () => ({
  listPendingInvoicesForSupplierAction: async () => ({
    ok: true,
    data: h.pending,
  }),
}));
vi.mock("@/features/payment-orders/components/pay-dialog", () => ({
  PayDialog: () => <button type="button">stub-pagar</button>,
}));
vi.mock(
  "@/features/purchase-invoices/components/impute-remitos-dialog",
  () => ({ ImputeRemitosDialog: () => null }),
);
vi.mock("@/features/files/components/attachments-zone", () => ({
  AttachmentsZone: (props: { canWrite: boolean; canDelete: boolean }) => (
    <span>{`adjuntos write=${props.canWrite} delete=${props.canDelete}`}</span>
  ),
}));

const { default: PurchaseInvoiceDetailPage } = await import("./page");

async function renderPage() {
  render(
    await PurchaseInvoiceDetailPage({
      params: Promise.resolve({ id: "pi-1" }),
    }),
  );
}

beforeEach(() => {
  h.access = resolveAccess(["finance"]);
  h.pending = [{ id: "pi-1", outstanding: 121 }];
  h.openRes = {
    ok: true,
    data: { paid: 0, credited: 0, opening_applied: 0, open_amount: 121 },
  };
  h.itemsRes = { ok: true, data: [] };
  h.allocCalls = 0;
});

function rowValue(label: string): string | null {
  const dt = screen.queryByText(label, { selector: "dt" });
  return dt?.nextElementSibling?.textContent ?? null;
}
afterEach(cleanup);

describe("purchase detail — Pagar", () => {
  it("offers Pagar for what the purchase still owes", async () => {
    await renderPage();
    expect(screen.getByText("stub-pagar")).toBeTruthy();
  });

  it("hides Pagar when accounts:read is denied, since its lines pick an account", async () => {
    h.access = resolveAccess(["finance"], ["accounts:read"]);
    await renderPage();
    expect(screen.queryByText("stub-pagar")).toBeNull();
  });
});

describe("purchase detail — Adjuntos", () => {
  it("offers attaching and «Eliminar» with files:write and purchase_invoices:write", async () => {
    await renderPage();
    expect(screen.getByText("adjuntos write=true delete=true")).toBeTruthy();
  });

  it("offers neither when purchase_invoices:write is denied", async () => {
    h.access = resolveAccess(["admin"], ["purchase_invoices:write"]);
    await renderPage();
    expect(screen.getByText("adjuntos write=false delete=false")).toBeTruthy();
  });
});

describe("purchase detail — Pagado y Saldo", () => {
  it("takes «Saldo» from the open amount, so a fiscal NC and the opening balance count", async () => {
    h.openRes = {
      ok: true,
      data: { paid: 21, credited: 60, opening_applied: 10, open_amount: 30 },
    };
    await renderPage();
    expect(rowValue("Pagado")).toContain("21,00");
    expect(rowValue("Acreditado")).toContain("60,00");
    expect(rowValue("Saldo inicial aplicado")).toContain("10,00");
    expect(rowValue("Saldo")).toContain("30,00");
  });

  it("shows «—» and says so when the payments read fails, not $0 paid", async () => {
    h.openRes = { ok: false, error: "No se pudieron leer los pagos." };
    await renderPage();
    expect(rowValue("Pagado")).toBe("—");
    expect(rowValue("Saldo")).toBe("—");
    expect(screen.getByText("No se pudieron leer los pagos.")).toBeTruthy();
  });

  it("leaves out «Pagado» and «Saldo» for a role that cannot read OPs", async () => {
    h.access = resolveAccess(["fiscal_reader"]);
    await renderPage();
    expect(rowValue("Pagado")).toBeNull();
    expect(rowValue("Saldo")).toBeNull();
    expect(h.allocCalls).toBe(0);
  });
});

describe("purchase detail — Ítems", () => {
  it("says the items could not be read instead of «cargada solo por totales»", async () => {
    h.itemsRes = { ok: false, error: "No se pudieron leer los ítems." };
    await renderPage();
    expect(screen.getByText("No se pudieron leer los ítems.")).toBeTruthy();
    expect(
      screen.queryByText("Sin detalle (cargada solo por totales)"),
    ).toBeNull();
  });

  it("keeps «cargada solo por totales» for a purchase read with no items", async () => {
    await renderPage();
    expect(
      screen.getByText("Sin detalle (cargada solo por totales)"),
    ).toBeTruthy();
  });
});
