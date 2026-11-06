import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRole, resolveAccess } from "@/lib/auth/permissions";

const VOUCHER_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "jouve_fiscal";

let roles: string[] = ["finance"];
let voucherRow: Record<string, unknown> | null;
let linkMakesConfirmed = false;
let sameKeyRows: { id?: string; status: string; imp_total: number }[] = [];
const updateValues: Record<string, unknown>[] = [];
let claimWins: boolean | "error" = true;
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
    unreadable_reason: null,
    raw_amounts: null,
    purchase_invoice_id: null,
    purchase_invoices: null,
    ...over,
  };
}

function builder(table: string) {
  let op: "select" | "update" = "select";
  const b = {
    select: () => b,
    update: (values: Record<string, unknown>) => {
      op = "update";
      writes.push(`update:${table}`);
      updateValues.push(values);
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
        if (claimWins === "error")
          return { data: null, error: { code: "XX000" } };
        return { data: claimWins ? { id: VOUCHER_ID } : null, error: null };
      }
      if (table === "suppliers")
        return { data: { cuit: "30711111118" }, error: null };
      if (table === "invoicing_channels")
        return { data: { is_fiscal: true }, error: null };
      return { data: null, error: null };
    },
    then: (resolve: (v: unknown) => void) => {
      if (table === "purchase_invoices") {
        return resolve({ data: sameKeyRows, error: null });
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

const rpcCalls: string[] = [];
const service = {
  from: (t: string) => builder(t),
  rpc: async (fn: string) => {
    rpcCalls.push(fn);
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
vi.mock("@/lib/commands/create-purchase-invoice", () => ({
  createPurchaseInvoice: (_actorId: string, input: unknown) =>
    createPurchase(input),
}));

const {
  createPurchaseInvoiceFromReceivedAction,
  discardReceivedVoucherAction,
  restoreReceivedVoucherAction,
} = await import("./arca-received-actions");

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
  sameKeyRows = [];
  claimWins = true;
  writes.length = 0;
  updateValues.length = 0;
  rpcCalls.length = 0;
  createPurchase.mockClear();
});

describe("a voucher whose amounts did not read", () => {
  const unreadable = () =>
    row({
      status: "unreadable",
      imp_neto_gravado: 0,
      imp_op_exentas: 0,
      imp_iva: 0,
      imp_trib: 0,
      imp_total: 0,
      unreadable_reason: "amount_over_total",
      raw_amounts: { neto: "1000", total: "900" },
    });

  it("loads it by hand: the amounts typed are not checked against ARCA's", async () => {
    voucherRow = unreadable();
    const items = [
      {
        description: "Servicio",
        quantity: 1,
        unit_price: 1000,
        iva_rate_id: 5,
        line_neto: 1000,
        line_iva: 210,
        line_total: 1210,
      },
    ];
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice: { ...invoice, items },
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "pi-new", linkedExisting: false },
    });
    // The person's lines, and no link by amounts (there are none to compare).
    expect(createPurchase.mock.calls[0]?.[0]).toMatchObject({
      items: [expect.objectContaining({ description: "Servicio" })],
    });
    expect(rpcCalls).toEqual([]);
    expect(updateValues).toContainEqual(
      expect.objectContaining({
        status: "confirmed",
        purchase_invoice_id: "pi-new",
      }),
    );
  });

  it("still checks it is ARCA's voucher (número)", async () => {
    voucherRow = unreadable();
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice: { ...invoice, numero: 121 },
    });
    expect(res.ok ? null : res.error).toMatch(/número/);
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("links the purchase already loaded with its number, whatever its total", async () => {
    voucherRow = unreadable();
    sameKeyRows = [{ id: "pi-hand", status: "received", imp_total: 999 }];
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "pi-hand", linkedExisting: true },
    });
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("refuses a type the tray does not load", async () => {
    voucherRow = unreadable();
    voucherRow = { ...voucherRow, kind: null, letter: null, cbte_tipo: 201 };
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res.ok).toBe(false);
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("discards it, and restoring it sends it back to «No se pudieron leer»", async () => {
    voucherRow = unreadable();
    expect(
      await discardReceivedVoucherAction({ voucherId: VOUCHER_ID }),
    ).toEqual({ ok: true, data: undefined });
    voucherRow = { ...unreadable(), status: "discarded" };
    updateValues.length = 0;
    expect(
      await restoreReceivedVoucherAction({ voucherId: VOUCHER_ID }),
    ).toEqual({ ok: true, data: undefined });
    expect(updateValues).toEqual([
      expect.objectContaining({ status: "unreadable" }),
    ]);
  });
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

  it("counts the Ganancias part in the split and passes it to the purchase", async () => {
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice: { ...invoice, imp_perc_iibb: 15, imp_perc_nacionales: 5 },
    });
    expect(res.ok).toBe(true);
    expect(createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ imp_perc_nacionales: 5, imp_perc_iibb: 15 }),
    );
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
    sameKeyRows = [{ status: "cancelled", imp_total: 1310 }];
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

  it("does not create a second purchase when one has this number and another total", async () => {
    sameKeyRows = [{ status: "received", imp_total: 999 }];
    const res = await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice,
    });
    expect(res.ok ? null : res.error).toMatch(/otro total/);
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

  it("refuses another currency or date than ARCA's", async () => {
    expect(
      await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: { ...invoice, moneda: "DOL", cotizacion: 1000 },
      }),
    ).toEqual({
      ok: false,
      error: "La fecha, la moneda y el CAE tienen que ser los de ARCA.",
    });
    expect(
      await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: { ...invoice, fecha: "2026-09-30" },
      }),
    ).toEqual({
      ok: false,
      error: "La fecha, la moneda y el CAE tienen que ser los de ARCA.",
    });
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("saves ARCA's lines, never the client's", async () => {
    voucherRow = row({
      letter: "B",
      imp_neto_gravado: 1260,
      imp_op_exentas: 0,
      imp_iva: 0,
    });
    await createPurchaseInvoiceFromReceivedAction({
      voucherId: VOUCHER_ID,
      invoice: {
        ...invoice,
        letter: "B",
        imp_neto: 1260,
        imp_op_exentas: 0,
        imp_iva: 0,
        items: [
          {
            description: "x",
            quantity: 1,
            unit_price: 1,
            iva_rate_id: null,
            line_neto: 1,
            line_total: 1,
          },
        ],
      },
    });
    expect(createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ items: [] }),
    );
  });

  it("reports a failed claim as a failure, not as someone else loading it", async () => {
    claimWins = "error";
    expect(
      await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice,
      }),
    ).toEqual({ ok: false, error: "No se pudo cargar el comprobante." });
  });

  describe("a total above its parts (Telefónica 02093-03198905)", () => {
    // ARCA: neto 895, no gravado 98,45, IVA 241,65, total 1.281,30 → 46,20.
    const telefonica = {
      imp_neto_gravado: 895,
      imp_no_gravado: 98.45,
      imp_op_exentas: 0,
      imp_iva: 241.65,
      imp_trib: 0,
      imp_total: 1281.3,
    };
    const base = {
      ...invoice,
      imp_neto: 895,
      imp_no_gravado: 98.45,
      imp_op_exentas: 0,
      imp_iva: 241.65,
      imp_trib: 0,
      imp_perc_iva: 0,
      imp_perc_iibb: 0,
      imp_total: 1281.3,
    };
    const parts = (i: Record<string, number | string>) =>
      Math.round(
        (Number(i.imp_neto) +
          Number(i.imp_no_gravado) +
          Number(i.imp_op_exentas) +
          Number(i.imp_iva) +
          Number(i.imp_trib)) *
          100,
      ) / 100;

    beforeEach(() => {
      voucherRow = row(telefonica);
    });

    it("saves the gap in otros tributos, split, and the purchase adds up", async () => {
      const sent = { ...base, imp_trib: 46.2, imp_perc_iibb: 46.2 };
      const res = await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: sent,
        gapTarget: "otros_tributos",
      });
      expect(res.ok).toBe(true);
      expect(createPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          imp_neto: 895,
          imp_no_gravado: 98.45,
          imp_iva: 241.65,
          imp_trib: 46.2,
          imp_perc_iibb: 46.2,
          imp_total: 1281.3,
        }),
      );
      expect(parts(sent)).toBe(1281.3);
    });

    it("saves the gap in no gravado, and the purchase adds up", async () => {
      const sent = { ...base, imp_no_gravado: 144.65 };
      const res = await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: sent,
        gapTarget: "no_gravado",
      });
      expect(res.ok).toBe(true);
      expect(createPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          imp_no_gravado: 144.65,
          imp_iva: 241.65,
          imp_trib: 0,
          imp_total: 1281.3,
        }),
      );
      expect(parts(sent)).toBe(1281.3);
    });

    it("puts the gap in the net on a B (no gravado goes inside it)", async () => {
      voucherRow = row({ ...telefonica, letter: "B", cbte_tipo: 6 });
      const res = await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: {
          ...base,
          letter: "B",
          imp_neto: 1281.3,
          imp_no_gravado: 0,
          imp_iva: 0,
        },
        gapTarget: "no_gravado",
      });
      expect(res.ok).toBe(true);
    });

    it("refuses without a choice, also when the amounts sent add up", async () => {
      const res = await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: { ...base, imp_no_gravado: 144.65 },
      });
      expect(res).toEqual({
        ok: false,
        error:
          "Los importes de ARCA no suman el total: elegí a dónde va la diferencia de $ 46,20 (otros tributos (percepciones) o no gravado).",
      });
      expect(createPurchase).not.toHaveBeenCalled();
    });

    it("refuses ARCA's amounts as they are (they do not add up)", async () => {
      const res = await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: base,
        gapTarget: "no_gravado",
      });
      expect(res.ok).toBe(false);
      expect(createPurchase).not.toHaveBeenCalled();
    });

    it("recomputes the gap: a gap the client sends is ignored", async () => {
      // 60 instead of 46,20, with the total raised to match.
      const res = await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: {
          ...base,
          imp_trib: 60,
          imp_perc_iibb: 60,
          imp_total: 1295.1,
          gap: 60,
        },
        gapTarget: "otros_tributos",
      });
      expect(res).toEqual({
        ok: false,
        error: "Los importes tienen que ser los de ARCA.",
      });
      expect(createPurchase).not.toHaveBeenCalled();
    });

    it("refuses an unknown place for the gap (IVA is not offered)", async () => {
      const res = await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice: { ...base, imp_iva: 287.85 },
        gapTarget: "iva",
      });
      expect(res).toEqual({ ok: false, error: "Datos inválidos." });
      expect(createPurchase).not.toHaveBeenCalled();
    });
  });

  it("answers ok when a retry finds it already loaded", async () => {
    voucherRow = row({
      status: "confirmed",
      purchase_invoice_id: "pi-done",
      purchase_invoices: {
        status: "received",
        invoicing_channels: { is_fiscal: true },
      },
    });
    expect(
      await createPurchaseInvoiceFromReceivedAction({
        voucherId: VOUCHER_ID,
        invoice,
      }),
    ).toEqual({ ok: true, data: { id: "pi-done", linkedExisting: true } });
    expect(createPurchase).not.toHaveBeenCalled();
  });
});
