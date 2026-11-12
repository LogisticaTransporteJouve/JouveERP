import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

// «Pagar cuota» from a bank line: the cuota takes the bank's split, with
// its perceptions as their total and apart their IVA part.

let roles: Role[] = ["finance"];
const updates: Array<Record<string, unknown>> = [];
const pay = vi.fn();
const match = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/commands/pay-loan-installment", () => ({
  payLoanInstallment: (...args: unknown[]) => pay(...args),
}));
vi.mock("@/lib/commands/match-bank-line", () => ({
  matchBankLine: (...args: unknown[]) => match(...args),
  matchBankLines: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "bank_statement_lines") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: {
              account_id: "a1",
              line_date: "2026-11-10",
              amount: -1150,
              status: "open",
            },
            error: null,
          }),
        };
        return q;
      }
      return {
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            eq: () => ({ eq: async () => ({ error: null }) }),
          };
        },
      };
    },
  }),
}));

const { payLoanInstallmentFromLineAction } =
  await import("./reconciliation-actions");

const LINE = "00000000-0000-4000-8000-000000000001";
const CUOTA = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  roles = ["finance"];
  updates.length = 0;
  pay
    .mockReset()
    .mockResolvedValue({ ok: true, data: { transactionId: "t1" } });
  match.mockReset().mockResolvedValue({ ok: true, data: { line_id: LINE } });
});

describe("payLoanInstallmentFromLineAction", () => {
  it("writes the total of perceptions and apart its IVA part", async () => {
    const res = await payLoanInstallmentFromLineAction({
      line_id: LINE,
      installment_id: CUOTA,
      split: {
        capital: 1000,
        interest: 0,
        late_interest: 0,
        iva: 0,
        taxes: 50,
        iva_perception: 100,
      },
    });
    expect(res.ok).toBe(true);
    expect(updates).toEqual([
      expect.objectContaining({
        amount: 1150,
        perception_amount: 150,
        iva_perception_amount: 100,
      }),
    ]);
  });

  it("refuses a split whose IVA perception leaves it off the debit", async () => {
    const res = await payLoanInstallmentFromLineAction({
      line_id: LINE,
      installment_id: CUOTA,
      split: {
        capital: 1000,
        interest: 0,
        late_interest: 0,
        iva: 0,
        taxes: 50,
        iva_perception: 50,
      },
    });
    expect(res).toEqual({
      ok: false,
      error: "El desglose suma 1100.00 y el débito es 1150.00.",
    });
    expect(updates).toEqual([]);
    expect(pay).not.toHaveBeenCalled();
  });
});
