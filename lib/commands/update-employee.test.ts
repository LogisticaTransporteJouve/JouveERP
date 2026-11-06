import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const logAudit = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { updateEmployee } = await import("./update-employee");

const EMP = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  rpc.mockReset();
  logAudit.mockReset();
});

describe("updateEmployee", () => {
  it("audits a salary change on its own event", async () => {
    rpc.mockResolvedValue({
      data: { legal_name: "Pérez Juan", base_salary: 800000 },
      error: null,
    });
    const res = await updateEmployee("u1", { id: EMP, base_salary: 900000 });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "update_employee",
      expect.objectContaining({ p_patch: { base_salary: 900000 } }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "employee.salary_changed",
      "u1",
      { legal_name: "Pérez Juan", from: 800000, to: 900000 },
      EMP,
    );
  });

  it("writes nothing when nothing was sent", async () => {
    const res = await updateEmployee("u1", { id: EMP });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an employee that is not there", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await updateEmployee("u1", { id: EMP, notes: "x" });
    expect(res).toEqual({ ok: false, error: "El empleado no existe." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
