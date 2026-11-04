import type { Permission } from "@/lib/auth/permissions";

/** Paying a sold check's buyer debits an account (a treasury movement), so it
 *  needs transactions:write besides cheques:write. payCheckSaleDebtAction and
 *  the Pagar button gate with `userCanAll` on this list; the button also needs
 *  accounts:read to pick the account. */
export const CHECK_SALE_DEBT_PAY_PERMISSIONS = [
  "cheques:write",
  "transactions:write",
] as const satisfies readonly Permission[];

export const CHECK_SALE_DEBT_PAY_DENIED_REASON =
  "Pagar mueve plata de una cuenta: necesitás también permiso para cargar movimientos.";
