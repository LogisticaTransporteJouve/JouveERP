import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Permission,
  type Role,
  resolveAccess,
} from "@/lib/auth/permissions";

let roles: Role[] = [];
let denied: Permission[] = [];
const createClient = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const {
  bulkCreatePayrollPaymentsAction,
  createPayrollPaymentAction,
  deletePayrollPaymentAction,
  updatePayrollPaymentAction,
} = await import("./payroll-payments-actions");

const ENTRY = "00000000-0000-4000-8000-000000000001";
const ACC = "00000000-0000-4000-8000-000000000002";
const PAY = "00000000-0000-4000-8000-000000000003";

const payment = {
  account_id: ACC,
  channel_id: "jouve_internal",
  amount: 1000,
  method: "transferencia",
  paid_at: "2026-11-04",
};

const writes = {
  create: () => createPayrollPaymentAction({ ...payment, entry_id: ENTRY }),
  update: () => updatePayrollPaymentAction({ ...payment, id: PAY }),
  bulk: () =>
    bulkCreatePayrollPaymentsAction({
      ...payment,
      items: [{ entry_id: ENTRY, amount: 1000 }],
    }),
  delete: () => deletePayrollPaymentAction({ id: PAY }),
};

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  createClient.mockReset();
  logAudit.mockClear();
});

describe("payroll payments move treasury money", () => {
  it.each(Object.keys(writes) as (keyof typeof writes)[])(
    "%s refuses a finance user denied transactions:write before the database",
    async (name) => {
      denied = ["transactions:write"];
      const res = await writes[name]();
      expect(res.ok).toBe(false);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(writes) as (keyof typeof writes)[])(
    "%s refuses a user without hr:write",
    async (name) => {
      denied = ["hr:write"];
      expect((await writes[name]()).ok).toBe(false);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("deletes a payment for a user with hr:write and transactions:write", async () => {
    const eq = vi.fn(() => ({
      select: async () => ({ data: [{ id: PAY }], error: null }),
    }));
    createClient.mockResolvedValue({
      from: () => ({ delete: () => ({ eq }) }),
    });
    const res = await deletePayrollPaymentAction({ id: PAY });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(eq).toHaveBeenCalledWith("id", PAY);
    expect(logAudit).toHaveBeenCalledWith(
      "payroll.payment_deleted",
      "u1",
      {},
      PAY,
    );
  });
});
