import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmployeeCreateSchema } from "@/features/hr/schema";
import { resolveAccess, type Role } from "@/lib/auth/permissions";

const rpc = vi.fn();
const logAudit = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { createEmployee } = await import("./create-employee");

const EMP = "00000000-0000-4000-8000-000000000001";

const input = EmployeeCreateSchema.parse({
  legal_name: "Pérez Juan",
  position: "Chofer / Acompañante",
  pay_frequency: "mensual",
  base_salary: 900000,
  viatico_monthly: 0,
  is_monotributo: false,
  hire_date: "2026-11-02",
  license_number: "B123",
  vacation_current_days: 14,
});

const actor = (roles: Role[]) => ({
  userId: "u1",
  access: resolveAccess(roles),
});

beforeEach(() => {
  rpc.mockReset();
  logAudit.mockReset();
  rpc.mockResolvedValue({ data: EMP, error: null });
});

describe("createEmployee", () => {
  it("writes the employee, its driver record and the vacation days in one call (hr:admin)", async () => {
    const res = await createEmployee(actor(["admin"]), input);
    expect(res).toEqual({ ok: true, data: { id: EMP } });
    expect(rpc).toHaveBeenCalledWith(
      "create_employee",
      expect.objectContaining({
        p_driver: { license_number: "B123" },
        p_current_days: 14,
      }),
    );
    expect(logAudit.mock.calls.map((c) => c[0])).toEqual([
      "employee.created",
      "employee.vacation_balance_set",
    ]);
  });

  it("leaves the vacation days out for someone without hr:admin", async () => {
    await createEmployee(actor(["finance"]), input);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_current_days: undefined,
      p_previous_days: undefined,
    });
    expect(logAudit.mock.calls.map((c) => c[0])).toEqual(["employee.created"]);
  });

  it("refuses without auditing when the database fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await createEmployee(actor(["admin"]), input);
    expect(res).toEqual({ ok: false, error: "No se pudo crear el empleado." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
