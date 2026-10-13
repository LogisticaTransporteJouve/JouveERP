import { beforeEach, describe, expect, it, vi } from "vitest";

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
const createPurchaseInvoiceAction = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", roles: ["owner"] }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: query }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: async (...args: unknown[]) => {
    logAudit(...args);
  },
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({
  RateLimitError: class extends Error {},
  enforceRateLimit: async () => undefined,
}));
vi.mock("../lib/chat-store", () => ({ checkAiDailyCap: async () => "ok" }));
vi.mock("@/features/receipts/actions/receipts-actions", () => ({
  createReceiptAction: (input: unknown) => createReceiptAction(input),
}));
vi.mock("@/features/payment-orders/actions/payment-orders-actions", () => ({
  createPaymentOrderAction: (input: unknown) => createPaymentOrderAction(input),
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
  createPurchaseInvoiceFromExtractionAction,
  createPurchaseNoteFromExtractionAction,
  createReceiptFromExtractionAction,
  discardExtractionAction,
} = await import("./actions");

const EXTRACTION_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

function seed(detectedType: string, matches: Row) {
  db.ai_document_extractions = [
    {
      id: EXTRACTION_ID,
      status: "pending_review",
      detected_type: detectedType,
      matches,
      payload: {},
      created_entity: null,
    },
  ];
}

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
  createReceiptAction.mockReset();
  createPaymentOrderAction.mockReset();
  createPurchaseInvoiceAction.mockReset();
  logAudit.mockReset();
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

describe("partial creation keeps the draft claimed", () => {
  const invoicePayload = {
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
  const partial = {
    ok: false,
    error: "Factura cargada pero no se pudieron guardar los ítems.",
    createdId: "pi-1",
  };

  it("links the purchase invoice whose items failed instead of releasing", async () => {
    seed("purchase_invoice", { supplier_id: "s1" });
    const row = extraction();
    if (row) row.payload = invoicePayload;
    createPurchaseInvoiceAction.mockResolvedValueOnce(partial);

    const res = await createPurchaseInvoiceFromExtractionAction({
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
    });
    expect(res).toEqual({ ok: false, error: partial.error });
    expect(extraction()).toMatchObject({
      status: "confirmed",
      created_entity: { table: "purchase_invoices", id: "pi-1" },
    });

    // A retry must not create a second invoice.
    const retry = await createPurchaseInvoiceFromExtractionAction({
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
    });
    expect(retry.ok).toBe(false);
    expect(createPurchaseInvoiceAction).toHaveBeenCalledTimes(1);
  });

  it("links the purchase NC whose items failed instead of releasing", async () => {
    seed("credit_debit_note", { supplier_id: "s1" });
    const row = extraction();
    if (row) row.payload = invoicePayload;
    createPurchaseInvoiceAction.mockResolvedValueOnce(partial);

    const res = await createPurchaseNoteFromExtractionAction({
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
      kind: "nc",
      motivo: "Devolución",
    });
    expect(res).toEqual({ ok: false, error: partial.error });
    expect(extraction()).toMatchObject({
      status: "confirmed",
      created_entity: { table: "purchase_invoices", id: "pi-1" },
    });
  });

  it("still releases a purchase invoice that failed before inserting", async () => {
    seed("purchase_invoice", { supplier_id: "s1" });
    const row = extraction();
    if (row) row.payload = invoicePayload;
    createPurchaseInvoiceAction.mockResolvedValueOnce({
      ok: false,
      error: "No se pudo cargar la factura.",
    });
    await createPurchaseInvoiceFromExtractionAction({
      extractionId: EXTRACTION_ID,
      channelId: "ch1",
    });
    expect(extraction()).toMatchObject({
      status: "pending_review",
      created_entity: null,
    });
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
