import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const single = vi.fn();
const logAudit = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      upsert: (...args: unknown[]) => {
        upsert(...args);
        return { select: () => ({ single }) };
      },
    }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { upsertAttendance } = await import("./upsert-attendance");

const EMP = "00000000-0000-4000-8000-000000000001";
const day = {
  employee_id: EMP,
  date: "2026-11-04",
  kind: "sick" as const,
  hours_lost: null,
  notes: null,
};

beforeEach(() => {
  upsert.mockReset();
  single.mockReset();
  logAudit.mockReset();
});

describe("upsertAttendance", () => {
  it("writes a manual row for the employee and day, and audits it", async () => {
    single.mockResolvedValue({ data: { id: "r1" }, error: null });
    const res = await upsertAttendance("u1", day);
    expect(res).toEqual({ ok: true, data: { id: "r1" } });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "manual", created_by: "u1" }),
      { onConflict: "employee_id,date" },
    );
    expect(logAudit).toHaveBeenCalledWith(
      "attendance.upserted",
      "u1",
      { employee_id: EMP, date: "2026-11-04", kind: "sick" },
      "r1",
    );
  });

  it("returns the guard's refusal of a synced day and audits nothing", async () => {
    single.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "Ese día lo carga una licencia: cambialo desde la licencia.",
        hint: "jouve_guard",
      },
    });
    const res = await upsertAttendance("u1", day);
    expect(res).toEqual({
      ok: false,
      error: "Ese día lo carga una licencia: cambialo desde la licencia.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
