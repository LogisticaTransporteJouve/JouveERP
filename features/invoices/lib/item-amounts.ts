import { amountToInput, parseArAmount } from "@/lib/format";

/** invoice_items.quantity and unit_price are numeric(15,4). */
export const ITEM_DECIMALS = 4;

/** An item's quantity or price as the MoneyInput shows it ("1.500,50"). */
export function itemInput(value: number): string {
  return amountToInput(value, ITEM_DECIMALS);
}

/** The number an item's es-AR text stands for; blank or unreadable is 0. */
export function itemNumber(raw: string): number {
  return parseArAmount(raw) ?? 0;
}
