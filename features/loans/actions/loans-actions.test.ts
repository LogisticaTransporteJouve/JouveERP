import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";
import { pagedSupabase } from "@/tests/helpers/paged-supabase";

let roles: Role[] = ["finance"];
let fake = pagedSupabase({});

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { listLoansAction } = await import("./loans-actions");

const loan = {
  id: "l1",
  kind: "prestamo",
  description: "Leasing camión",
  lender: "Banco",
  principal: 100000,
  currency: "ARS",
  channel_id: "dz_internal",
  installments_count: 1300,
  first_due_date: "2026-01-01",
  status: "active",
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  channel: { name: "Interno" },
};

beforeEach(() => {
  roles = ["finance"];
});

describe("listLoansAction", () => {
  it("counts every installment, past the 1000-row response cap", async () => {
    const installments = Array.from({ length: 1300 }, (_, i) => ({
      loan_id: "l1",
      amount: 10,
      status: i < 300 ? "pagada" : "pendiente",
      due_date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      paid_amount: i < 300 ? 10 : null,
    }));
    fake = pagedSupabase({ loans: [loan], loan_installments: installments });
    const res = await listLoansAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]).toMatchObject({
      paid_total: 3000,
      pending_total: 10000,
      pending_count: 1000,
    });
  });

  it("fails rather than report totals without the installments", async () => {
    fake = pagedSupabase(
      { loans: [loan], loan_installments: [] },
      { failOn: "loan_installments" },
    );
    const res = await listLoansAction();
    expect(res.ok).toBe(false);
  });
});
