import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRole, resolveAccess } from "@/lib/auth/permissions";

// ---------------------------------------------------------------------------
// In-memory stand-in for the RLS Supabase client: enough of the query builder
// for the confirm paths (select/update/insert + eq/is/in + maybeSingle/single).
// Each query executes atomically when awaited, like a single SQL statement.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let insertRow: Row | null = null;
  let returning = false;
  const run = (): Row[] => {
    const rows = (db[table] ??= []);
    if (insertRow) {
      const row = { id: crypto.randomUUID(), ...insertRow };
      rows.push(row);
      return [row];
    }
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (patch) for (const r of hit) Object.assign(r, patch);
    return hit;
  };
  const builder = {
    select: () => {
      if (patch || insertRow) returning = true;
      return builder;
    },
    update: (values: Row) => {
      patch = values;
      return builder;
    },
    insert: (values: Row) => {
      insertRow = values;
      return builder;
    },
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    },
    is: (col: string, v: unknown) => {
      filters.push((r) => (r[col] ?? null) === v);
      return builder;
    },
    in: (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return builder;
    },
    limit: () => builder,
    lt: (col: string, v: string) => {
      filters.push((r) => typeof r[col] === "string" && String(r[col]) < v);
      return builder;
    },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
      const rows = run();
      return Promise.resolve(
        resolve({ data: returning ? rows : null, error: null }),
      );
    },
  };
  return builder;
}

const createReceiptAction = vi.fn();
const createPaymentOrderAction = vi.fn();
const getReceiptUsdRateAction = vi.fn();
const getPaymentOrderUsdRateAction = vi.fn();
const createPurchaseInvoiceAction = vi.fn();
const logAudit = vi.fn();
const inngestSend = vi.fn();
let roles: string[] = ["owner"];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles.filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: query,
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: async (...args: unknown[]) => {
    logAudit(...args);
  },
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: (event: unknown) => inngestSend(event) },
}));
vi.mock("@/lib/rate-limit", () => ({
  RateLimitError: class extends Error {},
  enforceRateLimit: async () => undefined,
}));
vi.mock("../lib/chat-store", () => ({ checkAiDailyCap: async () => "ok" }));
vi.mock("@/features/receipts/actions/receipts-actions", () => ({
  createReceiptAction: (input: unknown) => createReceiptAction(input),
  getReceiptUsdRateAction: (date: string) => getReceiptUsdRateAction(date),
}));
vi.mock("@/features/payment-orders/actions/payment-orders-actions", () => ({
  createPaymentOrderAction: (input: unknown) => createPaymentOrderAction(input),
  getPaymentOrderUsdRateAction: (date: string) =>
    getPaymentOrderUsdRateAction(date),
}));
vi.mock(
  "@/features/purchase-invoices/actions/purchase-invoices-actions",
  () => ({
    createPurchaseInvoiceAction: (input: unknown) =>
      createPurchaseInvoiceAction(input),
  }),
);
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: vi.fn(),
}));
vi.mock("@/features/exchange-rates/actions/exchange-rates-actions", () => ({
  getUsdRateForDateAction: vi.fn(),
}));

const {
  createChecksFromExtractionAction,
  createPaymentOrderFromExtractionAction,
  createPurchaseInvoiceFromDraftAction,
  createReceiptFromExtractionAction,
  createSalesInvoiceFromExtractionAction,
  discardExtractionAction,
  getPurchaseInvoiceDraftAction,
  scanDocumentAction,
} = await import("./actions");
const { issueFiscalInvoiceAction } =
  await import("@/features/invoices/actions/invoices-actions");
const { getUsdRateForDateAction } =
  await import("@/features/exchange-rates/actions/exchange-rates-actions");

const EXTRACTION_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "44444444-4444-4444-8444-444444444444";

function seed(detectedType: string | null, matches: Row) {
  db.ai_document_extractions = [
    {
      id: EXTRACTION_ID,
      status: "pending_review",
      detected_type: detectedType,
      confidence: 1,
      matches,
      payload: {},
      file_id: FILE_ID,
      created_entity: null,
      updated_at: new Date().toISOString(),
    },
  ];
  db.file_attachments = [];
}

const attachments = () => db.file_attachments ?? [];

const extraction = () => db.ai_document_extractions?.[0];

const receiptInput = {
  extractionId: EXTRACTION_ID,
  channelId: "ch1",
  numero: 1,
  receipt_date: "2026-07-01",
  total_amount: 100,
  currency: "ARS",
  account_id: ACCOUNT_ID,
};

beforeEach(() => {
  roles = ["owner"];
  createReceiptAction.mockReset();
  createPaymentOrderAction.mockReset();
  getReceiptUsdRateAction.mockReset();
  getPaymentOrderUsdRateAction.mockReset();
  createPurchaseInvoiceAction.mockReset();
  logAudit.mockReset();
  inngestSend.mockReset();
});

describe("create-from-extraction is claim-then-create", () => {
  it("a double click creates exactly one receipt", async () => {
    seed("receipt", { client_id: "c1" });
    createReceiptAction.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true, data: { id: "rec-1" } };
    });

    const [a, b] = await Promise.all([
      createReceiptFromExtractionAction(receiptInput),
      createReceiptFromExtractionAction(receiptInput),
    ]);

    expect(createReceiptAction).toHaveBeenCalledTimes(1);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const loser = a.ok ? b : a;
    expect(loser).toEqual({
      ok: false,
      error: "La extracción ya fue procesada.",
    });
    expect(extraction()).toMatchObject({
      status: "confirmed",
      created_entity: { table: "receipts", id: "rec-1" },
    });
  });

  it("a double click creates exactly one payment order", async () => {
    seed("payment_order", { supplier_id: "s1" });
    createPaymentOrderAction.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true, data: { id: "op-1" } };
    });
    const input = {
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
      numero: 1,
      payment_date: "2026-07-01",
      total_amount: 100,
      currency: "ARS",
      account_id: ACCOUNT_ID,
    };
    await Promise.all([
      createPaymentOrderFromExtractionAction(input),
      createPaymentOrderFromExtractionAction(input),
      createPaymentOrderFromExtractionAction(input),
    ]);
    expect(createPaymentOrderAction).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when creation fails, so the user can retry", async () => {
    seed("receipt", { client_id: "c1" });
    createReceiptAction.mockResolvedValueOnce({
      ok: false,
      error: "Número repetido.",
    });

    const first = await createReceiptFromExtractionAction(receiptInput);
    expect(first).toEqual({ ok: false, error: "Número repetido." });
    expect(extraction()).toMatchObject({
      status: "pending_review",
      created_entity: null,
    });

    createReceiptAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "rec-2" },
    });
    const second = await createReceiptFromExtractionAction(receiptInput);
    expect(second).toEqual({ ok: true, data: { id: "rec-2" } });
    expect(extraction()).toMatchObject({ status: "confirmed" });
  });

  it("a double click inserts the scanned checks only once", async () => {
    seed("check", {});
    db.accounts = [{ id: ACCOUNT_ID, type: "checks" }];
    db.checks = [];
    const input = {
      extractionId: EXTRACTION_ID,
      cartera_account_id: ACCOUNT_ID,
      cheques: [
        {
          banco: "Banco Nación",
          numero: "123",
          librador: "ACME SA",
          librador_cuit: "",
          importe: 1000,
          fecha: "2026-07-01",
        },
      ],
    };
    const [a, b] = await Promise.all([
      createChecksFromExtractionAction(input),
      createChecksFromExtractionAction(input),
    ]);
    expect(db.checks).toHaveLength(1);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(extraction()).toMatchObject({
      status: "confirmed",
      created_entity: { table: "checks", count: 1 },
    });
  });

  it("refuses an already-confirmed draft without creating anything", async () => {
    seed("receipt", { client_id: "c1" });
    const row = extraction();
    if (row) row.status = "confirmed";
    const res = await createReceiptFromExtractionAction(receiptInput);
    expect(res.ok).toBe(false);
    expect(createReceiptAction).not.toHaveBeenCalled();
  });
});

describe("USD receipts and payment orders from an extraction", () => {
  it("creates a USD receipt at the rate loaded for its date", async () => {
    seed("receipt", { client_id: "c1" });
    getReceiptUsdRateAction.mockResolvedValueOnce({
      ok: true,
      data: { rate: 1180.5, rate_date: "2026-06-30" },
    });
    createReceiptAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "rec-usd" },
    });
    const res = await createReceiptFromExtractionAction({
      ...receiptInput,
      currency: "USD",
    });
    expect(res).toEqual({ ok: true, data: { id: "rec-usd" } });
    expect(getReceiptUsdRateAction).toHaveBeenCalledWith("2026-07-01");
    expect(createReceiptAction).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD", cotizacion: 1180.5 }),
    );
  });

  it("refuses a USD receipt when no rate is loaded, creating nothing", async () => {
    seed("receipt", { client_id: "c1" });
    getReceiptUsdRateAction.mockResolvedValueOnce({ ok: true, data: null });
    const res = await createReceiptFromExtractionAction({
      ...receiptInput,
      currency: "USD",
    });
    expect(res.ok).toBe(false);
    expect(createReceiptAction).not.toHaveBeenCalled();
    expect(extraction()).toMatchObject({ status: "pending_review" });
  });

  it("an ARS receipt does not look up a rate", async () => {
    seed("receipt", { client_id: "c1" });
    createReceiptAction.mockResolvedValueOnce({ ok: true, data: { id: "r" } });
    await createReceiptFromExtractionAction(receiptInput);
    expect(getReceiptUsdRateAction).not.toHaveBeenCalled();
    expect(createReceiptAction).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "ARS", cotizacion: null }),
    );
  });

  it("creates a USD payment order at the rate loaded for its date", async () => {
    seed("payment_order", { supplier_id: "s1" });
    getPaymentOrderUsdRateAction.mockResolvedValueOnce({
      ok: true,
      data: { rate: 950.25, rate_date: "2026-07-01" },
    });
    createPaymentOrderAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "op-usd" },
    });
    const res = await createPaymentOrderFromExtractionAction({
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
      numero: 1,
      payment_date: "2026-07-01",
      total_amount: 100,
      currency: "USD",
      account_id: ACCOUNT_ID,
    });
    expect(res).toEqual({ ok: true, data: { id: "op-usd" } });
    expect(createPaymentOrderAction).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD", cotizacion: 950.25 }),
    );
  });
});

const invoicePayload = {
  counterparty_name: "ACME SA",
  counterparty_cuit: "30-71234567-8",
  sales_point: 1,
  number: 42,
  letter: "A",
  date: "2026-07-01",
  currency: "ARS",
  net_amount: 100,
  iva_amount: 21,
  total_amount: 121,
  items: [],
};

// What the purchase form sends; createPurchaseInvoiceAction validates it.
const reviewedInvoice = {
  supplier_id: "55555555-5555-4555-8555-555555555555",
  channel_id: "ch1",
  kind: "factura",
  letter: "A",
  punto_venta: 1,
  numero: 43,
  fecha: "2026-07-01",
  imp_neto: 100,
  imp_iva: 21,
  imp_trib: 0,
  imp_total: 121,
  moneda: "PES",
  cotizacion: 1,
};

function seedPurchase(detectedType = "purchase_invoice") {
  seed(detectedType, { supplier_id: "s1" });
  const row = extraction();
  if (row) row.payload = invoicePayload;
}

describe("createPurchaseInvoiceFromDraftAction", () => {
  const input = { extractionId: EXTRACTION_ID, invoice: reviewedInvoice };

  it("creates the reviewed invoice, attaches the scan and confirms the draft", async () => {
    seedPurchase();
    createPurchaseInvoiceAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "pi-1" },
    });

    const res = await createPurchaseInvoiceFromDraftAction(input);

    expect(res).toEqual({ ok: true, data: { id: "pi-1" } });
    // The user's edited values go to the normal create action as-is.
    expect(createPurchaseInvoiceAction).toHaveBeenCalledWith(reviewedInvoice);
    expect(extraction()).toMatchObject({
      status: "confirmed",
      created_entity: { table: "purchase_invoices", id: "pi-1" },
    });
    expect(attachments()).toEqual([
      expect.objectContaining({
        file_id: FILE_ID,
        purchase_invoice_id: "pi-1",
        kind: "comprobante",
        created_by: "u1",
      }),
    ]);
  });

  it("accepts a scanned supplier NC/ND", async () => {
    seedPurchase("credit_debit_note");
    createPurchaseInvoiceAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "pi-nc" },
    });
    const res = await createPurchaseInvoiceFromDraftAction({
      extractionId: EXTRACTION_ID,
      invoice: { ...reviewedInvoice, kind: "nc", motivo_nc_nd: "Devolución" },
    });
    expect(res.ok).toBe(true);
    expect(attachments()).toHaveLength(1);
  });

  it("refuses another document type without creating anything", async () => {
    seed("receipt", { client_id: "c1" });
    const res = await createPurchaseInvoiceFromDraftAction(input);
    expect(res.ok).toBe(false);
    expect(createPurchaseInvoiceAction).not.toHaveBeenCalled();
  });

  it("releases the draft and attaches nothing when the create fails", async () => {
    seedPurchase();
    createPurchaseInvoiceAction.mockResolvedValueOnce({
      ok: false,
      error: "Ya cargaste esta factura del proveedor.",
    });

    const res = await createPurchaseInvoiceFromDraftAction(input);

    expect(res).toEqual({
      ok: false,
      error: "Ya cargaste esta factura del proveedor.",
    });
    expect(extraction()).toMatchObject({
      status: "pending_review",
      created_entity: null,
    });
    expect(attachments()).toHaveLength(0);
  });

  it("releases the draft when the create throws", async () => {
    seedPurchase();
    createPurchaseInvoiceAction.mockRejectedValueOnce(new Error("boom"));
    await expect(createPurchaseInvoiceFromDraftAction(input)).rejects.toThrow(
      "boom",
    );
    expect(extraction()).toMatchObject({ status: "pending_review" });
  });

  it("links and attaches an invoice whose items failed, and never re-creates it", async () => {
    seedPurchase();
    const partial = {
      ok: false,
      error: "Factura cargada pero no se pudieron guardar los ítems.",
      createdId: "pi-1",
    };
    createPurchaseInvoiceAction.mockResolvedValueOnce(partial);

    const res = await createPurchaseInvoiceFromDraftAction(input);
    expect(res).toEqual({ ok: false, error: partial.error });
    expect(extraction()).toMatchObject({
      status: "confirmed",
      created_entity: { table: "purchase_invoices", id: "pi-1" },
    });
    expect(attachments()).toHaveLength(1);

    const retry = await createPurchaseInvoiceFromDraftAction(input);
    expect(retry.ok).toBe(false);
    expect(createPurchaseInvoiceAction).toHaveBeenCalledTimes(1);
  });

  it("a double click creates exactly one invoice", async () => {
    seedPurchase();
    createPurchaseInvoiceAction.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true, data: { id: "pi-1" } };
    });
    await Promise.all([
      createPurchaseInvoiceFromDraftAction(input),
      createPurchaseInvoiceFromDraftAction(input),
    ]);
    expect(createPurchaseInvoiceAction).toHaveBeenCalledTimes(1);
    expect(attachments()).toHaveLength(1);
  });

  it("does not attach the same file twice to the same invoice", async () => {
    seedPurchase();
    db.file_attachments = [
      { id: "fa-0", file_id: FILE_ID, purchase_invoice_id: "pi-1" },
    ];
    createPurchaseInvoiceAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "pi-1" },
    });
    await createPurchaseInvoiceFromDraftAction(input);
    expect(attachments()).toHaveLength(1);
  });

  it.each([["operations"], ["warehouse"], ["driver"]])(
    "is refused for %s (needs ai:read + purchase_invoices:write)",
    async (role) => {
      seedPurchase();
      roles = [role];
      const res = await createPurchaseInvoiceFromDraftAction(input);
      expect(res.ok).toBe(false);
      expect(createPurchaseInvoiceAction).not.toHaveBeenCalled();
      expect(extraction()?.status).toBe("pending_review");
    },
  );

  it("is allowed for finance", async () => {
    seedPurchase();
    roles = ["finance"];
    createPurchaseInvoiceAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "pi-1" },
    });
    const res = await createPurchaseInvoiceFromDraftAction(input);
    expect(res.ok).toBe(true);
  });
});

describe("getPurchaseInvoiceDraftAction", () => {
  const SUPPLIER_ID = "55555555-5555-4555-8555-555555555555";

  it("reports processing while the pipeline has not classified yet", async () => {
    seed(null, {});
    const res = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
    expect(res).toEqual({ ok: true, data: { state: "processing" } });
  });

  it("reports failed and closed drafts", async () => {
    seedPurchase();
    const row = extraction();
    if (row) row.status = "failed";
    expect(await getPurchaseInvoiceDraftAction(EXTRACTION_ID)).toEqual({
      ok: true,
      data: { state: "failed" },
    });
    if (row) row.status = "confirmed";
    expect(await getPurchaseInvoiceDraftAction(EXTRACTION_ID)).toEqual({
      ok: true,
      data: { state: "closed", status: "confirmed" },
    });
  });

  it("returns a draft left claimed by a crashed save to pending", async () => {
    seedPurchase();
    const row = extraction();
    if (row) {
      row.status = "confirmed";
      row.updated_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    }
    const res = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
    expect(res.ok && res.data.state).toBe("ready");
    expect(extraction()?.status).toBe("pending_review");
  });

  it("leaves a recent claim and a linked draft alone", async () => {
    seedPurchase();
    const row = extraction();
    if (row) row.status = "confirmed";
    expect(await getPurchaseInvoiceDraftAction(EXTRACTION_ID)).toEqual({
      ok: true,
      data: { state: "closed", status: "confirmed" },
    });
    if (row) {
      row.updated_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      row.created_entity = { table: "purchase_invoices", id: "pi-1" };
    }
    const linked = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
    expect(linked.ok && linked.data.state).toBe("closed");
    expect(extraction()?.status).toBe("confirmed");
  });

  it("reads the comprobante type printed on a scanned NC", async () => {
    seedPurchase();
    const row = extraction();
    if (row) row.payload = { ...invoicePayload, kind: "credit_note" };
    const res = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
    if (!res.ok || res.data.state !== "ready") throw new Error("not ready");
    expect(res.data.draft).toMatchObject({ kind: "nc", kind_read: true });
  });

  it("reports another document type as unsupported", async () => {
    seed("receipt", {});
    const res = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
    expect(res).toEqual({
      ok: true,
      data: { state: "unsupported", detectedType: "receipt" },
    });
  });

  it("builds the draft with the matched supplier and suggested account", async () => {
    seed("purchase_invoice", {
      supplier_id: SUPPLIER_ID,
      expense: { accountCode: "5.1.01", costCenterCode: "CC1" },
    });
    const row = extraction();
    if (row) row.payload = invoicePayload;
    db.suppliers = [
      {
        id: SUPPLIER_ID,
        legal_name: "ACME SA",
        display_name: null,
        cuit: "30712345678",
        iva_condition: "responsable_inscripto",
      },
    ];
    db.chart_of_accounts = [{ id: ACCOUNT_ID, code: "5.1.01", name: "Fletes" }];
    db.cost_centers = [{ id: "cc-1", code: "CC1" }];

    const res = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
    if (!res.ok || res.data.state !== "ready") {
      throw new Error("expected a ready draft");
    }
    expect(res.data.source).toMatchObject({ fileId: FILE_ID });
    expect(res.data.draft).toMatchObject({
      supplier: { id: SUPPLIER_ID, legal_name: "ACME SA" },
      unmatchedSupplier: null,
      kind: "factura",
      punto_venta: 1,
      numero: 42,
      imp_total: 121,
      account: { id: ACCOUNT_ID, label: "5.1.01 — Fletes" },
      cost_center_id: "cc-1",
    });
  });

  it("maps a scanned NC/ND to kind nc", async () => {
    seedPurchase("credit_debit_note");
    const res = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
    expect(res.ok && res.data.state === "ready" && res.data.draft.kind).toBe(
      "nc",
    );
  });

  it.each([["operations"], ["warehouse"]])(
    "is refused for %s",
    async (role) => {
      seedPurchase();
      roles = [role];
      const res = await getPurchaseInvoiceDraftAction(EXTRACTION_ID);
      expect(res.ok).toBe(false);
    },
  );
});

describe("attach on create", () => {
  it("attaches the scanned receipt to the created receipt", async () => {
    seed("receipt", { client_id: "c1" });
    createReceiptAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "rec-1" },
    });
    await createReceiptFromExtractionAction(receiptInput);
    expect(attachments()).toEqual([
      expect.objectContaining({ file_id: FILE_ID, receipt_id: "rec-1" }),
    ]);
  });

  it("attaches the scanned payment order with the payment kind", async () => {
    seed("payment_order", { supplier_id: "s1" });
    createPaymentOrderAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "op-1" },
    });
    await createPaymentOrderFromExtractionAction({
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
      numero: 1,
      payment_date: "2026-07-01",
      total_amount: 100,
      currency: "ARS",
      account_id: ACCOUNT_ID,
    });
    expect(attachments()).toEqual([
      expect.objectContaining({
        payment_order_id: "op-1",
        kind: "comprobante_pago",
      }),
    ]);
  });

  it("attaches the photo to every check created from it", async () => {
    seed("check", {});
    db.accounts = [{ id: ACCOUNT_ID, type: "checks" }];
    db.checks = [];
    const cheque = {
      banco: "Banco Nación",
      librador: "ACME SA",
      librador_cuit: "",
      importe: 1000,
      fecha: "2026-07-01",
    };
    await createChecksFromExtractionAction({
      extractionId: EXTRACTION_ID,
      cartera_account_id: ACCOUNT_ID,
      cheques: [
        { ...cheque, numero: "1" },
        { ...cheque, numero: "2" },
      ],
    });
    const checkIds = (db.checks ?? []).map((c) => c.id);
    expect(checkIds).toHaveLength(2);
    expect(attachments().map((a) => a.check_id)).toEqual(checkIds);
    expect(attachments().every((a) => a.kind === "foto_cheque")).toBe(true);
  });
});

describe("scanDocumentAction", () => {
  function scanForm(declaredType?: string) {
    const fd = new FormData();
    fd.append(
      "file",
      new File(["%PDF-1.4"], "factura.pdf", { type: "application/pdf" }),
    );
    if (declaredType) fd.append("declaredType", declaredType);
    return fd;
  }

  it("forwards a declared type so classification is skipped", async () => {
    db.files = [];
    const res = await scanDocumentAction(scanForm("purchase_invoice"));
    expect(res.ok).toBe(true);
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ declared_type: "purchase_invoice" }),
      }),
    );
  });

  it("rejects an unknown declared type", async () => {
    const res = await scanDocumentAction(scanForm("nope"));
    expect(res.ok).toBe(false);
    expect(inngestSend).not.toHaveBeenCalled();
  });
});

describe("discardExtractionAction", () => {
  it("discards a pending draft and audits it", async () => {
    seed("receipt", {});
    const res = await discardExtractionAction(EXTRACTION_ID);
    expect(res).toEqual({ ok: true, data: undefined });
    expect(extraction()).toMatchObject({ status: "discarded" });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it("fails without auditing when nothing was discarded", async () => {
    seed("receipt", {});
    const row = extraction();
    if (row) row.status = "confirmed";
    const res = await discardExtractionAction(EXTRACTION_ID);
    expect(res.ok).toBe(false);
    expect(extraction()).toMatchObject({ status: "confirmed" });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("createSalesInvoiceFromExtractionAction", () => {
  const CLIENT_ID = "33333333-3333-4333-8333-333333333333";

  function seedUsdSale() {
    seed("sales_invoice", { client_id: CLIENT_ID });
    const ext = extraction();
    if (ext) {
      ext.payload = {
        date: "2026-10-16",
        currency: "USD",
        net_amount: 100,
        iva_amount: 21,
        total_amount: 121,
        items: [],
      };
    }
    db.invoicing_channels = [{ id: "ch1", is_fiscal: true }];
    db.clients = [
      {
        id: CLIENT_ID,
        cuit: "30712345678",
        iva_condition: "responsable_inscripto",
      },
    ];
  }

  it("refuses a USD invoice when there is no exchange rate for its date", async () => {
    seedUsdSale();
    vi.mocked(getUsdRateForDateAction).mockResolvedValue({
      ok: true,
      data: { rate: null },
    });

    const res = await createSalesInvoiceFromExtractionAction({
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
      puntoVenta: 3,
    });

    expect(res.ok).toBe(false);
    expect(vi.mocked(issueFiscalInvoiceAction)).not.toHaveBeenCalled();
    expect(extraction()?.status).toBe("pending_review");
  });
});
