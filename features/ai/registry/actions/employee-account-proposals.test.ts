import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const searchEmployeesAction = vi.fn();
const listAccountsAction = vi.fn();
const readInvoicingChannels = vi.fn();
const recordEmployeeAccountCash = vi.fn();
const createEmployeeAccountMovement = vi.fn();
const getEmployeeAccountAction = vi.fn();

vi.mock("@/features/hr/actions/employees-actions", () => ({
  searchEmployeesAction,
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction,
}));
vi.mock("@/lib/channels", () => ({ readInvoicingChannels }));
vi.mock("@/features/hr/actions/employee-account-actions", () => ({
  getEmployeeAccountAction,
}));
vi.mock("@/lib/commands/record-employee-account", () => ({
  recordEmployeeAccountCash,
  createEmployeeAccountMovement,
}));

const { proposeEmployeeAccountCash, proposeEmployeeAccountMovement } =
  await import("./employee-account-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const EMP = "00000000-0000-4000-8000-000000000001";
const CAJA = "00000000-0000-4000-8000-0000000000a1";
const CARTERA = "00000000-0000-4000-8000-0000000000a2";
const CELULAR = "00000000-0000-4000-8000-0000000000b1";
const UNIFORME = "00000000-0000-4000-8000-0000000000b2";
const SALDADO = "00000000-0000-4000-8000-0000000000b3";

const plan = (
  id: string,
  description: string,
  remaining: number,
  status = "activo",
) => ({
  id,
  employee_id: EMP,
  description,
  currency: "ARS",
  total: 100000,
  installment_amount: 20000,
  start_month: "2026-10-01",
  status,
  creditor: "empresa",
  creditor_name: null,
  notes: null,
  paid: 100000 - remaining,
  remaining,
});

beforeEach(() => {
  vi.clearAllMocks();
  searchEmployeesAction.mockResolvedValue({
    ok: true,
    data: {
      employees: [{ id: EMP, legal_name: "Gómez Ana", cuil: null }],
      nextOffset: null,
    },
  });
  listAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      {
        id: CAJA,
        name: "Caja",
        type: "cash",
        currency: "ARS",
        is_active: true,
      },
      {
        id: CARTERA,
        name: "Caja de cheques",
        type: "checks",
        currency: "ARS",
        is_active: true,
      },
    ],
  });
  getEmployeeAccountAction.mockResolvedValue({
    ok: true,
    data: {
      balances: [],
      movements: [],
      movements_partial: false,
      plans: [
        plan(CELULAR, "Adelanto celular", 60000),
        plan(UNIFORME, "Uniforme", 0, "condonado"),
        plan(SALDADO, "Adelanto saldado", 0, "cancelado"),
      ],
    },
  });
  readInvoicingChannels.mockResolvedValue({
    ok: true,
    channels: [
      {
        id: "jouve_internal",
        name: "Interno",
        is_fiscal: false,
        is_active: true,
      },
    ],
  });
});

const advance = {
  employee: "Gómez Ana",
  kind: "advance",
  amount: 150000,
  account: "caja",
  channel: "internal",
  date: "2026-11-05",
};

describe("proposeEmployeeAccountCash", () => {
  it("moves Caja, so it needs transactions:write like the dialog", () => {
    expect([...proposeEmployeeAccountCash.permissions].sort()).toEqual(
      ["accounts:read", "hr:read", "hr:write", "transactions:write"].sort(),
    );
  });

  it("discounts an advance in one month by default, as the dialog does", async () => {
    const res = await proposeEmployeeAccountCash.proposal?.prepareDraft(
      ctx,
      advance,
    );
    expect(res?.kind).toBe("draft");
    if (res?.kind !== "draft") return;
    // "Caja" names the cash account exactly; the check cartera is never offered.
    expect(res.draft).toMatchObject({
      employee_id: EMP,
      account_id: CAJA,
      channel_id: "jouve_internal",
      installment_amount: 150000,
    });
  });

  it("does not pay an advance from a check cartera", async () => {
    const res = await proposeEmployeeAccountCash.proposal?.prepareDraft(ctx, {
      ...advance,
      account: "cheques",
    });
    expect(res).toMatchObject({
      kind: "issues",
      issues: [{ field: "account" }],
    });
  });

  it("takes the cuota the user said, or no plan", async () => {
    const cuotas = await proposeEmployeeAccountCash.proposal?.prepareDraft(
      ctx,
      { ...advance, installment_amount: 50000 },
    );
    expect(cuotas).toMatchObject({ draft: { installment_amount: 50000 } });
    const none = await proposeEmployeeAccountCash.proposal?.prepareDraft(ctx, {
      ...advance,
      discount_in_payroll: false,
    });
    expect(none).toMatchObject({ draft: { installment_amount: null } });
  });

  it("applies the employee's payment to the plan the user named", async () => {
    const res = await proposeEmployeeAccountCash.proposal?.prepareDraft(ctx, {
      ...advance,
      kind: "payment",
      amount: 20000,
      plan: "celular",
    });
    expect(res).toMatchObject({
      kind: "draft",
      draft: { plan_id: CELULAR, installment_amount: null },
    });
    if (res?.kind !== "draft") return;
    expect(res.summary).toContainEqual({
      label: "Imputa al plan",
      value: "Adelanto celular",
    });
  });

  it("offers only plans with something left, and none to an advance", async () => {
    const saldado = await proposeEmployeeAccountCash.proposal?.prepareDraft(
      ctx,
      { ...advance, kind: "payment", plan: "saldado" },
    );
    expect(saldado).toMatchObject({
      kind: "issues",
      issues: [{ field: "plan" }],
      candidates: [{ field: "plan", options: [{ value: "Adelanto celular" }] }],
    });
    const onAdvance = await proposeEmployeeAccountCash.proposal?.prepareDraft(
      ctx,
      { ...advance, plan: "celular" },
    );
    expect(onAdvance).toMatchObject({
      kind: "issues",
      issues: [{ field: "plan" }],
    });
  });

  it("never opens a plan on the employee's payment", async () => {
    const res = await proposeEmployeeAccountCash.proposal?.prepareDraft(ctx, {
      ...advance,
      kind: "payment",
      installment_amount: 1000,
    });
    expect(res).toMatchObject({ draft: { installment_amount: null } });
  });
});

describe("proposeEmployeeAccountMovement", () => {
  it("drafts a charge owed to the company by default", async () => {
    const res = await proposeEmployeeAccountMovement.proposal?.prepareDraft(
      ctx,
      {
        employee: "Gómez Ana",
        kind: "charge",
        amount: 80000,
        movement_date: "2026-11-05",
        description: "Celular roto",
      },
    );
    expect(res).toMatchObject({
      kind: "draft",
      draft: { currency: "ARS", creditor: "empresa", plan_id: null },
    });
  });

  it("charges to a plan of its currency that is not forgiven", async () => {
    const res = await proposeEmployeeAccountMovement.proposal?.prepareDraft(
      ctx,
      {
        employee: "Gómez Ana",
        kind: "payment",
        amount: 10000,
        description: "Pago en mano",
        plan: "adelanto saldado",
      },
    );
    expect(res).toMatchObject({ kind: "draft", draft: { plan_id: SALDADO } });
    const forgiven =
      await proposeEmployeeAccountMovement.proposal?.prepareDraft(ctx, {
        employee: "Gómez Ana",
        kind: "charge",
        amount: 10000,
        description: "Uniforme",
        plan: "uniforme",
      });
    expect(forgiven).toMatchObject({
      kind: "issues",
      issues: [{ field: "plan" }],
    });
  });

  it("is never offered to operations", async () => {
    const res = await proposeEmployeeAccountMovement.execute(
      { userId: "u1", access: resolveAccess(["operations"]) },
      { employee: "x", kind: "charge", amount: 1, description: "x" },
      { toolCallId: "t1" },
    );
    expect(res.ok).toBe(false);
    expect(searchEmployeesAction).not.toHaveBeenCalled();
  });
});
