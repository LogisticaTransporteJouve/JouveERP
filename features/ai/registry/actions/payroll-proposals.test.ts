import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const getPayrollPeriodAction = vi.fn();
const listAccountsAction = vi.fn();
const readInvoicingChannels = vi.fn();
const createPayrollPayment = vi.fn();
const bulkCreatePayrollPayments = vi.fn();

vi.mock("@/features/hr/actions/payroll-actions", () => ({
  getPayrollPeriodAction,
}));
vi.mock("@/features/hr/actions/employees-actions", () => ({
  searchEmployeesAction: vi.fn(),
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction,
}));
vi.mock("@/lib/channels", () => ({ readInvoicingChannels }));
vi.mock("@/lib/commands/pay-payroll", () => ({
  createPayrollPayment,
  bulkCreatePayrollPayments,
}));

const { proposePayrollPayment } = await import("./payroll-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const E1 = "00000000-0000-4000-8000-000000000001";
const E2 = "00000000-0000-4000-8000-000000000002";
const GALICIA = "00000000-0000-4000-8000-0000000000a1";
const USD = "00000000-0000-4000-8000-0000000000a2";

function entry(id: string, name: string, saldo: number) {
  return {
    id,
    period_id: "p",
    employee_id: `emp-${id}`,
    employee_legal_name: name,
    employee_pay_frequency: "mensual",
    employee_is_active: true,
    sueldo_neto: saldo,
    extras_total: 0,
    vacaciones_monto: 0,
    viaticos: 0,
    deudas: 0,
    deudas_override: false,
    telefono: 0,
    embargo: 0,
    embargo_override: false,
    recibo_neto: null,
    total_a_pagar: saldo,
    paid_total: 0,
    paid_transferencia: 0,
    paid_efectivo: 0,
    saldo,
    payments_count: 0,
    notes: null,
  };
}

const input = {
  period: "2026-10",
  method: "transferencia",
  account: "galicia",
  channel: "internal",
  paid_at: "2026-11-05",
};

beforeEach(() => {
  vi.clearAllMocks();
  getPayrollPeriodAction.mockResolvedValue({
    ok: true,
    data: {
      period: { id: "p", status: "draft" },
      entries: [entry(E1, "Gómez Ana", 900000), entry(E2, "Pérez Juan", 0)],
    },
  });
  listAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      {
        id: GALICIA,
        name: "Banco Galicia",
        type: "bank",
        currency: "ARS",
        is_active: true,
      },
      {
        id: USD,
        name: "Galicia USD",
        type: "bank",
        currency: "USD",
        is_active: true,
      },
    ],
  });
  readInvoicingChannels.mockResolvedValue({
    ok: true,
    channels: [
      { id: "jouve_fiscal", name: "Fiscal", is_fiscal: true, is_active: true },
      {
        id: "jouve_internal",
        name: "Interno",
        is_fiscal: false,
        is_active: true,
      },
    ],
  });
});

describe("proposePayrollPayment", () => {
  it("is gated like the payroll dialogs plus its reads", () => {
    expect([...proposePayrollPayment.permissions].sort()).toEqual(
      ["accounts:read", "hr:read", "hr:write", "transactions:write"].sort(),
    );
  });

  it("pays everyone with a pending balance the planilla's suggestion, from an ARS account", async () => {
    const res = await proposePayrollPayment.proposal?.prepareDraft(ctx, input);
    expect(res?.kind).toBe("draft");
    if (res?.kind !== "draft") return;
    // The USD account is not one salaries are paid from: "galicia" is the
    // ARS one alone. Pérez has nothing due and stays out.
    expect(res.draft).toEqual({
      items: [{ entry_id: E1, amount: 900000 }],
      account_id: GALICIA,
      channel_id: "jouve_internal",
      method: "transferencia",
      paid_at: "2026-11-05",
      notes: null,
    });
    expect(getPayrollPeriodAction).toHaveBeenCalledWith(2026, 10, "monthly");
  });

  it("asks which channel when the side has two active, and takes the one picked", async () => {
    readInvoicingChannels.mockResolvedValue({
      ok: true,
      channels: [
        {
          id: "jouve_fiscal",
          name: "Fiscal",
          is_fiscal: true,
          is_active: true,
        },
        {
          id: "jouve_internal",
          name: "Interno",
          is_fiscal: false,
          is_active: true,
        },
        {
          id: "jouve_internal_2",
          name: "Interno 2",
          is_fiscal: false,
          is_active: true,
        },
      ],
    });
    const asked = await proposePayrollPayment.proposal?.prepareDraft(
      ctx,
      input,
    );
    expect(asked).toEqual({
      kind: "issues",
      issues: [
        {
          field: "channel",
          message: "Hay más de un canal activo: ¿por cuál va?",
        },
      ],
      candidates: [
        {
          field: "channel",
          options: [
            { value: "Interno", label: "Interno · interno" },
            { value: "Interno 2", label: "Interno 2 · interno" },
          ],
        },
      ],
    });
    const picked = await proposePayrollPayment.proposal?.prepareDraft(ctx, {
      ...input,
      channel: "Interno 2",
    });
    expect(picked).toMatchObject({
      kind: "draft",
      draft: { channel_id: "jouve_internal_2" },
    });
  });

  it("asks when a named employee has nothing due", async () => {
    const res = await proposePayrollPayment.proposal?.prepareDraft(ctx, {
      ...input,
      employees: ["Pérez Juan"],
    });
    expect(res).toMatchObject({
      kind: "issues",
      issues: [{ message: expect.stringContaining("no tiene saldo") }],
    });
  });

  it("refuses an amount for several employees", async () => {
    const res = await proposePayrollPayment.proposal?.prepareDraft(ctx, {
      ...input,
      amount: 1000,
    });
    expect(res).toMatchObject({
      kind: "issues",
      issues: [{ field: "amount" }],
    });
  });

  it("asks when the planilla does not exist", async () => {
    getPayrollPeriodAction.mockResolvedValue({
      ok: true,
      data: { period: null, entries: [] },
    });
    const res = await proposePayrollPayment.proposal?.prepareDraft(ctx, input);
    expect(res).toMatchObject({
      kind: "issues",
      issues: [{ field: "period" }],
    });
  });

  it("runs one payment as Pagar and several as Pago masivo", async () => {
    createPayrollPayment.mockResolvedValue({ ok: true, data: { id: "pay" } });
    bulkCreatePayrollPayments.mockResolvedValue({
      ok: true,
      data: { inserted: 2 },
    });
    const draft = {
      account_id: GALICIA,
      channel_id: "jouve_internal",
      method: "efectivo",
      paid_at: "2026-11-05",
      notes: null,
    };
    const one = await proposePayrollPayment.proposal?.executeDraft(ctx, {
      ...draft,
      items: [{ entry_id: E1, amount: 100 }],
    });
    expect(one).toEqual({ ok: true, data: { id: "pay" } });
    expect(createPayrollPayment).toHaveBeenCalledWith("u1", {
      ...draft,
      entry_id: E1,
      amount: 100,
    });
    const two = await proposePayrollPayment.proposal?.executeDraft(ctx, {
      ...draft,
      items: [
        { entry_id: E1, amount: 100 },
        { entry_id: E2, amount: 50 },
      ],
    });
    expect(two).toMatchObject({
      ok: true,
      data: { note: "2 pagos registrados." },
    });
  });

  it("is refused to a finance user denied transactions:write, before any read", async () => {
    const res = await proposePayrollPayment.execute(
      {
        userId: "u1",
        access: resolveAccess(["finance"], ["transactions:write"]),
      },
      input,
      { toolCallId: "t1" },
    );
    expect(res.ok).toBe(false);
    expect(getPayrollPeriodAction).not.toHaveBeenCalled();
  });
});
