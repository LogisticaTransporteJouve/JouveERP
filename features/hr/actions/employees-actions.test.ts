import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const rpc = vi.fn();
const logAudit = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["admin"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../lib/employee-driver", () => ({ readEmployeeDriver: vi.fn() }));

const { terminateEmployeeAction, updateEmployeeAction } =
  await import("./employees-actions");

const EMP = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  rpc.mockReset();
  logAudit.mockClear();
});

describe("terminateEmployeeAction", () => {
  it("terminates in one call that appends the reason to the notes", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await terminateEmployeeAction({
      id: EMP,
      termination_date: "2026-11-05",
      notes: "Renuncia.",
    });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("terminate_employee", {
      p_id: EMP,
      p_termination_date: "2026-11-05",
      p_reason: "Renuncia.",
    });
    expect(logAudit).toHaveBeenCalledWith(
      "employee.terminated",
      "u1",
      { termination_date: "2026-11-05" },
      EMP,
    );
  });

  it("sends no reason when there is none", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await terminateEmployeeAction({
      id: EMP,
      termination_date: "2026-11-05",
      notes: null,
    });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_reason: undefined });
  });

  it("refuses, without auditing, an employee that is not there", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await terminateEmployeeAction({
      id: EMP,
      termination_date: "2026-11-05",
      notes: null,
    });
    expect(res).toEqual({ ok: false, error: "El empleado no existe." });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("does not show the database's own text", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "new row violates check constraint", code: "23514" },
    });
    const res = await terminateEmployeeAction({
      id: EMP,
      termination_date: "2026-11-05",
      notes: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "No se pudo dar de baja al empleado.",
    });
  });
});

describe("updateEmployeeAction", () => {
  it("refuses, without auditing, an employee that is not there", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await updateEmployeeAction({ id: EMP, notes: "Turno noche" });
    expect(res).toEqual({ ok: false, error: "El empleado no existe." });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("audits a salary change against the value before the edit", async () => {
    rpc.mockResolvedValue({
      data: { legal_name: "Ana", base_salary: 100 },
      error: null,
    });
    const res = await updateEmployeeAction({ id: EMP, base_salary: 150 });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "update_employee",
      expect.objectContaining({
        p_id: EMP,
        p_patch: { base_salary: 150 },
        p_driver_position: "Chofer / Acompañante",
        p_driver: {},
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "employee.salary_changed",
      "u1",
      { legal_name: "Ana", from: 100, to: 150 },
      EMP,
    );
  });
});
