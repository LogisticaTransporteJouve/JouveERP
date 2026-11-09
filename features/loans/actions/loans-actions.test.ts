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
const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));

const {
  adoptInstallmentPaymentAction,
  applyInstallmentStatementAction,
  cancelLoanAction,
  createLoanAction,
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

describe("createLoanAction", () => {
  const input = {
    kind: "prestamo",
    description: "Préstamo camión",
    principal: 1000,
    currency: "ARS",
    channel_id: "jouve_fiscal",
    installments_count: 3,
    first_due_date: "2026-11-10",
  };
  const rpc = vi.fn();
  const from = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    clientOverride = { rpc, from };
  });

  it("writes the loan and its schedule in one RPC, never table by table", async () => {
    rpc.mockResolvedValue({ data: "l9", error: null });
    const res = await createLoanAction(input);
    expect(res).toEqual({ ok: true, data: { id: "l9" } });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_loan", {
      p_loan: expect.objectContaining({
        principal: 1000,
        installments_count: 3,
        lender: null,
        notes: null,
      }),
      p_installments: [
        { number: 1, due_date: "2026-11-10", amount: 333.33 },
        { number: 2, due_date: "2026-12-10", amount: 333.33 },
        { number: 3, due_date: "2027-01-10", amount: 333.34 },
      ],
    });
  });

  it("shows the guard's message when the database refuses it", async () => {
    const message =
      "El cronograma no coincide con la cantidad de cuotas del préstamo";
    rpc.mockResolvedValue({
      data: null,
      error: { message, hint: "jouve_guard" },
    });
    const res = await createLoanAction(input);
    expect(res).toEqual({ ok: false, error: message });
  });

  it("keeps the generic message for any other error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await createLoanAction(input);
    expect(res).toEqual({ ok: false, error: "No se pudo crear el préstamo." });
  });
});

describe("cancelLoanAction", () => {
  function updateReturning(result: {
    data: Array<{ id: string }> | null;
    error: { message: string; hint?: string } | null;
  }) {
    clientOverride = {
      from: () => ({
        update: () => ({
          eq: () => ({
            neq: () => ({ select: async () => result }),
          }),
        }),
      }),
    };
  }
  function failingUpdate(error: { message: string; hint?: string }) {
    updateReturning({ data: null, error });
  }

  it("refuses, without auditing, a loan already cancelled or missing", async () => {
    updateReturning({ data: [], error: null });
    const res = await cancelLoanAction({
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(res).toEqual({
      ok: false,
      error: "El préstamo ya estaba anulado o no existe. Recargá la página.",
    });
  });

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

  it("does not overwrite a cuota paid since it was read", async () => {
    const filters: Array<[string, unknown]> = [];
    const write = {
      eq: (col: string, v: unknown) => {
        filters.push([col, v]);
        return write;
      },
      is: (col: string, v: unknown) => {
        filters.push([col, v]);
        return write;
      },
      // The cuota was paid between the read and the write: no row matches.
      select: async () => ({ data: [], error: null }),
    };
    clientOverride = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { status: "pendiente", capital_amount: null },
              error: null,
            }),
          }),
        }),
        update: () => write,
      }),
    };
    const res = await updateInstallmentAction({
      id: "00000000-0000-4000-8000-000000000001",
      amount: 50,
    });
    expect(res).toEqual({
      ok: false,
      error: "La cuota cambió mientras la editabas. Recargá la página.",
    });
    expect(filters).toEqual([
      ["id", "00000000-0000-4000-8000-000000000001"],
      ["status", "pendiente"],
      ["capital_amount", null],
    ]);
  });
});

describe("applyInstallmentStatementAction", () => {
  const statement = {
    loan_id: "00000000-0000-4000-8000-000000000001",
    operation: "139499",
    installment_number: 21,
    capital: 2190131.3,
    interest: 2178903.39,
    iva: 917497.28,
    charges: [
      {
        concept: "seguro",
        description: "Seguro automotor",
        amount: 381897.45,
        iva_amount: 76452.3,
      },
    ],
  };
  // loans → loan_number; loan_installments → the cuota.
  function client(loanNumber: string, cuota: { id: string; status: string }) {
    const row = (table: string) =>
      table === "loans" ? { loan_number: loanNumber } : cuota;
    return {
      from: (table: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: row(table), error: null }),
        };
        return q;
      },
    };
  }

  beforeEach(() => rpc.mockReset());

  it("sets the pending cuota from the statement, through the gated RPC", async () => {
    clientOverride = client("139499", { id: "c21", status: "pendiente" });
    rpc.mockResolvedValue({ data: 5744881.72, error: null });
    const res = await applyInstallmentStatementAction(statement);
    expect(res).toEqual({
      ok: true,
      data: { installment_number: 21, amount: 5744881.72 },
    });
    expect(rpc).toHaveBeenCalledWith("set_loan_installment_charges", {
      p_installment_id: "c21",
      p_split: {
        capital: 2190131.3,
        interest: 2178903.39,
        iva: 917497.28,
        perception: 0,
      },
      p_charges: statement.charges,
    });
  });

  it("refuses a statement of another contract", async () => {
    clientOverride = client("140000", { id: "c21", status: "pendiente" });
    const res = await applyInstallmentStatementAction(statement);
    expect(res).toEqual({
      ok: false,
      error: "El resumen es de la operación 139499, no de 140000.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a cuota already paid", async () => {
    clientOverride = client("139499", { id: "c21", status: "pagada" });
    const res = await applyInstallmentStatementAction(statement);
    expect(res).toEqual({ ok: false, error: "La cuota 21 ya está pagada." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs accounting:write", async () => {
    denied = ["accounting:write"];
    const res = await applyInstallmentStatementAction(statement);
    expect(res).toEqual({
      ok: false,
      error: "Sin permiso para editar cuotas.",
    });
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
