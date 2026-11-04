import type { Permission } from "@/lib/auth/permissions";

import type { IssuedCheckTransitionInput } from "../schema";

/** What marking an own check «Cobrado» or «Rechazado» needs: cashing one
 *  without a payment order books its bank outflow and bouncing one of an
 *  order books the bank inflow back (issued_check_cashed_outflow,
 *  issued_check_rejected_inflow). The own-check side of
 *  CHECK_CASH_PERMISSIONS. Annulling books no movement and needs
 *  issued_checks:write alone. */
export const ISSUED_CHECK_CASH_PERMISSIONS = [
  "issued_checks:write",
  "transactions:write",
] as const satisfies readonly Permission[];

export function transitionMovesMoney(
  to: IssuedCheckTransitionInput["to_status"],
): boolean {
  return to === "cashed" || to === "rejected";
}
