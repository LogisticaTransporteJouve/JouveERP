import type { Permission } from "@/lib/auth/permissions";

/** What an HR write that moves treasury money needs: a salary payment
 *  (single, bulk, edit or delete), an advance or an employee's payment, and
 *  deleting an account movement that has a Caja movement. The action and
 *  the control that offers it gate with `userCanAll` on this list. */
export const HR_CASH_PERMISSIONS = [
  "hr:write",
  "transactions:write",
] as const satisfies readonly Permission[];

/** Why the control is off for someone with hr:write alone. */
export const HR_CASH_DENIED_REASON =
  "Mueve plata de Caja o bancos: necesitás también permiso para cargar movimientos.";

/** Whether deleting this account movement also deletes its Caja movement. */
export function movementMovesCash(m: { transaction_id: string | null }) {
  return m.transaction_id !== null;
}
