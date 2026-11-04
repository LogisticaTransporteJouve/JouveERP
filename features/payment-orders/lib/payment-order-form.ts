import type { Permission } from "@/lib/auth/permissions";

/** What opening the OP form (Nueva OP, Pagar) needs: writing payment
 *  orders, and reading accounts, since every line picks one. Every entry
 *  point gates with `userCanAll` on this list. */
export const PAYMENT_ORDER_FORM_PERMISSIONS = [
  "payment_orders:write",
  "accounts:read",
] as const satisfies readonly Permission[];
