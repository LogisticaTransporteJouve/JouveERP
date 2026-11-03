import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const getExpenseCostTagsAction = vi.fn();
const listCostTagOptionsAction = vi.fn();
const recategorizeExpense = vi.fn();

vi.mock("@/features/cost-centers/actions/recategorize-actions", () => ({
  getExpenseCostTagsAction,
}));
vi.mock("@/features/cost-centers/actions/cost-tag-options-actions", () => ({
  listCostTagOptionsAction,
}));
vi.mock("@/lib/commands/recategorize-expense", () => ({
  recategorizeExpense,
}));

const { proposeRecategorizeExpense } = await import("./expense-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const TX = "00000000-0000-4000-8000-000000000001";
const FUEL = "00000000-0000-4000-8000-0000000000a1";
const TOLLS = "00000000-0000-4000-8000-0000000000a2";
const FLEET = "00000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  vi.clearAllMocks();
  getExpenseCostTagsAction.mockResolvedValue({
    ok: true,
    data: {
      source: "transactions",
      id: TX,
      label: "02/11/2026 · Gasoil · $ 50.000,00",
      expense_account_id: null,
      cost_center_id: null,
      blocked: null,
    },
  });
  listCostTagOptionsAction.mockResolvedValue({
    ok: true,
    data: {
      expenseAccounts: [
        { id: FUEL, code: "5.1.04", name: "Combustibles" },
        {
          id: TOLLS,
          code: "5.1.05",
          name: "Peajes y combustibles de terceros",
        },
      ],
      costCenters: [{ id: FLEET, code: "FLOTA", name: "Flota" }],
    },
  });
});

function prepare(input: Record<string, unknown>) {
  return proposeRecategorizeExpense.proposal?.prepareDraft(ctx, {
    source: "transactions",
    id: TX,
    ...input,
  });
}

describe("proposeRecategorizeExpense", () => {
  it("is offered only with both write permissions", () => {
    expect(proposeRecategorizeExpense.permissions).toEqual(
      expect.arrayContaining(["transactions:write", "purchase_invoices:write"]),
    );
  });

  it("resolves the account by exact name and the center by code", async () => {
    const prepared = await prepare({
      expense_account: "combustibles",
      cost_center: "flota",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toEqual({
      source: "transactions",
      id: TX,
      expense_account_id: FUEL,
      cost_center_id: FLEET,
    });
    const rows = Object.fromEntries(
      prepared.summary.map((r) => [r.label, r.value]),
    );
    expect(rows["Cuenta de gasto"]).toBe(
      "Gastos (sin cuenta propia) → 5.1.04 Combustibles",
    );
    expect(rows["Centro de costo"]).toBe("Sin centro de costo → FLOTA Flota");
  });

  it("keeps what the model did not name", async () => {
    const prepared = await prepare({ cost_center: "FLOTA" });
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    expect(prepared.draft).not.toHaveProperty("expense_account_id");
    expect(prepared.summary.map((r) => r.label)).not.toContain(
      "Cuenta de gasto",
    );
  });

  it("asks when a name matches several accounts", async () => {
    const prepared = await prepare({ expense_account: "combust" });
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.candidates?.[0]?.options).toHaveLength(2);
  });

  it("refuses an expense the database would refuse, and a no-op", async () => {
    getExpenseCostTagsAction.mockResolvedValueOnce({
      ok: true,
      data: {
        source: "transactions",
        id: TX,
        label: "x",
        expense_account_id: null,
        cost_center_id: null,
        blocked: "El egreso lo generó un documento.",
      },
    });
    expect((await prepare({ cost_center: "FLOTA" }))?.kind).toBe("error");
    expect((await prepare({ cost_center: "ninguno" }))?.kind).toBe("error");
  });

  it("needs something to change", async () => {
    expect((await prepare({}))?.kind).toBe("issues");
    expect(getExpenseCostTagsAction).not.toHaveBeenCalled();
  });

  it("runs the shared command and notes a no-op", async () => {
    recategorizeExpense.mockResolvedValue({
      ok: true,
      data: { id: TX, changed: false },
    });
    const draft = { source: "transactions", id: TX, cost_center_id: FLEET };
    const res = await proposeRecategorizeExpense.proposal?.executeDraft(
      ctx,
      draft,
    );
    expect(recategorizeExpense).toHaveBeenCalledWith("u1", draft);
    expect(res).toEqual({
      ok: true,
      data: { id: TX, note: "Ya tenía esa imputación: no cambió nada." },
    });
  });
});
