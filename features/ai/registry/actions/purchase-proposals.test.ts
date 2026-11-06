import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const getReceivedVoucherAction = vi.fn();
const findPurchaseInvoiceDuplicateAction = vi.fn();
const getPurchaseInvoiceByIdAction = vi.fn();
const searchPurchaseInvoicesAction = vi.fn();
const searchSuppliersAction = vi.fn();
const getSupplierByIdAction = vi.fn();
const findSupplierByCuitAction = vi.fn();
const listCostTagOptionsAction = vi.fn();
const readInvoicingChannels = vi.fn();
const createPurchaseInvoice = vi.fn();
const acceptReceivedVoucher = vi.fn();

vi.mock("@/features/purchase-invoices/actions/arca-received-actions", () => ({
  getReceivedVoucherAction,
}));
vi.mock(
  "@/features/purchase-invoices/actions/purchase-invoices-actions",
  () => ({
    findPurchaseInvoiceDuplicateAction,
    getPurchaseInvoiceByIdAction,
    searchPurchaseInvoicesAction,
  }),
);
vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({
  searchSuppliersAction,
  getSupplierByIdAction,
  findSupplierByCuitAction,
}));
vi.mock("@/features/cost-centers/actions/cost-tag-options-actions", () => ({
  listCostTagOptionsAction,
}));
vi.mock("@/lib/channels", () => ({ readInvoicingChannels }));
vi.mock("@/lib/commands/create-purchase-invoice", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands/create-purchase-invoice")>()),
  createPurchaseInvoice,
}));
vi.mock("@/lib/commands/accept-received-voucher", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands/accept-received-voucher")>()),
  acceptReceivedVoucher,
}));

const { proposeArcaPurchase, proposePurchaseInvoice } =
  await import("./purchase-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const SUPPLIER = "00000000-0000-4000-8000-000000000001";
const VOUCHER = "00000000-0000-4000-8000-000000000002";
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";

const supplier = {
  id: SUPPLIER,
  legal_name: "Proveedor SA",
  display_name: null,
  cuit: "30711111118",
  is_fiscal: true,
  is_active: true,
  iva_condition: "responsable_inscripto",
  default_channel_id: null,
  default_payment_term_days: 30,
  default_expense_account_id: ACCOUNT,
  default_cost_center_id: null,
  category_id: null,
};

function voucher(over: Record<string, unknown> = {}) {
  return {
    id: VOUCHER,
    issuer_cuit: "30711111118",
    issuer_name: "Proveedor SA",
    cbte_tipo: 1,
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 120,
    fecha: "2026-10-10",
    cae: "12345678901234",
    moneda: "PES",
    cotizacion: null,
    imp_neto_gravado: 1000,
    imp_no_gravado: 0,
    imp_op_exentas: 0,
    imp_iva: 210,
    imp_trib: 0,
    // ARCA's total carries 50 its parts do not list.
    imp_total: 1260,
    trib_breakdown: {},
    iva_breakdown: [],
    status: "pending_review",
    discard_reason: null,
    purchase: null,
    tribute_history: null,
    supplier: {
      id: SUPPLIER,
      legal_name: "Proveedor SA",
      display_name: null,
      cuit: "30711111118",
      iva_condition: "responsable_inscripto",
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readInvoicingChannels.mockResolvedValue({
    ok: true,
    channels: [
      {
        id: "jouve_fiscal",
        name: "Jouve fiscal",
        is_fiscal: true,
        is_active: true,
      },
      {
        id: "jouve_internal",
        name: "Jouve interno",
        is_fiscal: false,
        is_active: true,
      },
    ],
  });
  searchSuppliersAction.mockResolvedValue({
    ok: true,
    data: { suppliers: [supplier], nextOffset: null },
  });
  getSupplierByIdAction.mockResolvedValue({ ok: true, data: supplier });
  listCostTagOptionsAction.mockResolvedValue({
    ok: true,
    data: {
      expenseAccounts: [{ id: ACCOUNT, code: "5.1.01", name: "Fletes" }],
      costCenters: [],
      inactiveCostCenters: [],
    },
  });
  findPurchaseInvoiceDuplicateAction.mockResolvedValue({
    ok: true,
    data: null,
  });
  getReceivedVoucherAction.mockResolvedValue({ ok: true, data: voucher() });
});

describe("proposeArcaPurchase", () => {
  const prepare = (input: Record<string, unknown> = {}) =>
    proposeArcaPurchase.proposal?.prepareDraft(ctx, {
      voucher_id: VOUCHER,
      ...input,
    });

  it("asks where ARCA's gap goes instead of choosing it", async () => {
    const prepared = await prepare();
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.issues[0]?.field).toBe("gap_target");
    expect(prepared.issues[0]?.message).toContain("$ 50,00");
    expect(prepared.candidates?.[0]?.options.map((o) => o.value)).toEqual([
      "otros_tributos",
      "no_gravado",
    ]);
  });

  it("puts the gap in no gravado when the user says so", async () => {
    const prepared = await prepare({ gap_target: "no_gravado" });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      voucher_id: VOUCHER,
      gap_target: "no_gravado",
      invoice: {
        channel_id: "jouve_fiscal",
        supplier_id: SUPPLIER,
        letter: "A",
        numero: 120,
        imp_neto: 1000,
        imp_no_gravado: 50,
        imp_iva: 210,
        imp_trib: 0,
        imp_total: 1260,
        cae_proveedor: "12345678901234",
        account_id: ACCOUNT,
        // The supplier's 30-day term from the voucher's date.
        fch_vto_pago: "2026-11-09",
      },
    });
    const rows = Object.fromEntries(
      prepared.summary.map((r) => [r.label, r.value]),
    );
    expect(rows["Diferencia de ARCA"]).toBe(
      "$ 50,00 → No gravado (lo elegiste vos)",
    );
  });

  it("asks which tribute the gap is when it goes to otros tributos", async () => {
    const asked = await prepare({ gap_target: "otros_tributos" });
    expect(asked?.kind).toBe("issues");
    if (asked?.kind === "issues") {
      expect(asked.issues[0]?.field).toBe("gap_tribute");
    }
    const prepared = await prepare({
      gap_target: "otros_tributos",
      gap_tribute: "imp_perc_iibb",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      invoice: { imp_trib: 50, imp_perc_iibb: 50, imp_no_gravado: 0 },
    });
  });

  it("sends a supplier not loaded yet to proposeSupplier", async () => {
    getReceivedVoucherAction.mockResolvedValue({
      ok: true,
      data: voucher({ supplier: null }),
    });
    const prepared = await prepare({ gap_target: "no_gravado" });
    expect(prepared).toEqual({
      kind: "error",
      error: expect.stringContaining("proposeSupplier"),
    });
  });

  it("refuses a voucher already loaded", async () => {
    getReceivedVoucherAction.mockResolvedValue({
      ok: true,
      data: voucher({ status: "confirmed" }),
    });
    expect((await prepare())?.kind).toBe("error");
  });

  it("accepts through the tray's command with the user's choice", async () => {
    acceptReceivedVoucher.mockResolvedValue({
      ok: true,
      data: { id: "pi-1", linkedExisting: true },
    });
    const prepared = await prepare({ gap_target: "no_gravado" });
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    const res = await proposeArcaPurchase.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({
      ok: true,
      data: { id: "pi-1", note: "Ya estaba cargado: quedó vinculado." },
    });
    expect(acceptReceivedVoucher).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ voucherId: VOUCHER, gapTarget: "no_gravado" }),
    );
  });
});

describe("proposePurchaseInvoice", () => {
  const base = {
    supplier: "Proveedor SA",
    letter: "A",
    punto_venta: 3,
    numero: 55,
    fecha: "2026-11-02",
    imp_neto: 1000,
    imp_iva: 210,
    tributes: { imp_perc_iibb: 30 },
    imp_total: 1240,
  };
  const prepare = (input: Record<string, unknown> = {}) =>
    proposePurchaseInvoice.proposal?.prepareDraft(ctx, { ...base, ...input });

  it("drafts what the form would save, with the supplier's defaults", async () => {
    const prepared = await prepare();
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      channel_id: "jouve_fiscal",
      supplier_id: SUPPLIER,
      kind: "factura",
      letter: "A",
      imp_trib: 30,
      imp_perc_iibb: 30,
      imp_total: 1240,
      account_id: ACCOUNT,
      fch_vto_pago: "2026-12-02",
      moneda: "PES",
    });
  });

  it("holds the amounts to the form's rule: they must add up", async () => {
    const prepared = await prepare({ imp_total: 1300 });
    expect(prepared?.kind).toBe("issues");
  });

  it("refuses IVA on a B, as the form does", async () => {
    const prepared = await prepare({ letter: "B" });
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.issues[0]?.message).toContain("facturas B y C");
  });

  it("refuses a purchase already loaded", async () => {
    findPurchaseInvoiceDuplicateAction.mockResolvedValue({
      ok: true,
      data: {
        id: "x",
        kind: "factura",
        letter: "A",
        punto_venta: 3,
        numero: 55,
        status: "received",
      },
    });
    expect(await prepare()).toEqual({
      kind: "error",
      error: "Ya está cargada: A00003-00000055.",
    });
  });

  it("books otros tributos as IIBB on an internal purchase", async () => {
    const prepared = await prepare({
      channel: "interno",
      letter: undefined,
      imp_iva: 0,
      tributes: { imp_perc_iva: 30 },
      imp_total: 1030,
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      channel_id: "jouve_internal",
      letter: null,
      imp_perc_iva: 0,
      imp_perc_iibb: 30,
    });
  });

  it("asks for the origin of an NC", async () => {
    searchPurchaseInvoicesAction.mockResolvedValue({
      ok: true,
      data: { invoices: [], nextOffset: null },
    });
    const prepared = await prepare({ kind: "nc", motivo: "Devolución" });
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.issues[0]?.field).toBe("origin_invoice_id");
  });

  it("writes through the form's command on accept", async () => {
    createPurchaseInvoice.mockResolvedValue({ ok: true, data: { id: "pi-2" } });
    const prepared = await prepare();
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    const res = await proposePurchaseInvoice.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: "pi-2" } });
    expect(createPurchaseInvoice).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ supplier_id: SUPPLIER, numero: 55 }),
    );
  });
});
