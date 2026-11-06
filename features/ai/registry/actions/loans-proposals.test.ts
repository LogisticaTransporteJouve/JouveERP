import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listLoansAction = vi.fn();
const getLoanAction = vi.fn();
const listAccountsAction = vi.fn();
const payLoanInstallment = vi.fn();

vi.mock("@/features/loans/actions/loans-actions", () => ({
  listLoansAction,
  getLoanAction,
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction,
}));
vi.mock("@/features/hr/actions/employees-actions", () => ({
  searchEmployeesAction: vi.fn(),
}));
vi.mock("@/lib/channels", () => ({ readInvoicingChannels: vi.fn() }));
vi.mock("@/lib/commands/pay-loan-installment", () => ({ payLoanInstallment }));

const { proposeLoanInstallmentPayment } = await import("./loans-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const LOAN = "00000000-0000-4000-8000-000000000001";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const ARS = "00000000-0000-4000-8000-0000000000a1";
const USD = "00000000-0000-4000-8000-0000000000a2";

const loan = {
  id: LOAN,
  kind: "leasing",
  description: "Leasing Scania",
  lender: "Banco Galicia",
  currency: "ARS",
  status: "active",
};

function cuota(id: string, number: number, status: string) {
  return {
    id,
    loan_id: LOAN,
    number,
    due_date: `2026-1${number}-10`,
    amount: 250000,
    status,
    split: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listLoansAction.mockResolvedValue({ ok: true, data: [loan] });
  getLoanAction.mockResolvedValue({
    ok: true,
    data: {
      ...loan,
      installments: [cuota(C1, 1, "pagada"), cuota(C2, 2, "pendiente")],
    },
  });
  listAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      {
        id: ARS,
        name: "Galicia pesos",
        type: "bank",
        currency: "ARS",
        is_active: true,
      },
      {
        id: USD,
        name: "Galicia dólares",
        type: "bank",
        currency: "USD",
        is_active: true,
      },
    ],
  });
});

describe("proposeLoanInstallmentPayment", () => {
  it("is gated like Pagar cuota plus the loans read", () => {
    expect([...proposeLoanInstallmentPayment.permissions].sort()).toEqual(
      [
        "accounting:read",
        "accounting:write",
        "accounts:read",
        "transactions:write",
      ].sort(),
    );
  });

  it("pays the next pending cuota for its amount from an account in the loan's currency", async () => {
    const res = await proposeLoanInstallmentPayment.proposal?.prepareDraft(
      ctx,
      { loan: "scania", account: "galicia", paid_date: "2026-11-05" },
    );
    expect(res).toMatchObject({
      kind: "draft",
      draft: {
        id: C2,
        amount: 250000,
        account_id: ARS,
        paid_date: "2026-11-05",
      },
    });
  });

  it("refuses a cuota already paid", async () => {
    const res = await proposeLoanInstallmentPayment.proposal?.prepareDraft(
      ctx,
      { loan: "Banco Galicia", installment_number: 1, account: "galicia" },
    );
    expect(res).toMatchObject({
      kind: "issues",
      issues: [{ message: "La cuota 1 ya está pagada." }],
    });
  });

  it("is not offered to operations", async () => {
    const res = await proposeLoanInstallmentPayment.execute(
      { userId: "u1", access: resolveAccess(["operations"]) },
      { loan: "scania", account: "galicia" },
      { toolCallId: "t1" },
    );
    expect(res.ok).toBe(false);
    expect(listLoansAction).not.toHaveBeenCalled();
  });

  it("returns the Caja movement of the paid cuota", async () => {
    payLoanInstallment.mockResolvedValue({
      ok: true,
      data: { transactionId: "tx-1" },
    });
    const res = await proposeLoanInstallmentPayment.proposal?.executeDraft(
      ctx,
      { id: C2, paid_date: "2026-11-05", account_id: ARS, amount: 250000 },
    );
    expect(res).toEqual({ ok: true, data: { id: "tx-1" } });
  });
});
