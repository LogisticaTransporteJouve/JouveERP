import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denied: string[] = [];
const rpc = vi.fn();
const audit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));

const { matchLinesToMovementAction } = await import("./reconciliation-actions");

const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";
const TX = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  rpc.mockReset();
  audit.mockReset();
});

describe("matchLinesToMovementAction", () => {
  it("matches the lines through one RPC and audits each line", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await matchLinesToMovementAction({
      line_ids: [L1, L2],
      transaction_id: TX,
    });
    expect(res).toEqual({ ok: true, data: { transaction_id: TX } });
    expect(rpc).toHaveBeenCalledWith("match_bank_statement_lines", {
      p_line_ids: [L1, L2],
      p_transaction_id: TX,
      p_user_id: "u1",
    });
    expect(audit.mock.calls.map((c) => [c[0], c[3]])).toEqual([
      ["bank_statement_line.matched", L1],
      ["bank_statement_line.matched", L2],
    ]);
  });

  it("needs transactions:write", async () => {
    denied = ["transactions:write"];
    const res = await matchLinesToMovementAction({
      line_ids: [L1],
      transaction_id: TX,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the sum guard's message and audits nothing", async () => {
    const message = "Las líneas suman 900,00 y el movimiento 1.000,00";
    rpc.mockResolvedValue({
      data: null,
      error: { message, code: "22023", hint: "jouve_guard" },
    });
    const res = await matchLinesToMovementAction({
      line_ids: [L1, L2],
      transaction_id: TX,
    });
    expect(res).toEqual({ ok: false, error: message });
    expect(audit).not.toHaveBeenCalled();
  });
});
