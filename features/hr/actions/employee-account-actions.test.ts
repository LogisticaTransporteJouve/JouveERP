import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Permission,
  type Role,
  resolveAccess,
} from "@/lib/auth/permissions";

let roles: Role[] = [];
let denied: Permission[] = [];
const rpc = vi.fn(async () => ({ data: "mov-1", error: null }));
const insert = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => ({
      insert: (row: unknown) => {
        insert(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "mov-2" }, error: null }),
          }),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { createManualMovementAction, recordEmployeeAccountCashAction } =
  await import("./employee-account-actions");

const EMP = "00000000-0000-4000-8000-000000000001";
const ACC = "00000000-0000-4000-8000-000000000002";

const advance = {
  employee_id: EMP,
  kind: "advance",
  account_id: ACC,
  channel_id: "jouve_internal",
  date: "2026-11-03",
  amount: 150000,
  installment_amount: 50000,
};

beforeEach(() => {
  roles = [];
  denied = [];
  rpc.mockClear();
  insert.mockClear();
  logAudit.mockClear();
});

describe("recordEmployeeAccountCashAction", () => {
  it("needs hr:write and transactions:write", async () => {
    for (const [r, d] of [
      [["operations"], []],
      [["finance"], ["transactions:write"]],
      [["finance"], ["hr:write"]],
    ] as const) {
      roles = [...r];
      denied = [...d];
      const res = await recordEmployeeAccountCashAction(advance);
      expect(res.ok).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records an advance that opens a plan and audits it", async () => {
    roles = ["finance"];
    const res = await recordEmployeeAccountCashAction(advance);
    expect(res).toEqual({ ok: true, data: { id: "mov-1" } });
    expect(rpc).toHaveBeenCalledWith("record_employee_account_cash", {
      p_employee_id: EMP,
      p_kind: "advance",
      p_account_id: ACC,
      p_channel_id: "jouve_internal",
      p_date: "2026-11-03",
      p_amount: 150000,
      p_installment_amount: 50000,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "employee.advance_recorded",
      "u1",
      expect.objectContaining({ employee_id: EMP, amount: 150000 }),
      "mov-1",
    );
  });

  it("refuses an advance against an existing plan before the database", async () => {
    roles = ["finance"];
    const res = await recordEmployeeAccountCashAction({
      ...advance,
      installment_amount: null,
      plan_id: "00000000-0000-4000-8000-000000000003",
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("createManualMovementAction", () => {
  it("needs hr:write", async () => {
    roles = ["finance"];
    denied = ["hr:write"];
    const res = await createManualMovementAction({
      employee_id: EMP,
      kind: "charge",
      currency: "USD",
      amount: 500,
      movement_date: "2026-11-01",
      description: "Deuda con socio",
      creditor: "socio",
    });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("writes a charge owed to a partner", async () => {
    roles = ["admin"];
    const res = await createManualMovementAction({
      employee_id: EMP,
      kind: "charge",
      currency: "USD",
      amount: "500",
      movement_date: "2026-11-01",
      description: "Deuda con socio",
      creditor: "socio",
    });
    expect(res).toEqual({ ok: true, data: { id: "mov-2" } });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "charge",
        currency: "USD",
        amount: 500,
        creditor: "socio",
        plan_id: null,
        created_by: "u1",
      }),
    );
  });
});
