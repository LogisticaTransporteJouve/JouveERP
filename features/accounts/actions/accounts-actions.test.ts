import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let updateError: unknown = null;
const rpc = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: () => ({ eq: async () => ({ error: updateError }) }),
    }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { getAccountHasMovementsAction, updateAccountAction } =
  await import("./accounts-actions");

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  roles = ["finance"];
  updateError = null;
  rpc.mockReset();
});

describe("updateAccountAction", () => {
  it("shows the guard's message when the account has movements", async () => {
    const message =
      'No se puede cambiar el saldo inicial de una cuenta con movimientos: usá "Ajustar saldo", que lo corrige con fecha';
    updateError = { message, code: "23514", hint: "jouve_guard" };
    expect(await updateAccountAction({ id: ID, opening_balance: 10 })).toEqual({
      ok: false,
      error: message,
    });
  });
});

describe("getAccountHasMovementsAction", () => {
  it("reads account_has_movements", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await getAccountHasMovementsAction(ID)).toEqual({
      ok: true,
      data: true,
    });
    expect(rpc).toHaveBeenCalledWith("account_has_movements", {
      p_account_id: ID,
    });
  });

  it("a failed read is an error, not 'no movements'", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await getAccountHasMovementsAction(ID)).ok).toBe(false);
  });

  it("needs accounts:write", async () => {
    roles = ["operations"];
    expect((await getAccountHasMovementsAction(ID)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
