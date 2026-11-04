import type { Permission } from "@/lib/auth/permissions";

/** What opening the receipt form (Nuevo recibo, Cobrar) needs: writing
 *  receipts, and reading accounts, since every line picks one. Every entry
 *  point gates with `userCanAll` on this list. */
export const RECEIPT_FORM_PERMISSIONS = [
  "receipts:write",
  "accounts:read",
] as const satisfies readonly Permission[];
