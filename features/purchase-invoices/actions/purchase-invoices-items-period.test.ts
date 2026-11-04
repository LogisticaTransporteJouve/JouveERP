import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRole, resolveAccess } from "@/lib/auth/permissions";

const CHANNEL_FISCAL = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "44444444-4444-4444-8444-444444444444";

const ITEMS_GUARD =
  "El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras";

let refused = false;
let replaceError: Record<string, unknown> | null = null;
const calls: string[] = [];

function from(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({
      data: {
        channel_id: CHANNEL_FISCAL,
        letter: "A",
        imp_neto: 100000,
        imp_iva: 21050,
        imp_trib: 0,
        imp_no_gravado: 0,
        imp_op_exentas: 0,
        imp_total: 121050,
      },
      error: null,
    }),
    update: () => {
      calls.push(`update:${table}`);
      return { eq: async () => ({ error: null }) };
    },
  };
  return builder;
}

async function rpc(name: string) {
  calls.push(`rpc:${name}`);
  if (name === "purchase_items_change_refused") {
    return { data: refused, error: null };
  }
  return { data: null, error: replaceError };
}

const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"].filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { updatePurchaseInvoiceAction } =
  await import("./purchase-invoices-actions");

const edit = {
  id: INVOICE_ID,
  notes: "Vence en dos pagos",
  items: [
    {
      description: "Servicio",
      quantity: 1,
      unit_price: 100000,
      iva_rate_id: 5,
      line_neto: 100000,
      line_iva: 21050,
      line_total: 121050,
    },
  ],
};

beforeEach(() => {
  refused = false;
  replaceError = null;
  calls.length = 0;
  logAudit.mockClear();
});

describe("purchase edit in a closed period", () => {
  it("refuses an item change before saving the header, and says nothing was saved", async () => {
    refused = true;
    const res = await updatePurchaseInvoiceAction(edit);
    expect(res).toEqual({
      ok: false,
      error:
        "El período contable de la factura está cerrado: los ítems figuran en el Libro IVA Compras y no se pueden cambiar. No se guardó ningún cambio.",
    });
    expect(calls).toEqual(["rpc:purchase_items_change_refused"]);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("saves the header and the items when the check passes", async () => {
    const res = await updatePurchaseInvoiceAction(edit);
    expect(res).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([
      "rpc:purchase_items_change_refused",
      "update:purchase_invoices",
      "rpc:replace_purchase_invoice_items",
    ]);
  });

  it("audits the saved header and says so when the items step still refuses", async () => {
    replaceError = { code: "55006", hint: "jouve_guard", message: ITEMS_GUARD };
    const res = await updatePurchaseInvoiceAction(edit);
    expect(res).toEqual({
      ok: false,
      error: `Se guardó la factura, pero no los ítems: ${ITEMS_GUARD}`,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "purchase_invoice.updated",
      "u1",
      { fields: ["notes"], items_saved: false },
      INVOICE_ID,
    );
  });

  it("does not check or touch the items when the edit leaves them out", async () => {
    const res = await updatePurchaseInvoiceAction({
      id: INVOICE_ID,
      notes: "Solo notas",
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual(["update:purchase_invoices"]);
  });
});
