import { getSupplierPriceEvolutionAction } from "@/features/suppliers/actions/purchases-report-actions";
import type { ResolvedPeriod } from "@/lib/list-period";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor, type FiscalFilter } from "@/lib/scope";

import { listSupplierCategoryPurchasesAction } from "../actions/supplier-categories-actions";
import {
  SUPPLIER_ROWS_LIMIT,
  summarizeCategorySpend,
  type CategorySpend,
} from "./category-spend";
import { supplierCategoriesKeys } from "./supplier-categories-keys";

/** How many of the period's latest purchases the page lists. */
export const CATEGORY_PURCHASES_LIMIT = 20;

/**
 * The category's spend through the AI supplier RPC (`ai_supplier_price_evolution`),
 * so the page and the assistant share one net rule. Shared by the server
 * prefetch and the client hook so both use the same key.
 */
export function categorySpendQuery(
  categoryId: string,
  range: ResolvedPeriod,
  scope: FiscalFilter,
) {
  return {
    queryKey: supplierCategoriesKeys.spend(categoryId, range, scope),
    queryFn: async (): Promise<CategorySpend> => {
      const base = {
        from: range.from,
        to: range.to,
        categoryId,
        scope,
        limit: SUPPLIER_ROWS_LIMIT,
      };
      const [months, suppliers] = await Promise.all([
        runAction(() =>
          getSupplierPriceEvolutionAction({ ...base, groupBy: "category" }),
        ),
        runAction(() =>
          getSupplierPriceEvolutionAction({ ...base, groupBy: "supplier" }),
        ),
      ]);
      return summarizeCategorySpend(months, suppliers);
    },
  };
}

export function categoryPurchasesQuery(
  categoryId: string,
  range: ResolvedPeriod,
  scope: FiscalFilter,
) {
  return {
    queryKey: supplierCategoriesKeys.purchases(categoryId, range, scope),
    queryFn: () =>
      runAction(() =>
        listSupplierCategoryPurchasesAction({
          categoryId,
          from: range.from,
          to: range.to,
          isFiscal: isFiscalFor(scope),
          limit: CATEGORY_PURCHASES_LIMIT,
        }),
      ),
  };
}
