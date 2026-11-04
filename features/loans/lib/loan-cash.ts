import type { Permission } from "@/lib/auth/permissions";

/** Paying a cuota, recording the disbursement or linking an existing egreso
 *  to a cuota moves Caja (or claims a Caja movement), the same as paying a
 *  tax (payTaxDocumentAction). Gate it with `userCanAll`. */
export const LOAN_CASH_PERMISSIONS = [
  "accounting:write",
  "transactions:write",
] as const satisfies readonly Permission[];
