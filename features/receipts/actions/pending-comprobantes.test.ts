import { describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

// listPendingComprobantesForClientAction over an in-memory client: the reads
// are plain filtered selects, so a minimal query builder covers them.

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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
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

const { listPendingComprobantesForClientAction } =
  await import("./receipts-actions");

const CLIENT = "c1";

function invoice(
  id: string,
  kind: string,
  total: number,
  origin?: string,
  emittedAt = "2026-10-01T12:00:00+00:00",
) {
  return {
    emitted_at: emittedAt,
    created_at: emittedAt,
    id,
    client_id: CLIENT,
    status: "emitted",
    kind,
    numero: 1,
    punto_venta: 3,
    letter: "A",
    fecha: "2026-10-01",
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

    const res = await listPendingComprobantesForClientAction(CLIENT);

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

    const editing = await listPendingComprobantesForClientAction(CLIENT, "r1");
    expect(
      editing.ok && editing.data.map((d) => [d.id, d.outstanding]),
    ).toEqual([["fa", 1000]]);

    const fresh = await listPendingComprobantesForClientAction(CLIENT);
    expect(fresh.ok && fresh.data.map((d) => [d.id, d.outstanding])).toEqual([
      ["fa", 600],
    ]);
  });
});
