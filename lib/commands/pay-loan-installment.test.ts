import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const logAudit = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { payLoanInstallment } = await import("./pay-loan-installment");

const CUOTA = "00000000-0000-4000-8000-000000000001";
const ACC = "00000000-0000-4000-8000-0000000000a1";
const pay = {
  id: CUOTA,
  paid_date: "2026-11-05",
  account_id: ACC,
  amount: 1000,
};

beforeEach(() => {
  rpc.mockReset();
  logAudit.mockReset();
});

describe("payLoanInstallment", () => {
  it("pays the cuota in one RPC and audits it on its Caja movement", async () => {
    rpc.mockResolvedValue({ data: "tx-1", error: null });
    const res = await payLoanInstallment("u1", pay);
    expect(res).toEqual({ ok: true, data: { transactionId: "tx-1" } });
    expect(rpc).toHaveBeenCalledWith("pay_loan_installment", {
      p_installment_id: CUOTA,
      p_paid_date: "2026-11-05",
      p_account_id: ACC,
      p_amount: 1000,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "loan.installment_paid",
      "u1",
      { installment_id: CUOTA, amount: 1000 },
      "tx-1",
    );
  });

  it("pays a USD cuota from pesos with the 5-arg signature", async () => {
    rpc.mockResolvedValue({ data: "tx-2", error: null });
    const res = await payLoanInstallment("u1", {
      ...pay,
      amount: 400,
      account_amount: 622000,
    });
    expect(res).toEqual({ ok: true, data: { transactionId: "tx-2" } });
    expect(rpc).toHaveBeenCalledWith("pay_loan_installment", {
      p_installment_id: CUOTA,
      p_paid_date: "2026-11-05",
      p_account_id: ACC,
      p_amount: 400,
      p_account_amount: 622000,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "loan.installment_paid",
      "u1",
      { installment_id: CUOTA, amount: 400, account_amount: 622000 },
      "tx-2",
    );
  });

  it("returns the guard's refusal (a cuota already paid) without auditing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "La cuota ya está pagada.",
        hint: "jouve_guard",
      },
    });
    const res = await payLoanInstallment("u1", pay);
    expect(res).toEqual({ ok: false, error: "La cuota ya está pagada." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
