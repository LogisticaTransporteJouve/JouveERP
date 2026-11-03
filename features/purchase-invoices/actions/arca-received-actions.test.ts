import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRole, resolveAccess } from "@/lib/auth/permissions";

const VOUCHER_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "jouve_fiscal";

let roles: string[] = ["finance"];
let voucherRow: Record<string, unknown> | null;
let linkMakesConfirmed = false;
let cancelledCount = 0;
let claimWins = true;
const writes: string[] = [];

function row(over: Record<string, unknown> = {}) {
  return {
    id: VOUCHER_ID,
    issuer_cuit: "30711111118",
    issuer_name: "Proveedor SA",
    cbte_tipo: 1,
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 120,
    fecha: "2026-09-10",
    cae: null,
    moneda: "PES",
    cotizacion: null,
    imp_neto_gravado: 1000,
    imp_no_gravado: 0,
    imp_op_exentas: 50,
    imp_iva: 210,
    imp_trib: 30,
    imp_total: 1290,
    trib_breakdown: {},
    iva_breakdown: [],
    status: "pending_review",
    discard_reason: null,
    purchase_invoice_id: null,
    purchase_invoices: null,
    ...over,
  };
}

function builder(table: string) {
  let op: "select" | "update" = "select";
  let head = false;
  const b = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      head = opts?.head ?? false;
      return b;
    },
    update: () => {
      op = "update";
      writes.push(`update:${table}`);
      return b;
    },
    eq: () => b,
    in: () => b,
    is: () => b,
    or: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: async () => {
      if (table === "arca_received_vouchers" && op === "select") {
        return { data: voucherRow, error: null };
      }
      if (table === "arca_received_vouchers" && op === "update") {
        return { data: claimWins ? { id: VOUCHER_ID } : null, error: null };
      }
      if (table === "suppliers")
        return { data: { cuit: "30711111118" }, error: null };
      if (table === "invoicing_channels")
        return { data: { is_fiscal: true }, error: null };
      return { data: null, error: null };
    },
    then: (resolve: (v: unknown) => void) => {
      if (table === "purchase_invoices" && head) {
        return resolve({ count: cancelledCount, error: null });
      }
      if (table === "suppliers") {
        return resolve({
          data: [
            {
              id: SUPPLIER_ID,
              legal_name: "Proveedor SA",
              display_name: null,
              cuit: "30711111118",
              iva_condition: "responsable_inscripto",
            },
          ],
          error: null,
        });
      }
      return resolve({ data: null, error: null });
    },
  };
  return b;
}

const service = {
  from: (t: string) => builder(t),
  rpc: async () => {
    if (linkMakesConfirmed && voucherRow) {
      voucherRow = {
        ...voucherRow,
        status: "confirmed",
        purchase_invoice_id: "pi-existing",
        purchase_invoices: {
          status: "received",
          invoicing_channels: { is_fiscal: true },
        },
      };
    }
    return { data: linkMakesConfirmed ? 1 : 0, error: null };
  },
};

const createPurchase = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  data: { id: "pi-new" },
}));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles.filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => service }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("./purchase-invoices-actions", () => ({
  createPurchaseInvoiceAction: (input: unknown) => createPurchase(input),
}));

const { createPurchaseInvoiceFromReceivedAction } =
  await import("./arca-received-actions");

const invoice = {
  channel_id: CHANNEL,
  supplier_id: SUPPLIER_ID,
  kind: "factura",
  letter: "A",
  punto_venta: 3,
  numero: 120,
  fecha: "2026-09-10",
  imp_neto: 1000,
  imp_op_exentas: 50,
  imp_iva: 210,
  imp_trib: 30,
  imp_perc_iva: 10,
  imp_perc_iibb: 20,
  imp_total: 1290,
  moneda: "PES",
  cotizacion: 1,
};

beforeEach(() => {
  roles = ["finance"];
  voucherRow = row();
  linkMakesConfirmed = false;
  cancelledCount = 0;
  claimWins = true;
  writes.length = 0;
  createPurchase.mockClear();
});

describe("createPurchaseInvoiceFromReceivedAction", () => {
  it("creates the purchase when identity and amounts match ARCA", async () => {
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "pi-new", linkedExisting: false },
    });
    expect(createPurchase).toHaveBeenCalledOnce();
  });

  it("refuses amounts that are not ARCA's", async () => {
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice: { ...invoice, imp_op_exentas: 0, imp_neto: 1050 },
    });
    expect(res).toEqual({
      ok: false,
      error: "Los importes tienen que ser los de ARCA.",
    });
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("refuses a tribute split that does not add up to ARCA's otros tributos", async () => {
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice: { ...invoice, imp_perc_iibb: 10 },
    });
    expect(res.ok).toBe(false);
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("refuses another número", async () => {
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice: { ...invoice, numero: 121 },
    });
    expect(res).toEqual({
      ok: false,
      error: "El tipo, la letra y el número tienen que ser los de ARCA.",
    });
  });

  it("links a purchase loaded by hand meanwhile instead of creating another", async () => {
    linkMakesConfirmed = true;
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "pi-existing", linkedExisting: true },
    });
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("does not create over a cancelled purchase with the same number", async () => {
    cancelledCount = 1;
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res).toEqual({
      ok: false,
      error: "Ya existe esta factura anulada en Compras.",
    });
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("does not create while someone else holds the claim", async () => {
    claimWins = false;
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res).toEqual({
      ok: false,
      error: "Otra persona lo está cargando; probá en unos minutos.",
    });
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("refuses a voucher already processed", async () => {
    voucherRow = row({ status: "discarded" });
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res).toEqual({
      ok: false,
      error: "Este comprobante ya fue procesado.",
    });
  });

  it("refuses a role without purchase_invoices:write", async () => {
    roles = ["operations"];
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res.ok).toBe(false);
    expect(writes).toEqual([]);
  });
});
