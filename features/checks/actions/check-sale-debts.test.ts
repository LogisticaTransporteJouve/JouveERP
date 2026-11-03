import { describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

type Row = Record<string, unknown>;

const MAX_ROWS = 1000;

function debt(id: number, paid: boolean): Row {
  return {
    id: `d${id}`,
    check_id: `c${id}`,
    amount: "10.00",
    currency: "ARS",
    rejected_on: "2026-10-01",
    paid_at: paid ? "2026-10-05T10:00:00Z" : null,
    check: { check_number: String(id), bank_name: "Banco" },
    sale: { buyer_name: "Comprador" },
  };
}

const pending = Array.from({ length: 1205 }, (_, i) => debt(i, false));
const paid = Array.from({ length: 3 }, (_, i) => debt(5000 + i, true));

// PostgREST caps every response at max_rows; the pending read is the one that
// filters paid_at is null.
function query() {
  let onlyPending = false;
  let window: [number, number] = [0, MAX_ROWS - 1];
  const b = {
    select: () => b,
    is: () => {
      onlyPending = true;
      return b;
    },
    not: () => b,
    order: () => b,
    limit: () => b,
    range: (from: number, to: number) => {
      window = [from, to];
      return b;
    },
    then<T>(resolve: (v: { data: Row[]; error: null }) => T): T {
      const rows = onlyPending ? pending : paid;
      const [from, to] = window;
      return resolve({
        data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)),
        error: null,
      });
    },
  };
  return b;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: query }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { listCheckSaleDebtsAction } =
  await import("./check-sale-followups-actions");

describe("listCheckSaleDebtsAction", () => {
  it("lists every pending debt past max_rows, then the paid ones", async () => {
    const res = await listCheckSaleDebtsAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.filter((d) => d.paid_at === null)).toHaveLength(1205);
    expect(res.data.filter((d) => d.paid_at !== null)).toHaveLength(3);
    expect(res.data.at(-1)?.id).toBe("d5002");
  });
});
