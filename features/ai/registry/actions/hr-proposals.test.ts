import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, userCan } from "@/lib/auth/permissions";

const searchEmployeesAction = vi.fn();
const createEmployee = vi.fn();
const updateEmployee = vi.fn();

vi.mock("@/features/hr/actions/employees-actions", () => ({
  searchEmployeesAction,
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: vi.fn(),
}));
vi.mock("@/lib/channels", () => ({ readInvoicingChannels: vi.fn() }));
vi.mock("@/lib/commands/create-employee", () => ({ createEmployee }));
vi.mock("@/lib/commands/update-employee", () => ({ updateEmployee }));
const getAttendanceMonthAction = vi.fn();
const upsertAttendance = vi.fn();
vi.mock("@/features/hr/actions/attendance-actions", () => ({
  getAttendanceMonthAction,
}));
vi.mock("@/lib/commands/upsert-attendance", () => ({ upsertAttendance }));

const { proposeAttendance, proposeCreateEmployee, proposeUpdateEmployee } =
  await import("./hr-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const EMP = "00000000-0000-4000-8000-000000000001";

const perez = {
  id: EMP,
  legal_name: "Pérez Juan",
  position: "Chofer / Acompañante",
  cuil: "20123456789",
  cbu: null,
  pay_frequency: "mensual",
  base_salary: 800000,
  viatico_monthly: 50000,
  is_monotributo: false,
  hire_date: "2024-03-01",
  notes: null,
  convenio: null,
  categoria: null,
  obra_social: null,
  art: null,
  retribucion_formal: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  searchEmployeesAction.mockResolvedValue({
    ok: true,
    data: { employees: [perez], nextOffset: null },
  });
});

describe("proposeCreateEmployee", () => {
  it("is gated like the employee form (hr:write) plus the search", () => {
    expect(proposeCreateEmployee.permissions).toEqual(["hr:write", "hr:read"]);
  });

  it("drafts the form's fields with its defaults", async () => {
    searchEmployeesAction.mockResolvedValue({
      ok: true,
      data: { employees: [], nextOffset: null },
    });
    const res = await proposeCreateEmployee.proposal?.prepareDraft(ctx, {
      legal_name: "Gómez Ana",
      cuil: "27-12345678-9",
      hire_date: "2026-11-02",
      base_salary: 700000,
    });
    expect(res?.kind).toBe("draft");
    if (res?.kind !== "draft") return;
    expect(res.draft).toMatchObject({
      legal_name: "Gómez Ana",
      cuil: "27123456789",
      pay_frequency: "mensual",
      viatico_monthly: 0,
      is_monotributo: false,
    });
    expect(res.summary).toContainEqual({
      label: "Sueldo base",
      value: expect.stringContaining("700.000"),
    });
  });

  it("drafts the vacation days for an HR admin, as the form", async () => {
    searchEmployeesAction.mockResolvedValue({
      ok: true,
      data: { employees: [], nextOffset: null },
    });
    const res = await proposeCreateEmployee.proposal?.prepareDraft(
      { userId: "u1", access: resolveAccess(["owner"]) },
      {
        legal_name: "Gómez Ana",
        hire_date: "2020-02-01",
        vacation_current_days: 21,
        vacation_previous_days: 4,
      },
    );
    expect(res?.kind).toBe("draft");
    if (res?.kind !== "draft") return;
    expect(res.draft).toMatchObject({
      vacation_current_days: 21,
      vacation_previous_days: 4,
    });
    expect(res.summary).toContainEqual({
      label: "Vacaciones del período en curso",
      value: "21 días",
    });
  });

  it("refuses the vacation days without hr:admin", async () => {
    expect(userCan(ctx.access, "hr:admin")).toBe(false);
    const res = await proposeCreateEmployee.proposal?.prepareDraft(ctx, {
      legal_name: "Gómez Ana",
      hire_date: "2026-11-02",
      vacation_current_days: 14,
    });
    expect(res).toEqual({
      kind: "error",
      error:
        "Solo un administrador de RRHH puede cargar los días de vacaciones del alta.",
    });
  });

  it("asks instead of drafting a CUIL that already has an employee", async () => {
    const res = await proposeCreateEmployee.proposal?.prepareDraft(ctx, {
      legal_name: "Pérez Juan",
      cuil: "20123456789",
      hire_date: "2026-11-02",
    });
    expect(res).toMatchObject({
      kind: "issues",
      issues: [{ field: "cuil", message: expect.stringContaining("Pérez") }],
    });
  });

  it("runs the form's command as the user", async () => {
    createEmployee.mockResolvedValue({ ok: true, data: { id: EMP } });
    const res = await proposeCreateEmployee.proposal?.executeDraft(ctx, {
      legal_name: "Gómez Ana",
      pay_frequency: "mensual",
      viatico_monthly: 0,
      is_monotributo: false,
      hire_date: "2026-11-02",
    });
    expect(res).toEqual({ ok: true, data: { id: EMP } });
    expect(createEmployee).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ legal_name: "Gómez Ana" }),
    );
  });
});

describe("proposeUpdateEmployee", () => {
  it("drafts the whole form, as the edit dialog sends it, and shows only the change", async () => {
    const res = await proposeUpdateEmployee.proposal?.prepareDraft(ctx, {
      employee: "perez juan",
      base_salary: 900000,
    });
    expect(res?.kind).toBe("draft");
    if (res?.kind !== "draft") return;
    expect(res.draft).toMatchObject({
      id: EMP,
      legal_name: "Pérez Juan",
      viatico_monthly: 50000,
      base_salary: 900000,
    });
    expect(res.summary).toEqual([
      { label: "Empleado", value: "Pérez Juan" },
      {
        label: "Sueldo base",
        value: expect.stringMatching(/800\.000.*→.*900\.000/),
      },
    ]);
  });

  it("asks when nothing would change", async () => {
    const res = await proposeUpdateEmployee.proposal?.prepareDraft(ctx, {
      employee: "Pérez Juan",
      base_salary: 800000,
    });
    expect(res?.kind).toBe("issues");
  });

  it("asks which employee when the name matches several", async () => {
    searchEmployeesAction.mockResolvedValue({
      ok: true,
      data: {
        employees: [perez, { ...perez, id: "x", legal_name: "Pérez Luis" }],
        nextOffset: null,
      },
    });
    const res = await proposeUpdateEmployee.proposal?.prepareDraft(ctx, {
      employee: "Pérez",
      notes: "Turno noche",
    });
    expect(res).toMatchObject({
      kind: "issues",
      candidates: [{ field: "employee" }],
    });
  });

  it("refuses operations (no hr:write) before any read: salaries stay hidden", async () => {
    const res = await proposeUpdateEmployee.execute(
      { userId: "u1", access: resolveAccess(["operations"]) },
      { employee: "Pérez Juan", base_salary: 1 },
      { toolCallId: "t1" },
    );
    expect(res.ok).toBe(false);
    expect(searchEmployeesAction).not.toHaveBeenCalled();
  });
});

describe("proposeAttendance", () => {
  const day = {
    employee: "Pérez Juan",
    date: "2026-11-04",
    kind: "absent_unjustified",
  };
  const record = (source: string) => ({
    id: "r1",
    employee_id: EMP,
    date: "2026-11-04",
    kind: "leave",
    source,
  });

  it("drafts the day and says what manual load it replaces", async () => {
    getAttendanceMonthAction.mockResolvedValue({
      ok: true,
      data: { records: [record("manual")], holidays: [] },
    });
    const res = await proposeAttendance.proposal?.prepareDraft(ctx, day);
    expect(res?.kind).toBe("draft");
    if (res?.kind !== "draft") return;
    expect(res.draft).toEqual({
      employee_id: EMP,
      date: "2026-11-04",
      kind: "absent_unjustified",
      hours_lost: null,
      notes: null,
    });
    expect(res.summary).toContainEqual({
      label: "Reemplaza",
      value: expect.stringContaining("Licencia"),
    });
    expect(getAttendanceMonthAction).toHaveBeenCalledWith(2026, 11);
  });

  it.each(["leave_sync", "holiday_sync"])(
    "does not propose over a day synced from its source (%s)",
    async (source) => {
      getAttendanceMonthAction.mockResolvedValue({
        ok: true,
        data: { records: [record(source)], holidays: [] },
      });
      const res = await proposeAttendance.proposal?.prepareDraft(ctx, day);
      expect(res).toMatchObject({
        kind: "issues",
        issues: [
          {
            field: "date",
            message: expect.stringContaining("se cambia desde"),
          },
        ],
      });
    },
  );

  it("runs the grid's command", async () => {
    upsertAttendance.mockResolvedValue({ ok: true, data: { id: "r2" } });
    const res = await proposeAttendance.proposal?.executeDraft(ctx, {
      employee_id: EMP,
      date: "2026-11-04",
      kind: "late",
      hours_lost: 2,
      notes: null,
    });
    expect(res).toEqual({ ok: true, data: { id: "r2" } });
    expect(upsertAttendance).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ kind: "late", hours_lost: 2 }),
    );
  });
});
