import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

// listPendingComprobantesForClientAction (and the FIFO auto-allocation of
// createReceiptAction) over an in-memory client: the reads are plain filtered
// selects, so a minimal query builder covers them.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  const builder = {
    select: () => builder,
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    },
    in: (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return builder;
    },
    not: (col: string, _op: string, v: unknown) => {
      filters.push((r) => (r[col] ?? null) !== v);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({
      data:
        (db[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null,
      error: null,
    }),
    range: async () => ({
      data: (db[table] ?? []).filter((r) => filters.every((f) => f(r))),
      error: null,
    }),
  };
  return builder;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
const rpc = vi.fn(async () => ({ data: "new-receipt", error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, rpc }),
}));
vi.mock("@/lib/supabase/paginate", () => ({
  paginateRange: async (
    page: (from: number, to: number) => Promise<{ data: Row[]; error: null }>,
  ) => page(0, 999),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { createReceiptAction, listPendingComprobantesForClientAction } =
  await import("./receipts-actions");

const CLIENT = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const FISCAL = "jouve_fiscal";
const INTERNAL = "jouve_internal";

function invoice(
  id: string,
  kind: string,
  total: number,
  origin?: string,
  emittedAt = "2026-10-01T12:00:00+00:00",
  channelId = FISCAL,
  fecha = "2026-10-01",
) {
  return {
    channel_id: channelId,
    emitted_at: emittedAt,
    created_at: emittedAt,
    id,
    client_id: CLIENT,
    status: "emitted",
    kind,
    numero: 1,
    punto_venta: 3,
    letter: "A",
    fecha,
    imp_total: total,
    invoice_origin_id: origin ?? null,
  };
}

describe("listPendingComprobantesForClientAction", () => {
  it("offers facturas net of their NCs and never offers the NC itself", async () => {
    db.invoices = [
      invoice("fa", "factura", 1000),
      invoice("nc", "nc", 400, "fa"),
      invoice("fb", "factura", 500),
      invoice("nc2", "nc", 500, "fb"),
    ];
    db.receipt_allocations = [];
    db.client_opening_balance_allocations = [];

    const res = await listPendingComprobantesForClientAction(CLIENT, FISCAL);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((d) => [d.id, d.outstanding])).toEqual([["fa", 600]]);
  });
});

describe("editing a receipt that paid an invoice before a credit note", () => {
  it("keeps the invoice available to that receipt", async () => {
    db.invoices = [
      invoice("fa", "factura", 1000),
      invoice("nc", "nc", 400, "fa", "2026-10-10T12:00:00+00:00"),
    ];
    db.receipts = [{ id: "r1", created_at: "2026-10-05T12:00:00+00:00" }];
    db.receipt_allocations = [];
    db.client_opening_balance_allocations = [];

    const editing = await listPendingComprobantesForClientAction(
      CLIENT,
      FISCAL,
      "r1",
    );
    expect(
      editing.ok && editing.data.map((d) => [d.id, d.outstanding]),
    ).toEqual([["fa", 1000]]);

    const fresh = await listPendingComprobantesForClientAction(CLIENT, FISCAL);
    expect(fresh.ok && fresh.data.map((d) => [d.id, d.outstanding])).toEqual([
      ["fa", 600],
    ]);
  });
});

describe("a receipt only settles comprobantes of its own channel", () => {
  it("lists only the channel's pending comprobantes", async () => {
    db.invoices = [
      invoice("fiscal", "factura", 1000),
      invoice("internal", "factura", 300, undefined, undefined, INTERNAL),
    ];
    db.receipt_allocations = [];
    db.client_opening_balance_allocations = [];

    const internal = await listPendingComprobantesForClientAction(
      CLIENT,
      INTERNAL,
    );
    expect(internal.ok && internal.data.map((d) => d.id)).toEqual(["internal"]);
  });

  it("auto-allocates oldest first within the receipt's channel only", async () => {
    db.invoices = [
      invoice(
        "old-fiscal",
        "factura",
        1000,
        undefined,
        undefined,
        FISCAL,
        "2026-08-01",
      ),
      invoice(
        "old-internal",
        "factura",
        200,
        undefined,
        undefined,
        INTERNAL,
        "2026-09-01",
      ),
      invoice(
        "new-internal",
        "factura",
        500,
        undefined,
        undefined,
        INTERNAL,
        "2026-10-01",
      ),
    ];
    db.receipt_allocations = [];
    db.client_opening_balance_allocations = [];
    db.sales_points = [{ numero: 1, channel_id: INTERNAL, is_enabled: true }];
    rpc.mockClear();

    const res = await createReceiptAction({
      channel_id: INTERNAL,
      numero: 1,
      client_id: CLIENT,
      receipt_date: "2026-10-15",
      total_amount: 400,
      currency: "ARS",
      payment_lines: [
        { account_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", amount: 400 },
      ],
    });

    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "create_receipt",
      expect.objectContaining({
        p_channel_id: INTERNAL,
        p_allocations: [
          { invoice_id: "old-internal", amount_applied: 200 },
          { invoice_id: "new-internal", amount_applied: 200 },
        ],
      }),
    );
  });
});
