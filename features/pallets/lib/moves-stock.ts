/** The pallet fields whose change is a stock movement: the deposit, the
 *  status, the quantity, the entry and the exit. Notes, code, client, product,
 *  area and lot are not. */
export type StockFields = {
  warehouse_id: string;
  status: string;
  quantity: number | null;
  entry_date: string;
  exit_date: string | null;
};

const STOCK_KEYS = [
  "warehouse_id",
  "status",
  "quantity",
  "entry_date",
  "exit_date",
] as const satisfies readonly (keyof StockFields)[];

/** Whether an edit changes a stock field of the stored pallet. A field left
 *  out (undefined) is unchanged; the edit dialog sends every field, so a
 *  field sent with its stored value is unchanged too. */
export function movesStock(
  stored: StockFields,
  edit: Partial<StockFields>,
): boolean {
  return STOCK_KEYS.some((key) => {
    const next = edit[key];
    if (next === undefined) return false;
    if (key === "quantity") {
      return (
        (next === null ? null : Number(next)) !==
        (stored.quantity === null ? null : Number(stored.quantity))
      );
    }
    return next !== stored[key];
  });
}
