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
  allocFails: false,
  invoice: {} as Record<string, unknown>,
  channel: null as unknown,
  imputationsFail: false,
  pendingFails: false,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
// No segregated channel here: the record opens in the main app.
vi.mock("@/lib/scope-server", () => ({
  segregatedChannelIdOf: async () => null,
}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => h.channel,
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
        ...h.invoice,
      },
    }),
    getPurchaseInvoiceAllocationsAction: async () => {
      h.allocCalls += 1;
      return h.allocFails
        ? { ok: false, error: "No se pudieron leer las imputaciones." }
        : { ok: true, data: [] };
    },
    getPurchaseInvoiceOpenAction: async () => h.openRes,
    getPurchaseInvoiceItemsAction: async () => h.itemsRes,
  }),
);
vi.mock("@/features/purchase-invoices/actions/impute-remitos-actions", () => ({
  getPurchaseImputationsAction: async () =>
    h.imputationsFail
      ? { ok: false, error: "No se pudieron leer las imputaciones." }
      : { ok: true, data: { imputedTo: null, remitos: [] } },
}));
vi.mock("@/features/payment-orders/actions/payment-orders-actions", () => ({
  listPendingInvoicesForSupplierAction: async () =>
    h.pendingFails
      ? { ok: false, error: "No se pudo leer lo pendiente." }
      : { ok: true, data: h.pending },
}));
vi.mock("@/features/payment-orders/components/pay-dialog", () => ({
  PayDialog: ({ defaultOpen }: { defaultOpen?: boolean }) => (
    <button type="button">{`stub-pagar${defaultOpen ? " abierto" : ""}`}</button>
  ),
}));
vi.mock(
  "@/features/purchase-invoices/components/impute-remitos-dialog",
  () => ({
    ImputeRemitosDialog: () => <button type="button">stub-imputar</button>,
  }),
);
vi.mock("@/features/files/components/attachments-zone", () => ({
  AttachmentsZone: (props: { canWrite: boolean; canDelete: boolean }) => (
    <span>{`adjuntos write=${props.canWrite} delete=${props.canDelete}`}</span>
  ),
}));
vi.mock("@/features/audit/components/record-history", () => ({
  RecordHistory: () => <p>stub-historial</p>,
}));

const { default: PurchaseInvoiceDetailPage } = await import("./page");

async function renderPage(search: Record<string, string> = {}) {
  render(
    await PurchaseInvoiceDetailPage({
      params: Promise.resolve({ id: "pi-1" }),
      searchParams: Promise.resolve(search),
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
  h.allocFails = false;
  h.invoice = {};
  h.channel = {
    data: { id: "jouve_fiscal", name: "Jouve", is_fiscal: true },
    error: null,
  };
  h.imputationsFail = false;
  h.pendingFails = false;
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

  it("says the pending read failed instead of dropping Pagar without a word", async () => {
    h.pendingFails = true;
    await renderPage();
    expect(screen.queryByText("stub-pagar")).toBeNull();
    expect(
      screen.getByText(
        "No se pudo leer lo pendiente de pago: no se muestra «Pagar».",
      ),
    ).toBeTruthy();
  });

  it("does not offer Pagar, nor blame a failed read, when payment_orders:read is denied", async () => {
    h.access = resolveAccess(["finance"], ["payment_orders:read"]);
    h.pendingFails = true;
    await renderPage();
    expect(screen.queryByText("stub-pagar")).toBeNull();
    expect(screen.queryByText(/No se pudo leer lo pendiente/)).toBeNull();
  });
});

describe("purchase detail — Pagar from a task", () => {
  it("opens the payment order form with ?pagar=1 (a task's «Pagar»)", async () => {
    await renderPage({ pagar: "1" });
    expect(screen.getByText("stub-pagar abierto")).toBeTruthy();
  });

  it("keeps it closed without the parameter", async () => {
    await renderPage();
    expect(screen.getByText("stub-pagar")).toBeTruthy();
  });
});

describe("purchase detail — canal", () => {
  it("does not title the purchase from a guessed side when the channel read fails", async () => {
    h.channel = { data: null, error: { message: "boom" } };
    h.invoice = { channel_id: "jouve_internal", letter: null };
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Comprobante de compra",
    );
    expect(
      screen.getByText(
        "No se pudo leer el canal de la compra: no se muestran «Pagar» ni «Imputar remitos».",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("stub-pagar")).toBeNull();
  });

  it("titles an internal remito as such", async () => {
    h.channel = {
      data: { id: "jouve_internal", name: "Interno", is_fiscal: false },
      error: null,
    };
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Remito interno",
    );
  });
});

describe("purchase detail — Imputar remitos", () => {
  it("offers imputing remitos to a fiscal factura", async () => {
    await renderPage();
    expect(screen.getByText("stub-imputar")).toBeTruthy();
  });

  it("does not offer it against an unread imputation total", async () => {
    h.imputationsFail = true;
    await renderPage();
    expect(screen.queryByText("stub-imputar")).toBeNull();
    expect(
      screen.getByText("No se pudieron leer los remitos imputados."),
    ).toBeTruthy();
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

  it("keeps the measured figures and says only the OP list failed", async () => {
    h.allocFails = true;
    await renderPage();
    expect(rowValue("Saldo")).toContain("121,00");
    expect(
      screen.getByText("No se pudieron leer las órdenes de pago imputadas."),
    ).toBeTruthy();
  });

  it("leaves out «Pagado» and «Saldo» on a cancelled purchase", async () => {
    h.invoice = { status: "cancelled" };
    await renderPage();
    expect(rowValue("Pagado")).toBeNull();
    expect(rowValue("Saldo")).toBeNull();
  });

  it("leaves out «Pagado» and «Saldo» on a nota de crédito, which owes nothing", async () => {
    h.invoice = { kind: "nc" };
    await renderPage();
    expect(rowValue("Pagado")).toBeNull();
    expect(rowValue("Saldo")).toBeNull();
    expect(screen.queryByText("No se pudieron leer los pagos.")).toBeNull();
  });

  it("keeps them on a nota de débito, which is paid like a factura", async () => {
    h.invoice = { kind: "nd" };
    await renderPage();
    expect(rowValue("Saldo")).toContain("121,00");
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

describe("purchase detail — Historial", () => {
  it("shows the record's history only with audit:read", async () => {
    await renderPage();
    expect(screen.queryByText("stub-historial")).toBeNull();
    cleanup();
    h.access = resolveAccess(["owner"]);
    await renderPage();
    expect(screen.getByText("stub-historial")).toBeTruthy();
  });
});
