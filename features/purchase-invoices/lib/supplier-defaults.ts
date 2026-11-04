import type { CostTagOptions } from "@/features/cost-centers/schema";

type CostDefault = { name: "account_id" | "cost_center_id"; id: string };

/** The supplier defaults a new factura takes: its expense account and cost
 *  center, only when still offered (an active postable account, an active
 *  center). A retired one, such as FLOTA_DZ, is left for the user to pick.
 *  Nothing until the options are read: offered or not is unknown. */
export function supplierCostDefaults(
  supplier: {
    default_expense_account_id: string | null;
    default_cost_center_id: string | null;
  },
  options: CostTagOptions | undefined,
): CostDefault[] {
  if (!options) return [];
  const result: CostDefault[] = [];
  const account = supplier.default_expense_account_id;
  if (account && options.expenseAccounts.some((o) => o.id === account)) {
    result.push({ name: "account_id", id: account });
  }
  const center = supplier.default_cost_center_id;
  if (center && options.costCenters.some((o) => o.id === center)) {
    result.push({ name: "cost_center_id", id: center });
  }
  return result;
}
