import { z } from "zod";

import { listCostTagOptionsAction } from "@/features/cost-centers/actions/cost-tag-options-actions";
import { getExpenseCostTagsAction } from "@/features/cost-centers/actions/recategorize-actions";
import {
  EXPENSE_SOURCE_WRITE,
  EXPENSE_SOURCES,
  type CostTagOption,
  type ExpenseSource,
} from "@/features/cost-centers/schema";
import { userCan } from "@/lib/auth/permissions";
import { recategorizeExpense } from "@/lib/commands/recategorize-expense";

import {
  RECATEGORIZE_LABELS,
  recategorizeExpenseProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { MAX_CANDIDATES, norm } from "./resolve-client";

/** Why a user who may recategorize one source cannot touch the other. */
const SOURCE_WRITE_DENIED: Record<ExpenseSource, string> = {
  transactions:
    "No tenés permiso para recategorizar movimientos de caja: solo compras.",
  purchase_invoices:
    "No tenés permiso para recategorizar facturas de compra: solo movimientos de caja.",
};

/** What the model may say to mean "the default account" / "no center". */
const NONE_WORDS = new Set([
  "ninguna",
  "ninguno",
  "sin cuenta",
  "sin centro",
  "sin centro de costo",
  "por defecto",
  "default",
  "none",
]);

export function optionLabel(o: CostTagOption): string {
  return `${o.code} ${o.name}`;
}

export type Resolved =
  | { kind: "id"; id: string | null }
  | { kind: "issues"; result: AiPrepareResult };

/** A code or name as the user said it → one option (by exact code, exact
 *  name, or the single option whose name contains it), or a question. */
const OPTION_KIND = {
  expense_account: "cuenta de gasto imputable",
  cost_center: "centro de costo activo",
  category: "categoría de proveedor activa",
} as const;

export function resolveOption(
  field: keyof typeof OPTION_KIND,
  said: string,
  options: readonly CostTagOption[],
): Resolved {
  const q = norm(said);
  if (NONE_WORDS.has(q)) return { kind: "id", id: null };
  const exact = options.filter((o) => norm(o.code) === q || norm(o.name) === q);
  const close = options.filter(
    (o) => norm(o.name).includes(q) || norm(o.code).startsWith(q),
  );
  const pick =
    exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
  if (pick) return { kind: "id", id: pick.id };
  const what = OPTION_KIND[field];
  return {
    kind: "issues",
    result: {
      kind: "issues",
      issues: [
        {
          field,
          message:
            close.length === 0
              ? `No hay una ${what} que coincida con "${said}".`
              : `"${said}" coincide con varias opciones.`,
        },
      ],
      candidates: [
        {
          field,
          options: (close.length ? close : options)
            .slice(0, MAX_CANDIDATES)
            .map((o) => ({ value: o.code, label: optionLabel(o) })),
        },
      ],
    },
  };
}

export const proposeRecategorizeExpense = defineAiProposal({
  name: "proposeRecategorizeExpense",
  domain: "contabilidad",
  // recategorizeExpenseAction gates on the write of the expense's source
  // (EXPENSE_SOURCE_WRITE): offered with either, and prepare / execute
  // refuse the source the user cannot write (getExpenseCostTagsAction
  // checks its read).
  permission: { anyOf: ["transactions:write", "purchase_invoices:write"] },
  sources: [
    "transactions",
    "purchase_invoices",
    "expense_leaf_accounts",
    "cost_centers",
  ],
  description:
    "Propose recategorizing an expense already loaded: change its expense " +
    "account (rubro) and/or cost center, for the user to accept on a card. " +
    "source 'transactions' is a manual expense (id from getTransactions), " +
    "'purchase_invoices' a purchase (id from getPurchaseInvoices). Pass the " +
    "account or center by code or name as the user said it ('ninguna' = the " +
    "default account, 'ninguno' = no center); omit the one that stays. The " +
    "entry is re-posted; a closed period or a movement a document owns is " +
    "refused. On a purchase, its NC/ND that still carry the old account or " +
    "center follow it. Writes nothing by itself.",
  input: z.object({
    source: z.enum(EXPENSE_SOURCES),
    id: z.string().uuid(),
    expense_account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("New expense account: code or name. Omit to keep it."),
    cost_center: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("New cost center: code or name. Omit to keep it."),
  }),
  spec: recategorizeExpenseProposalSpec,
  prepare: async (ctx, input) => {
    if (!userCan(ctx.access, EXPENSE_SOURCE_WRITE[input.source])) {
      return { kind: "error", error: SOURCE_WRITE_DENIED[input.source] };
    }
    if (
      input.expense_account === undefined &&
      input.cost_center === undefined
    ) {
      return {
        kind: "issues",
        issues: [
          {
            field: "expense_account",
            message:
              "Falta qué cambiar: la cuenta de gasto, el centro de costo o los dos.",
          },
        ],
      };
    }
    const [expense, options] = await Promise.all([
      getExpenseCostTagsAction({ source: input.source, id: input.id }),
      listCostTagOptionsAction(),
    ]);
    if (!expense.ok) return { kind: "error", error: expense.error };
    if (!options.ok) return { kind: "error", error: options.error };
    if (expense.data.blocked) {
      return { kind: "error", error: expense.data.blocked };
    }
    const { expenseAccounts, costCenters } = options.data;
    const name = (list: readonly CostTagOption[], id: string | null) => {
      if (id === null) return null;
      const found = list.find((o) => o.id === id);
      return found ? optionLabel(found) : "Cuenta actual (no imputable)";
    };

    const labels: Record<string, string> = {
      [RECATEGORIZE_LABELS.expense]: expense.data.label,
      [RECATEGORIZE_LABELS.accountBefore]:
        name(expenseAccounts, expense.data.expense_account_id) ??
        (input.source === "transactions"
          ? "Gastos (sin cuenta propia)"
          : "Compras (sin cuenta propia)"),
      [RECATEGORIZE_LABELS.costCenterBefore]:
        expense.data.cost_center_id === null
          ? "Sin centro de costo"
          : (costCenters.find((o) => o.id === expense.data.cost_center_id)
              ?.name ?? "Centro actual (inactivo)"),
    };
    const draft: {
      source: typeof input.source;
      id: string;
      expense_account_id?: string | null;
      cost_center_id?: string | null;
    } = { source: input.source, id: input.id };

    if (input.expense_account !== undefined) {
      const res = resolveOption(
        "expense_account",
        input.expense_account,
        expenseAccounts,
      );
      if (res.kind === "issues") return res.result;
      draft.expense_account_id = res.id;
      const picked = expenseAccounts.find((o) => o.id === res.id);
      if (picked) labels[picked.id] = optionLabel(picked);
    }
    if (input.cost_center !== undefined) {
      const res = resolveOption("cost_center", input.cost_center, costCenters);
      if (res.kind === "issues") return res.result;
      draft.cost_center_id = res.id;
      const picked = costCenters.find((o) => o.id === res.id);
      if (picked) labels[picked.id] = optionLabel(picked);
    }

    const sameAccount =
      draft.expense_account_id === undefined ||
      draft.expense_account_id === expense.data.expense_account_id;
    const sameCenter =
      draft.cost_center_id === undefined ||
      draft.cost_center_id === expense.data.cost_center_id;
    if (sameAccount && sameCenter) {
      return {
        kind: "error",
        error:
          "El gasto ya tiene esa cuenta y ese centro de costo: no hay nada que cambiar.",
      };
    }
    return { kind: "draft", draft, labels };
  },
  execute: async (ctx, draft) => {
    if (!userCan(ctx.access, EXPENSE_SOURCE_WRITE[draft.source])) {
      return { ok: false, error: SOURCE_WRITE_DENIED[draft.source] };
    }
    const res = await recategorizeExpense(ctx.userId, draft);
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        id: res.data.id,
        ...(res.data.changed
          ? {}
          : { note: "Ya tenía esa imputación: no cambió nada." }),
      },
    };
  },
});
