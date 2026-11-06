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

const { recordEmployeeAccountCash } = await import("./record-employee-account");

const EMP = "00000000-0000-4000-8000-000000000001";
const ACC = "00000000-0000-4000-8000-0000000000a1";

const advance = {
  employee_id: EMP,
  kind: "advance" as const,
  account_id: ACC,
  channel_id: "jouve_internal",
  date: "2026-11-05",
  amount: 150000,
  description: null,
  plan_id: null,
  installment_amount: 50000,
};

beforeEach(() => {
  rpc.mockReset();
  logAudit.mockReset();
});

describe("recordEmployeeAccountCash", () => {
  it("writes the Caja and account movements in one RPC and audits the advance", async () => {
    rpc.mockResolvedValue({ data: "mov-1", error: null });
    const res = await recordEmployeeAccountCash("u1", advance);
    expect(res).toEqual({ ok: true, data: { id: "mov-1" } });
    expect(rpc).toHaveBeenCalledWith("record_employee_account_cash", {
      p_employee_id: EMP,
      p_kind: "advance",
      p_account_id: ACC,
      p_channel_id: "jouve_internal",
      p_date: "2026-11-05",
      p_amount: 150000,
      p_installment_amount: 50000,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "employee.advance_recorded",
      "u1",
      expect.objectContaining({ amount: 150000, installment_amount: 50000 }),
      "mov-1",
    );
  });

  it("keeps a guard's own message and audits nothing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "El período contable 2026-10 está cerrado.",
        hint: "jouve_guard",
      },
    });
    const res = await recordEmployeeAccountCash("u1", advance);
    expect(res).toEqual({
      ok: false,
      error: "El período contable 2026-10 está cerrado.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("falls back to its own message without a guard", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await recordEmployeeAccountCash("u1", {
      ...advance,
      kind: "payment",
      installment_amount: null,
    });
    expect(res).toEqual({ ok: false, error: "No se pudo registrar el pago." });
  });
});
