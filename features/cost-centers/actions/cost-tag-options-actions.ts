"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan, type Permission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { compareCodes } from "@/features/chart-of-accounts/schema";

import type { CostTagOptions } from "../schema";

/** Whoever loads a cost (or reads the books) sees the options to tag it. */
const COST_TAG_READERS: readonly Permission[] = [
  "accounting:read",
  "purchase_invoices:write",
  "transactions:write",
  "suppliers:write",
];

/**
 * The postable expense accounts (active leaves of the chart, the ones the
 * database accepts on a purchase, a manual expense or a supplier default) and
 * the active cost centers, for the pickers of those forms. Inactive centers
 * come apart: a picker names one only when a saved record already uses it.
 */
export async function listCostTagOptionsAction(): Promise<
  ActionResult<CostTagOptions>
> {
  const ctx = await requireUserContext();
  if (!COST_TAG_READERS.some((p) => userCan(ctx.access, p))) {
    return { ok: false, error: "No tenés permiso para ver cuentas de gasto." };
  }
  const supabase = getServiceClient();
  const [accounts, centers] = await Promise.all([
    supabase.from("expense_leaf_accounts").select("id, code, name"),
    supabase
      .from("cost_centers")
      .select("id, code, name, is_active")
      .order("code"),
  ]);
  if (accounts.error || centers.error) {
    logger.error("cost_tag_options.list.failed", {
      userId: ctx.userId,
      error: accounts.error ?? centers.error,
    });
    return {
      ok: false,
      error: "No se pudieron leer las cuentas de gasto y centros de costo.",
    };
  }
  return {
    ok: true,
    data: {
      expenseAccounts: (accounts.data ?? [])
        .flatMap((a) =>
          a.id && a.code && a.name
            ? [{ id: a.id, code: a.code, name: a.name }]
            : [],
        )
        .sort((a, b) => compareCodes(a.code, b.code)),
      costCenters: (centers.data ?? []).flatMap(({ is_active, ...c }) =>
        is_active ? [c] : [],
      ),
      inactiveCostCenters: (centers.data ?? []).flatMap(
        ({ is_active, ...c }) => (is_active ? [] : [c]),
      ),
    },
  };
}
