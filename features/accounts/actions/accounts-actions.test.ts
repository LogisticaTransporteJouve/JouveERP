import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let updateError: unknown = null;
/** Rows the update matched. */
let updatedRows: { id: string }[] = [];
const logAudit = vi.fn();
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
      update: () => ({
        eq: () => ({
          select: async () => ({
            data: updateError ? null : updatedRows,
            error: updateError,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const {
  getAccountHasMovementsAction,
  setAccountActiveAction,
  updateAccountAction,
} = await import("./accounts-actions");

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  roles = ["finance"];
  updateError = null;
  updatedRows = [{ id: ID }];
  rpc.mockReset();
  logAudit.mockReset();
});

describe("an account that is gone (no row matched)", () => {
  const notFound = {
    ok: false,
    error: "No se encontró la cuenta. Actualizá la página.",
  };

  it("an edit says so and audits nothing", async () => {
    updatedRows = [];
    expect(await updateAccountAction({ id: ID, name: "Caja" })).toEqual(
      notFound,
    );
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("a deactivation says so and audits nothing", async () => {
    updatedRows = [];
    expect(await setAccountActiveAction({ id: ID, is_active: false })).toEqual(
      notFound,
    );
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("an edit that matched audits it", async () => {
    expect((await updateAccountAction({ id: ID, name: "Caja" })).ok).toBe(true);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });
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
