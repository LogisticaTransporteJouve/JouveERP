import type { Permission } from "@/lib/auth/permissions";

/** What a cheques write that moves or deletes treasury money needs: loading a
 *  check by hand (its cartera inflow, also from the AI scan), depositing,
 *  crediting, rejecting, selling, cancelling a sale and paying a sold check's
 *  debt. The action and the control that offers it gate with `userCanAll` on
 *  this list. */
export const CHECK_CASH_PERMISSIONS = [
  "cheques:write",
  "transactions:write",
] as const satisfies readonly Permission[];

/** Why the control is off for someone with cheques:write alone. */
export const CHECK_CASH_DENIED_REASON =
  "Mueve plata de una cuenta: necesitás también permiso para cargar movimientos.";
