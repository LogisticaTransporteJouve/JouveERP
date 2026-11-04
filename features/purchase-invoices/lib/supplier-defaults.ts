import type { CostTagOptions } from "@/features/cost-centers/schema";

import type { PurchaseInvoiceKind } from "../schema";

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

/** The supplier defaults a saved factura still holds: on an edit, these are
 *  what the defaults wrote, so turning it into an NC/ND clears them as on
 *  create (supplierCostWrites) and its origin's are inherited. */
export function storedSupplierCostDefaults(
  stored: { account_id: string | null; cost_center_id: string | null },
  supplier: {
    default_expense_account_id: string | null;
    default_cost_center_id: string | null;
  },
): CostDefault[] {
  const result: CostDefault[] = [];
  const account = supplier.default_expense_account_id;
  if (account && stored.account_id === account) {
    result.push({ name: "account_id", id: account });
  }
  const center = supplier.default_cost_center_id;
  if (center && stored.cost_center_id === center) {
    result.push({ name: "cost_center_id", id: center });
  }
  return result;
}

/** The account and center a scanned document suggested (its draft). */
export function suggestedCostDefaults(
  draft: {
    account: { id: string } | null;
    cost_center_id: string | null;
  } | null,
): CostDefault[] {
  const result: CostDefault[] = [];
  if (draft?.account) result.push({ name: "account_id", id: draft.account.id });
  if (draft?.cost_center_id) {
    result.push({ name: "cost_center_id", id: draft.cost_center_id });
  }
  return result;
}

/** The defaults for the type picked: for a factura, the supplier's over the
 *  scanned document's suggestion, field by field. An NC/ND takes none, so
 *  its account and center stay empty and the trigger copies its origin's
 *  (purchase_invoices_nc_nd_inherit_account). */
export function purchaseCostDefaults(
  kind: PurchaseInvoiceKind,
  suggested: readonly CostDefault[],
  supplier: readonly CostDefault[],
): CostDefault[] {
  if (kind !== "factura") return [];
  return COST_FIELDS.flatMap((name) => {
    const pick =
      supplier.find((d) => d.name === name) ??
      suggested.find((d) => d.name === name);
    return pick ? [pick] : [];
  });
}

/** What a new purchase's account and center fields take when its defaults
 *  (its supplier, or its type) change: the new defaults, and "" for a field
 *  the previous defaults prefilled that still holds it. A field the user
 *  touched is kept. */
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
