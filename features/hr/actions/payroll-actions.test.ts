import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = [];
const createClient = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { closePayrollPeriodAction, reopenPayrollPeriodAction } =
  await import("./payroll-actions");

const PERIOD = "00000000-0000-4000-8000-000000000001";

type Result = {
  data: { id: string }[] | null;
  error: { message: string; hint?: string; code?: string } | null;
};

function mockUpdate(result: Result) {
  const eqs: [string, unknown][] = [];
  const update = vi.fn();
  const chain = {
    update: (patch: unknown) => {
      update(patch);
      return chain;
    },
    eq: (col: string, value: unknown) => {
      eqs.push([col, value]);
      return chain;
    },
    select: async () => result,
  };
  createClient.mockResolvedValue({ from: () => chain });
  return { eqs, update };
}

beforeEach(() => {
  roles = ["admin"];
  createClient.mockReset();
  logAudit.mockClear();
});

describe("closePayrollPeriodAction", () => {
  it("closes only a draft period and audits it", async () => {
    const { eqs } = mockUpdate({ data: [{ id: PERIOD }], error: null });
    const res = await closePayrollPeriodAction({ id: PERIOD });
    expect(res.ok).toBe(true);
    expect(eqs).toContainEqual(["status", "draft"]);
    expect(logAudit).toHaveBeenCalledWith(
      "payroll.period_closed",
      "u1",
      {},
      PERIOD,
    );
  });

  it("a period that was already closed is a no-op without audit", async () => {
    mockUpdate({ data: [], error: null });
    const res = await closePayrollPeriodAction({ id: PERIOD });
    expect(res).toEqual({
      ok: false,
      error: "El período ya estaba cerrado o no existe.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("shows a guard's own message", async () => {
    mockUpdate({
      data: null,
      error: { message: "Bloqueado.", hint: "jouve_guard", code: "42501" },
    });
    const res = await closePayrollPeriodAction({ id: PERIOD });
    expect(res).toEqual({ ok: false, error: "Bloqueado." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("reopenPayrollPeriodAction", () => {
  it("reopens only a closed period and audits it", async () => {
    const { eqs } = mockUpdate({ data: [{ id: PERIOD }], error: null });
    const res = await reopenPayrollPeriodAction({ id: PERIOD });
    expect(res.ok).toBe(true);
    expect(eqs).toContainEqual(["status", "closed"]);
    expect(logAudit).toHaveBeenCalledWith(
      "payroll.period_reopened",
      "u1",
      {},
      PERIOD,
    );
  });

  it("a period that was already in draft is a no-op without audit", async () => {
    mockUpdate({ data: [], error: null });
    const res = await reopenPayrollPeriodAction({ id: PERIOD });
    expect(res).toEqual({
      ok: false,
      error: "El período ya estaba en borrador o no existe.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("a database error keeps a generic message", async () => {
    mockUpdate({ data: null, error: { message: "boom" } });
    const res = await reopenPayrollPeriodAction({ id: PERIOD });
    expect(res).toEqual({ ok: false, error: "No se pudo reabrir el período." });
  });
});
