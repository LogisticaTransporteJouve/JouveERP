import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

// listPendingInvoicesForSupplierAction and the FIFO auto-allocation of
// createPaymentOrderAction over an in-memory client: the reads are plain
// filtered selects, so a minimal query builder covers them.

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

const rpc = vi.fn(async () => ({ data: "new-op", error: null }));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
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

const { createPaymentOrderAction, listPendingInvoicesForSupplierAction } =
  await import("./payment-orders-actions");

const SUPPLIER = "7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";
const FISCAL = "jouve_fiscal";
const INTERNAL = "jouve_internal";

function purchase(id: string, channelId: string, total: number, fecha: string) {
  return {
    id,
    channel_id: channelId,
    supplier_id: SUPPLIER,
    status: "received",
    kind: "factura",
    numero: 1,
    punto_venta: 1,
    letter: null,
    fecha,
    imp_total: total,
  };
}

describe("a payment order only settles purchase invoices of its own channel", () => {
  it("lists only the channel's pending invoices", async () => {
    db.purchase_invoices = [
      purchase("fiscal", FISCAL, 1000, "2026-09-01"),
      purchase("internal", INTERNAL, 300, "2026-09-02"),
    ];
    db.payment_order_allocations = [];

    const res = await listPendingInvoicesForSupplierAction(SUPPLIER, INTERNAL);
    expect(res.ok && res.data.map((d) => d.id)).toEqual(["internal"]);
  });

  it("auto-allocates oldest first within the order's channel only", async () => {
    db.purchase_invoices = [
      purchase("old-fiscal", FISCAL, 1000, "2026-08-01"),
      purchase("old-internal", INTERNAL, 200, "2026-09-01"),
      purchase("new-internal", INTERNAL, 500, "2026-10-01"),
    ];
    db.payment_order_allocations = [];
    db.sales_points = [{ numero: 1, channel_id: INTERNAL, is_enabled: true }];
    rpc.mockClear();

    const res = await createPaymentOrderAction({
      channel_id: INTERNAL,
      numero: 1,
      supplier_id: SUPPLIER,
      payment_date: "2026-10-15",
      total_amount: 400,
      currency: "ARS",
      payment_lines: [
        {
          line_kind: "account",
          account_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
          amount: 400,
        },
      ],
    });

    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "create_payment_order",
      expect.objectContaining({
        p_channel_id: INTERNAL,
        p_allocations: [
          { purchase_invoice_id: "old-internal", amount_applied: 200 },
          { purchase_invoice_id: "new-internal", amount_applied: 200 },
        ],
      }),
    );
  });
});
