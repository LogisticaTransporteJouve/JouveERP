import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";
import { pagedSupabase } from "@/tests/helpers/paged-supabase";

let roles: Role[] = ["finance"];
let denied: string[] = [];
let fake = pagedSupabase({});
let clientOverride: unknown = null;

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clientOverride ?? fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const {
  adoptInstallmentPaymentAction,
  cancelLoanAction,
  listLoansAction,
  payInstallmentAction,
  recordLoanDisbursementAction,
  updateInstallmentAction,
} = await import("./loans-actions");

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
  denied = [];
  clientOverride = null;
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

describe("cancelLoanAction", () => {
  function failingUpdate(error: { message: string; hint?: string }) {
    clientOverride = {
      from: () => ({
        update: () => ({ eq: async () => ({ error }) }),
      }),
    };
  }

  it("shows the guard's message when the loan has money recorded", async () => {
    const message =
      "No se puede anular el préstamo: tiene el desembolso registrado o cuotas pagadas.";
    failingUpdate({ message, hint: "jouve_guard" });
    const res = await cancelLoanAction({
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(res).toEqual({ ok: false, error: message });
  });

  it("keeps the generic message for any other error", async () => {
    failingUpdate({ message: "boom" });
    const res = await cancelLoanAction({
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(res).toEqual({ ok: false, error: "No se pudo anular el préstamo." });
  });
});

describe("updateInstallmentAction", () => {
  it("reports a failed read as an error, not as a missing installment", async () => {
    clientOverride = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: "timeout" },
            }),
          }),
        }),
      }),
    };
    const res = await updateInstallmentAction({
      id: "00000000-0000-4000-8000-000000000001",
      notes: "x",
    });
    expect(res).toEqual({ ok: false, error: "No se pudo leer la cuota." });
  });
});

describe("loan movements that touch Caja", () => {
  const ID = "00000000-0000-4000-8000-000000000001";
  const ACCOUNT = "00000000-0000-4000-8000-000000000002";
  const TX = "00000000-0000-4000-8000-000000000003";
  const rpc = vi.fn(async () => ({ data: TX, error: null }));
  const calls = [
    [
      "pay a cuota",
      () =>
        payInstallmentAction({
          id: ID,
          paid_date: "2026-11-01",
          account_id: ACCOUNT,
          amount: 10,
        }),
    ],
    [
      "record the disbursement",
      () =>
        recordLoanDisbursementAction({
          loan_id: ID,
          account_id: ACCOUNT,
          date: "2026-11-01",
        }),
    ],
    [
      "link an egreso",
      () => adoptInstallmentPaymentAction({ id: ID, transaction_id: TX }),
    ],
  ] as const;

  beforeEach(() => {
    rpc.mockClear();
    clientOverride = { rpc };
  });

  it.each(calls)(
    "%s is refused without transactions:write",
    async (_name, call) => {
      denied = ["transactions:write"];
      const res = await call();
      expect(res.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each(calls)("%s still runs for plain finance", async (_name, call) => {
    const res = await call();
    expect(res).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
