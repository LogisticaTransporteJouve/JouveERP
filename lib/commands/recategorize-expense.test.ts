import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const logAudit = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { recategorizeExpense } = await import("./recategorize-expense");

const PURCHASE = "00000000-0000-4000-8000-000000000001";
const NC = "00000000-0000-4000-8000-000000000002";
const ACCOUNT = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  rpc.mockReset();
  logAudit.mockReset();
});

describe("recategorizeExpense", () => {
  it("audits the purchase's NC/ND that followed it", async () => {
    rpc.mockResolvedValue({
      data: {
        changed: true,
        expense_account_id_before: null,
        expense_account_id: ACCOUNT,
        cost_center_id_before: null,
        cost_center_id: null,
        adjustments: [NC],
      },
      error: null,
    });
    const res = await recategorizeExpense("u1", {
      source: "purchase_invoices",
      id: PURCHASE,
      expense_account_id: ACCOUNT,
    });
    expect(res).toEqual({ ok: true, data: { id: PURCHASE, changed: true } });
    expect(logAudit).toHaveBeenCalledWith(
      "expense.recategorized",
      "u1",
      expect.objectContaining({
        expense_account_id: ACCOUNT,
        adjustment_ids: [NC],
      }),
      PURCHASE,
    );
  });

  it("an answer from older SQL with no adjustments audits none", async () => {
    rpc.mockResolvedValue({
      data: {
        changed: true,
        expense_account_id_before: null,
        expense_account_id: ACCOUNT,
        cost_center_id_before: null,
        cost_center_id: null,
      },
      error: null,
    });
    await recategorizeExpense("u1", {
      source: "transactions",
      id: PURCHASE,
      expense_account_id: ACCOUNT,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "expense.recategorized",
      "u1",
      expect.objectContaining({ adjustment_ids: [] }),
      PURCHASE,
    );
  });
});
