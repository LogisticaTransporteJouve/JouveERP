import { beforeEach, describe, expect, it, vi } from "vitest";

const logAudit = vi.fn();
const insert = vi.fn();
let account: Record<string, unknown> | null;
let balances: { id: string; saldo: number; employee_id: string }[];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: account, error: null }),
            }),
          }),
        };
      }
      if (table === "v_payroll_entries_with_payments") {
        return {
          select: () => ({
            in: async () => ({ data: balances, error: null }),
          }),
        };
      }
      return {
        insert: (rows: unknown) => {
          insert(rows);
          const ids = Array.isArray(rows)
            ? rows.map((_, i) => ({ id: `p${i}` }))
            : [{ id: "p0" }];
          return {
            select: () =>
              Array.isArray(rows)
                ? Promise.resolve({ data: ids, error: null })
                : { single: async () => ({ data: ids[0], error: null }) },
          };
        },
      };
    },
  }),
}));

const { bulkCreatePayrollPayments, createPayrollPayment } =
  await import("./pay-payroll");

const E1 = "00000000-0000-4000-8000-000000000001";
const E2 = "00000000-0000-4000-8000-000000000002";
const ACC = "00000000-0000-4000-8000-0000000000a1";

const base = {
  account_id: ACC,
  channel_id: "jouve_internal",
  method: "transferencia" as const,
  paid_at: "2026-11-05",
};

beforeEach(() => {
  logAudit.mockReset();
  insert.mockReset();
  account = { id: ACC, is_active: true, currency: "ARS", type: "bank" };
  balances = [
    { id: E1, saldo: 1000, employee_id: "x1" },
    { id: E2, saldo: 500, employee_id: "x2" },
  ];
});

describe("createPayrollPayment", () => {
  it("pays within the balance and audits it", async () => {
    const res = await createPayrollPayment("u1", {
      ...base,
      entry_id: E1,
      amount: 1000,
    });
    expect(res).toEqual({ ok: true, data: { id: "p0" } });
    expect(logAudit).toHaveBeenCalledWith(
      "payroll.payment_created",
      "u1",
      expect.objectContaining({ entry_id: E1, amount: 1000 }),
      "p0",
    );
  });

  it("refuses a USD account before writing", async () => {
    account = { id: ACC, is_active: true, currency: "USD", type: "bank" };
    const res = await createPayrollPayment("u1", {
      ...base,
      entry_id: E1,
      amount: 10,
    });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("bulkCreatePayrollPayments", () => {
  it("writes none when one payment is above its balance", async () => {
    const res = await bulkCreatePayrollPayments("u1", {
      ...base,
      items: [
        { entry_id: E1, amount: 1000 },
        { entry_id: E2, amount: 600 },
      ],
    });
    expect(res).toEqual({
      ok: false,
      error: expect.stringContaining("1 empleado(s)"),
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("writes every payment in one insert and audits the batch", async () => {
    const res = await bulkCreatePayrollPayments("u1", {
      ...base,
      items: [
        { entry_id: E1, amount: 1000 },
        { entry_id: E2, amount: 500 },
      ],
    });
    expect(res).toEqual({ ok: true, data: { inserted: 2 } });
    expect(insert).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledWith(
      "payroll.payment_bulk_created",
      "u1",
      expect.objectContaining({ count: 2, total: 1500 }),
    );
  });
});
