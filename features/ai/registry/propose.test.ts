import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

import type { AiProposalStore } from "./define";

const searchEmployeesAction = vi.fn();
const listChartOfAccountsAction = vi.fn();
const createLeave = vi.fn();
const createManualJournalEntry = vi.fn();
const upsertManualExchangeRate = vi.fn();
const getUsdReferenceRateAction = vi.fn();
const listVacationBalancesAction = vi.fn();
const listHolidayDatesAction = vi.fn();

vi.mock("@/features/hr/actions/employees-actions", () => ({
  searchEmployeesAction,
}));
vi.mock(
  "@/features/chart-of-accounts/actions/chart-of-accounts-actions",
  () => ({
    listChartOfAccountsAction,
  }),
);
vi.mock("@/lib/commands/create-leave", () => ({ createLeave }));
vi.mock("@/features/hr/actions/vacations-actions", () => ({
  listVacationBalancesAction,
  listHolidayDatesAction,
}));
vi.mock("@/lib/format", async (orig) => ({
  ...(await orig<typeof import("@/lib/format")>()),
  todayInAR: () => "2026-11-06",
}));
vi.mock("@/lib/commands/create-manual-journal-entry", () => ({
  createManualJournalEntry,
}));
vi.mock("@/features/exchange-rates/actions/exchange-rates-actions", () => ({
  getUsdReferenceRateAction,
}));
vi.mock("@/lib/commands/upsert-exchange-rate", () => ({
  upsertManualExchangeRate,
}));

const { proposeExchangeRate, proposeJournalEntry, proposeLeave } =
  await import("./actions/proposals");

const EMP = "11111111-1111-4111-8111-111111111111";
const CAJA = "22222222-2222-4222-8222-222222222222";
const VENTAS = "33333333-3333-4333-8333-333333333333";

function store(): AiProposalStore & {
  createRevision: ReturnType<typeof vi.fn>;
} {
  return {
    createRevision: vi.fn(async () => ({ id: "conf-1", revision: 1 })),
  };
}

const call = { toolCallId: "call-1" };
const ctx = (roles: Role[], proposals?: AiProposalStore) => ({
  userId: "u1",
  access: resolveAccess(roles),
  ...(proposals ? { proposals } : {}),
});

function employee(id: string, legal_name: string) {
  return { id, legal_name, cuil: null, position: "Chofer" };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUsdReferenceRateAction.mockResolvedValue({ ok: true, data: null });
  listVacationBalancesAction.mockResolvedValue({
    ok: true,
    data: [{ period_year: 2026, remaining_days: 14, status: "active" }],
  });
  listHolidayDatesAction.mockResolvedValue({ ok: true, data: [] });
});

const leaveInput = {
  employee: "Ana Pérez",
  start_date: "2026-11-02",
  end_date: "2026-11-06",
  kind: "vacaciones",
};

describe("propose actions", () => {
  it("refuses a role without the write permission and stores nothing", async () => {
    const s = store();
    const res = await proposeLeave.execute(
      ctx(["operations"], s),
      leaveInput,
      call,
    );
    expect(res.ok).toBe(false);
    expect(searchEmployeesAction).not.toHaveBeenCalled();
    expect(s.createRevision).not.toHaveBeenCalled();
  });

  it("refuses outside a chat session (no store)", async () => {
    const res = await proposeLeave.execute(ctx(["finance"]), leaveInput, call);
    expect(res).toMatchObject({ ok: false });
  });

  it("parks a valid draft as a pending revision and writes nothing", async () => {
    searchEmployeesAction.mockResolvedValue({
      ok: true,
      data: { employees: [employee(EMP, "Ana Pérez")], nextOffset: null },
    });
    const s = store();
    const res = await proposeLeave.execute(
      ctx(["finance"], s),
      leaveInput,
      call,
    );
    expect(res).toMatchObject({
      ok: true,
      data: {
        requiresConfirmation: true,
        confirmationId: "conf-1",
        action: "proposeLeave",
        revision: 1,
        draft: { employee_id: EMP, kind: "vacaciones" },
      },
    });
    expect(s.createRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "call-1",
        action: "proposeLeave",
        labels: {
          [EMP]: "Ana Pérez",
          leave_pending_days: "14",
          leave_holidays: "",
        },
      }),
    );
    // A Monday start within the balance: no warning row.
    expect(
      s.createRevision.mock.calls[0]?.[0]?.summary.map(
        (r: { label: string }) => r.label,
      ),
    ).not.toContain("Atención");
    expect(createLeave).not.toHaveBeenCalled();
  });

  it("warns on the card, without refusing, when a vacation starts off Monday and exceeds the balance", async () => {
    searchEmployeesAction.mockResolvedValue({
      ok: true,
      data: { employees: [employee(EMP, "Ana Pérez")], nextOffset: null },
    });
    listVacationBalancesAction.mockResolvedValue({
      ok: true,
      data: [{ period_year: 2026, remaining_days: 3, status: "active" }],
    });
    // Monday 2026-11-23 is a holiday: Tuesday would be fine, Wednesday is not.
    listHolidayDatesAction.mockResolvedValue({
      ok: true,
      data: ["2026-11-23"],
    });
    const s = store();
    const res = await proposeLeave.execute(
      ctx(["finance"], s),
      { ...leaveInput, start_date: "2026-11-25", end_date: "2026-11-29" },
      call,
    );
    expect(res).toMatchObject({ ok: true });
    const stored = s.createRevision.mock.calls[0]?.[0];
    const summary: { label: string; value: string }[] = stored?.summary ?? [];
    expect(
      summary.filter((r) => r.label === "Atención").map((r) => r.value),
    ).toEqual([
      expect.stringContaining("sería el martes 24-11-2026"),
      "La licencia es de 5 días y le quedan 3 días de vacaciones pendientes.",
    ]);

    // The labels survive the user's edit: the Tuesday after the holiday
    // clears the start-day warning.
    const revised = proposeLeave.proposal?.spec.validate(
      { ...stored?.draft, start_date: "2026-11-24" },
      stored?.labels ?? {},
    );
    expect(
      revised?.ok &&
        revised.summary.filter((r) => r.label === "Atención").length,
    ).toBe(1);
  });

  it("says so on the card when the balance could not be read", async () => {
    searchEmployeesAction.mockResolvedValue({
      ok: true,
      data: { employees: [employee(EMP, "Ana Pérez")], nextOffset: null },
    });
    listVacationBalancesAction.mockResolvedValue({ ok: false, error: "x" });
    const s = store();
    await proposeLeave.execute(ctx(["finance"], s), leaveInput, call);
    expect(s.createRevision.mock.calls[0]?.[0]?.summary).toContainEqual({
      label: "Atención",
      value:
        "No se pudieron leer el saldo de vacaciones o los feriados para revisar la licencia.",
    });
  });

  it("passes the model's revisionKey through, to supersede an earlier draft", async () => {
    upsertManualExchangeRate.mockResolvedValue({ ok: true, data: { id: "x" } });
    const s = store();
    await proposeExchangeRate.execute(
      ctx(["finance"], s),
      { rate_date: "2026-10-16", rate: 1200, revisionKey: "rate-oct" },
      call,
    );
    expect(s.createRevision).toHaveBeenCalledWith(
      expect.objectContaining({ revisionKey: "rate-oct" }),
    );
  });

  it("warns on the card when the rate jumps more than 30% from the stored one", async () => {
    getUsdReferenceRateAction.mockResolvedValue({
      ok: true,
      data: { rate_date: "2026-11-02", rate: 1450, earlier: true },
    });
    const s = store();
    await proposeExchangeRate.execute(
      ctx(["finance"], s),
      { rate_date: "2026-11-03", rate: 1_450_125 },
      call,
    );
    const revision = s.createRevision.mock.calls[0]?.[0];
    expect(getUsdReferenceRateAction).toHaveBeenCalledWith("2026-11-03");
    expect(revision?.summary).toContainEqual({
      label: "Atención",
      value: expect.stringMatching(/difiere en más de un 30%/),
    });

    // A revision re-checks its own rate against the stored reference.
    const { exchangeRateProposalSpec } = await import("../lib/proposal-specs");
    const revised = exchangeRateProposalSpec.validate(
      { ...revision?.draft, rate: 1450.125 },
      revision?.labels ?? {},
    );
    expect(revised.ok && revised.summary.map((r) => r.label)).not.toContain(
      "Atención",
    );
  });

  it("says on the card when the stored rate could not be read", async () => {
    getUsdReferenceRateAction.mockResolvedValue({ ok: false, error: "x" });
    const s = store();
    await proposeExchangeRate.execute(
      ctx(["finance"], s),
      { rate_date: "2026-11-03", rate: 1450 },
      call,
    );
    expect(s.createRevision.mock.calls[0]?.[0]?.summary).toContainEqual({
      label: "Atención",
      value: expect.stringMatching(/No se pudo leer la cotización guardada/),
    });
  });

  it("hands the model the store's refusal (a lost race, another action's key)", async () => {
    const { AiProposalStoreError } = await import("./define");
    const s = store();
    s.createRevision.mockRejectedValue(
      new AiProposalStoreError("Ese revisionKey es de otra propuesta."),
    );
    const res = await proposeExchangeRate.execute(
      ctx(["finance"], s),
      { rate_date: "2026-10-16", rate: 1200, revisionKey: "leave-1" },
      call,
    );
    expect(res).toEqual({
      ok: false,
      summary: "Failed: Ese revisionKey es de otra propuesta.",
      error: "Ese revisionKey es de otra propuesta.",
    });
  });

  it("returns issues and candidates instead of guessing an ambiguous employee", async () => {
    searchEmployeesAction.mockResolvedValue({
      ok: true,
      data: {
        employees: [
          employee(EMP, "Ana Pérez"),
          employee("44444444-4444-4444-8444-444444444444", "Ana Gómez"),
        ],
        nextOffset: null,
      },
    });
    const s = store();
    const res = await proposeLeave.execute(
      ctx(["finance"], s),
      { ...leaveInput, employee: "Ana" },
      call,
    );
    expect(res).toMatchObject({
      ok: true,
      data: {
        requiresConfirmation: false,
        issues: [{ field: "employee" }],
        candidates: [{ field: "employee" }],
      },
    });
    expect(s.createRevision).not.toHaveBeenCalled();
  });

  it("holds the draft to the form's schema (an unbalanced entry is an issue)", async () => {
    listChartOfAccountsAction.mockResolvedValue({
      ok: true,
      data: [
        { id: CAJA, code: "1.1.01", name: "Caja" },
        { id: VENTAS, code: "4.1.01", name: "Ventas" },
      ],
    });
    const s = store();
    const res = await proposeJournalEntry.execute(
      ctx(["finance"], s),
      {
        entry_date: "2026-10-16",
        description: "Ajuste",
        lines: [
          { account: "1.1.01", debit: 100 },
          { account: "Ventas", credit: 90 },
        ],
      },
      call,
    );
    expect(res).toMatchObject({
      ok: true,
      data: { requiresConfirmation: false },
    });
    expect(s.createRevision).not.toHaveBeenCalled();
  });

  it("executes a confirmed draft only after re-parsing it", async () => {
    createLeave.mockResolvedValue({ ok: true, data: { id: "leave-1" } });
    const bad = await proposeLeave.proposal?.executeDraft(ctx(["finance"]), {
      employee_id: "not-a-uuid",
    });
    expect(bad).toMatchObject({ ok: false });
    expect(createLeave).not.toHaveBeenCalled();

    const good = await proposeLeave.proposal?.executeDraft(ctx(["finance"]), {
      employee_id: EMP,
      start_date: "2026-11-02",
      end_date: "2026-11-06",
      kind: "vacaciones",
    });
    expect(good).toEqual({ ok: true, data: { id: "leave-1" } });
    expect(createLeave).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ employee_id: EMP }),
    );
  });
});
