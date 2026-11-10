import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denied: string[] = [];
const rpc = vi.fn();
const eqCalls: [string, string][] = [];
let lineRow: { account_id: string } | null = { account_id: "acc" };
let txRows: { id: string }[] = [];

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    rpc,
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: (col: string, val: string) => {
          if (table === "transactions") eqCalls.push([col, val]);
          return q;
        },
        maybeSingle: async () => ({ data: lineRow, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: txRows, error: null }),
      };
      return q;
    },
  }),
}));

const { matchLineToPaymentOrderAction } =
  await import("./reconciliation-actions");

const LINE = "00000000-0000-4000-8000-000000000001";
const OP = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  rpc.mockReset();
  eqCalls.length = 0;
  lineRow = { account_id: "acc" };
  txRows = [];
});

describe("matchLineToPaymentOrderAction", () => {
  it("matches the line with the order's movements in the line's account", async () => {
    txRows = [{ id: "tx1" }];
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await matchLineToPaymentOrderAction({
      line_id: LINE,
      payment_order_id: OP,
    });
    expect(res.ok).toBe(true);
    expect(eqCalls).toEqual([
      ["payment_order_id", OP],
      ["account_id", "acc"],
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "match_bank_statement_line",
      expect.objectContaining({ p_line_id: LINE, p_transaction_ids: ["tx1"] }),
    );
  });

  it("says so when the order paid from another account", async () => {
    const res = await matchLineToPaymentOrderAction({
      line_id: LINE,
      payment_order_id: OP,
    });
    expect(res).toEqual({
      ok: false,
      error:
        "El movimiento de la orden de pago no está en la cuenta del extracto.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs transactions:write", async () => {
    denied = ["transactions:write"];
    const res = await matchLineToPaymentOrderAction({
      line_id: LINE,
      payment_order_id: OP,
    });
    expect(res.ok).toBe(false);
  });
});
