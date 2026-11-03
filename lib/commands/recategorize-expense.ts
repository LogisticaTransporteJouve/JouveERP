import "server-only";

import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/** Where the cost lives: a manual expense or a purchase. */
export type ExpenseSource = "transactions" | "purchase_invoices";

export type RecategorizeExpenseInput = {
  source: ExpenseSource;
  id: string;
  /** Omitted = keep it; null = the default account (gastos / compras). */
  expense_account_id?: string | null;
  /** Omitted = keep it; null = no cost center. */
  cost_center_id?: string | null;
};

export type RecategorizeExpenseOutcome = { id: string; changed: boolean };

type Tags = { account: string | null; cost_center: string | null };

/** The function's jsonb answer: whether it changed, and before / after. */
function readChange(data: unknown): {
  changed: boolean;
  before: Tags;
  after: Tags;
} {
  const get = (key: string): unknown =>
    typeof data === "object" && data !== null
      ? Reflect.get(data, key)
      : undefined;
  const id = (key: string): string | null => {
    const value = get(key);
    return typeof value === "string" ? value : null;
  };
  return {
    changed: get("changed") === true,
    before: {
      account: id("expense_account_id_before"),
      cost_center: id("cost_center_id_before"),
    },
    after: {
      account: id("expense_account_id"),
      cost_center: id("cost_center_id"),
    },
  };
}

/**
 * Changes the expense account and/or cost center of an expense through
 * recategorize_expense (its guards refuse an owned movement, an annulled
 * purchase, a closed period, an account that is not a postable leaf) and
 * audits it with the values before and after. The re-post of the journal
 * entry runs in the same transaction. The caller has already checked
 * `transactions:write` or `purchase_invoices:write` for the source and parsed
 * the input with RecategorizeExpenseSchema.
 */
export async function recategorizeExpense(
  actorId: string,
  input: RecategorizeExpenseInput,
): Promise<ActionResult<RecategorizeExpenseOutcome>> {
  const setAccount = input.expense_account_id !== undefined;
  const setCostCenter = input.cost_center_id !== undefined;
  const { data, error } = await getServiceClient().rpc("recategorize_expense", {
    p_source: input.source,
    p_id: input.id,
    p_set_account: setAccount,
    p_set_cost_center: setCostCenter,
    // Omitted keys take the function's default (null).
    ...(input.expense_account_id
      ? { p_expense_account_id: input.expense_account_id }
      : {}),
    ...(input.cost_center_id ? { p_cost_center_id: input.cost_center_id } : {}),
  });
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "expense.recategorize.rejected",
      userId: actorId,
      id: input.id,
    });
    if (!guard) {
      logger.error("expense.recategorize.failed", {
        userId: actorId,
        id: input.id,
        error,
      });
    }
    return { ok: false, error: guard ?? "No se pudo recategorizar el gasto." };
  }
  const change = readChange(data);
  if (change.changed) {
    await logAudit(
      "expense.recategorized",
      actorId,
      {
        source: input.source,
        expense_account_id_before: change.before.account,
        expense_account_id: change.after.account,
        cost_center_id_before: change.before.cost_center,
        cost_center_id: change.after.cost_center,
      },
      input.id,
    );
  }
  return { ok: true, data: { id: input.id, changed: change.changed } };
}
