import { describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

function debt(i: number, paid: boolean) {
  return {
    id: `${paid ? "paid" : "pend"}-${String(i).padStart(4, "0")}`,
    check_id: "c1",
    amount: "100",
    currency: "ARS",
    rejected_on: "2026-10-01",
    paid_at: paid ? "2026-10-15T00:00:00Z" : null,
    check: { check_number: "1", bank_name: "Banco" },
    sale: { buyer_name: "Financiera" },
  };
}
// More pending debts than the old blended cap of 200.
const pendingRows = Array.from({ length: 250 }, (_, i) => debt(i, false));
const paidRows = Array.from({ length: 150 }, (_, i) => debt(i, true));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: () => {
      let paid: boolean | null = null;
      const chain = {
        select: () => chain,
        order: () => chain,
        is: () => {
          paid = false;
          return chain;
        },
        not: () => {
          paid = true;
          return chain;
        },
        range: async (from: number, to: number) => ({
          data: (paid ? paidRows : pendingRows).slice(from, to + 1),
          error: null,
        }),
        limit: async (n: number) => ({
          data: (paid ? paidRows : pendingRows).slice(0, n),
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const { listCheckSaleDebtsAction } =
  await import("./check-sale-followups-actions");

describe("listCheckSaleDebtsAction", () => {
  it("returns every pending debt, then up to 100 paid", async () => {
    const res = await listCheckSaleDebtsAction();
    if (!res.ok) throw new Error(res.error);
    const pending = res.data.filter((d) => d.paid_at === null);
    const paid = res.data.filter((d) => d.paid_at !== null);
    expect(pending).toHaveLength(250);
    expect(paid).toHaveLength(100);
    expect(res.data[0]?.paid_at).toBeNull();
  });
});
