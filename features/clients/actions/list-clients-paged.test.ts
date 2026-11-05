import { describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// listClientsAction feeds the client select of Productos and Tarifas de
// depósito: it pages past PostgREST's 1000-row cap, on a total order.

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  orders: [] as string[],
  failAt: null as number | null,
}));

function from() {
  const builder = {
    select: () => builder,
    order: (col: string) => {
      h.orders.push(col);
      return builder;
    },
    // The server caps every response at 1000 rows, whatever is asked.
    range: async (lo: number, hi: number) =>
      h.failAt === lo
        ? { data: null, error: { message: "boom" } }
        : { data: h.rows.slice(lo, Math.min(hi + 1, lo + 1000)), error: null },
  };
  return builder;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["admin"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { listClientsAction } = await import("./clients-actions");

function seed(n: number) {
  h.rows = Array.from({ length: n }, (_, i) => ({
    id: `c${String(i).padStart(4, "0")}`,
    legal_name: `Cliente ${String(i).padStart(4, "0")}`,
    iva_condition: "responsable_inscripto",
  }));
  h.orders = [];
  h.failAt = null;
}

describe("listClientsAction", () => {
  it("returns every client past the 1000-row cap, ordered by name then id", async () => {
    seed(1500);
    const res = await listClientsAction();
    expect(res.ok && res.data.length).toBe(1500);
    expect(h.orders.slice(0, 2)).toEqual(["legal_name", "id"]);
  });

  it("a failed later page is an error, not a short list", async () => {
    seed(1500);
    h.failAt = 1000;
    const res = await listClientsAction();
    expect(res.ok).toBe(false);
  });
});
