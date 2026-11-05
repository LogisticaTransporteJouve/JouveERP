import type { ResolvedPeriod } from "@/lib/list-period";
import type { FiscalFilter } from "@/lib/scope";

export const supplierCategoriesKeys = {
  all: ["supplier_categories"] as const,
  list: (onlyActive: boolean) =>
    [...supplierCategoriesKeys.all, "list", { onlyActive }] as const,
  canCreate: () => [...supplierCategoriesKeys.all, "can-create"] as const,
  spend: (id: string, range: ResolvedPeriod, scope: FiscalFilter) =>
    [...supplierCategoriesKeys.all, "spend", id, range, { scope }] as const,
  purchases: (id: string, range: ResolvedPeriod, scope: FiscalFilter) =>
    [...supplierCategoriesKeys.all, "purchases", id, range, { scope }] as const,
};
