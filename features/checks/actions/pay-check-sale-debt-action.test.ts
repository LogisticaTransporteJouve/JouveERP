import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";

let denied: Permission[] = [];
const rpc = vi.fn(async () => ({ data: "tx-1", error: null }));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));

const { payCheckSaleDebtAction } =
  await import("./check-sale-followups-actions");

const input = {
  debt_id: "00000000-0000-4000-8000-000000000001",
  account_id: "00000000-0000-4000-8000-000000000002",
  payment_date: "2026-11-04",
};

beforeEach(() => {
  denied = [];
  rpc.mockClear();
});

describe("payCheckSaleDebtAction", () => {
  it("refuses a finance user denied transactions:write: paying debits an account", async () => {
    denied = ["transactions:write"];
    const res = await payCheckSaleDebtAction(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a user denied cheques:write", async () => {
    denied = ["cheques:write"];
    expect((await payCheckSaleDebtAction(input)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pays for a user with cheques:write and transactions:write", async () => {
    const res = await payCheckSaleDebtAction(input);
    expect(res).toEqual({ ok: true, data: { transaction_id: "tx-1" } });
    expect(rpc).toHaveBeenCalledWith("pay_check_sale_debt", {
      p_debt_id: input.debt_id,
      p_account_id: input.account_id,
      p_payment_date: input.payment_date,
      p_user_id: "u1",
    });
  });
});
