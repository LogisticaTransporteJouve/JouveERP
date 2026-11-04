import type { CostTagOptions } from "@/features/cost-centers/schema";

type CostField = "account_id" | "cost_center_id";
export type CostDefault = { name: CostField; id: string };

const COST_FIELDS: readonly CostField[] = ["account_id", "cost_center_id"];

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

/** What a new factura's account and center fields take when its supplier's
 *  defaults arrive: the new supplier's, and "" for a field the previous
 *  supplier prefilled that still holds it. A field the user touched is kept. */
export function supplierCostWrites(
  previous: readonly CostDefault[],
  next: readonly CostDefault[],
  field: (name: CostField) => { value: string; dirty: boolean },
): CostDefault[] {
  const writes: CostDefault[] = [];
  for (const name of COST_FIELDS) {
    const { value, dirty } = field(name);
    if (dirty) continue;
    const id = next.find((d) => d.name === name)?.id;
    if (id !== undefined) {
      writes.push({ name, id });
    } else if (previous.some((d) => d.name === name && d.id === value)) {
      writes.push({ name, id: "" });
    }
  }
  return writes;
}
