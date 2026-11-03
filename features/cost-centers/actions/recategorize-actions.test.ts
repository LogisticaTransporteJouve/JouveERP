import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";
import type { Permission } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denied: Permission[] = [];
let tables: Record<string, { data: unknown; error: unknown }> = {};
const rpc = vi.fn();
const audit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));

function query(table: string) {
  const result = tables[table] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) builder[m] = () => builder;
  builder.maybeSingle = async () => result;
  return builder;
}

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: query, rpc }),
}));

const { getExpenseCostTagsAction, recategorizeExpenseAction } =
  await import("./recategorize-actions");

const TX = "00000000-0000-4000-8000-000000000001";
const ACCOUNT = "00000000-0000-4000-8000-000000000002";
const CENTER = "00000000-0000-4000-8000-000000000003";
const OLD_ACCOUNT = "00000000-0000-4000-8000-000000000004";

function rpcAnswer(changed: boolean) {
  return {
    data: {
      source: "transactions",
      id: TX,
      changed,
      expense_account_id_before: OLD_ACCOUNT,
      expense_account_id: ACCOUNT,
      cost_center_id_before: null,
      cost_center_id: null,
    },
    error: null,
  };
}

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  tables = {};
  rpc.mockReset();
  audit.mockReset();
});

describe("recategorizeExpenseAction", () => {
  it("sends only what changes and audits before and after", async () => {
    rpc.mockResolvedValue(rpcAnswer(true));
    const res = await recategorizeExpenseAction({
      source: "transactions",
      id: TX,
      expense_account_id: ACCOUNT,
    });
    expect(res).toEqual({ ok: true, data: { id: TX, changed: true } });
    expect(rpc).toHaveBeenCalledWith("recategorize_expense", {
      p_source: "transactions",
      p_id: TX,
      p_set_account: true,
      p_set_cost_center: false,
      p_expense_account_id: ACCOUNT,
    });
    expect(audit).toHaveBeenCalledWith(
      "expense.recategorized",
      "u1",
      {
        source: "transactions",
        expense_account_id_before: OLD_ACCOUNT,
        expense_account_id: ACCOUNT,
        cost_center_id_before: null,
        cost_center_id: null,
      },
      TX,
    );
  });

  it("clears a cost center with null (the function's default)", async () => {
    rpc.mockResolvedValue(rpcAnswer(true));
    await recategorizeExpenseAction({
      source: "purchase_invoices",
      id: TX,
      cost_center_id: null,
    });
    expect(rpc).toHaveBeenCalledWith("recategorize_expense", {
      p_source: "purchase_invoices",
      p_id: TX,
      p_set_account: false,
      p_set_cost_center: true,
    });
  });

  it("does not audit when nothing changed", async () => {
    rpc.mockResolvedValue(rpcAnswer(false));
    const res = await recategorizeExpenseAction({
      source: "transactions",
      id: TX,
      cost_center_id: CENTER,
    });
    expect(res).toEqual({ ok: true, data: { id: TX, changed: false } });
    expect(audit).not.toHaveBeenCalled();
  });

  it("shows the guard's message", async () => {
    const message =
      "El período contable 2026-09 está cerrado: pedí que lo reabran en Contabilidad para recategorizar";
    rpc.mockResolvedValue({
      data: null,
      error: { message, code: "55006", hint: "jouve_guard" },
    });
    const res = await recategorizeExpenseAction({
      source: "transactions",
      id: TX,
      cost_center_id: CENTER,
    });
    expect(res).toEqual({ ok: false, error: message });
    expect(audit).not.toHaveBeenCalled();
  });

  it("gates by the source's own write permission", async () => {
    denied = ["purchase_invoices:write"];
    const res = await recategorizeExpenseAction({
      source: "purchase_invoices",
      id: TX,
      cost_center_id: CENTER,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue(rpcAnswer(true));
    const tx = await recategorizeExpenseAction({
      source: "transactions",
      id: TX,
      cost_center_id: CENTER,
    });
    expect(tx.ok).toBe(true);
  });

  it("refuses operations and an empty change", async () => {
    roles = ["operations"];
    expect(
      (
        await recategorizeExpenseAction({
          source: "transactions",
          id: TX,
          cost_center_id: CENTER,
        })
      ).ok,
    ).toBe(false);
    roles = ["finance"];
    expect(
      (await recategorizeExpenseAction({ source: "transactions", id: TX })).ok,
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("getExpenseCostTagsAction", () => {
  it("says why a movement a document owns cannot be recategorized", async () => {
    tables.v_transactions_tagged = {
      data: {
        id: TX,
        kind: "expense",
        description: "Pago a proveedor",
        amount: 1000,
        currency: "ARS",
        transaction_date: "2026-10-20",
        expense_account_id: null,
        cost_center_id: null,
        source_document: "payment_order",
        transfer_pair_id: null,
      },
      error: null,
    };
    const res = await getExpenseCostTagsAction({
      source: "transactions",
      id: TX,
    });
    expect(res.ok && res.data.blocked).toContain("documento de origen");
  });

  it("labels a purchase and leaves a received one open", async () => {
    tables.purchase_invoices = {
      data: {
        id: TX,
        kind: "factura",
        letter: "A",
        punto_venta: 3,
        numero: 120,
        fecha: "2026-10-05",
        imp_neto: 1000,
        moneda: "PES",
        status: "received",
        account_id: OLD_ACCOUNT,
        cost_center_id: null,
        suppliers: { legal_name: "YPF S.A." },
      },
      error: null,
    };
    const res = await getExpenseCostTagsAction({
      source: "purchase_invoices",
      id: TX,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.blocked).toBeNull();
    expect(res.data.expense_account_id).toBe(OLD_ACCOUNT);
    expect(res.data.label).toContain("YPF S.A.");
  });

  it("needs the source's read permission", async () => {
    roles = ["operations"];
    const res = await getExpenseCostTagsAction({
      source: "transactions",
      id: TX,
    });
    expect(res.ok).toBe(false);
  });
});
