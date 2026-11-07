import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";

/** Why paying (or undoing) a part of a card statement is not this user's,
 *  beyond the treasury write the caller already checked: the part books
 *  salary advances (Personal's write, as an advance from Personal) and tax
 *  credits (Impuestos' write, as a tax line of a statement). Null when it is. */
export function cardPartDenied(
  access: Access,
  lines: readonly { treatment: string; chart_account_id: string | null }[],
  taxAccountIds: ReadonlySet<string>,
): string | null {
  if (
    lines.some((l) => l.treatment === "advance") &&
    !userCan(access, "hr:write")
  ) {
    return "El resumen tiene adelantos de sueldo: hace falta permiso de Personal.";
  }
  if (
    lines.some(
      (l) =>
        l.chart_account_id !== null && taxAccountIds.has(l.chart_account_id),
    ) &&
    !userCan(access, "taxes:write")
  ) {
    return "El resumen tiene impuestos a favor: hace falta permiso de Impuestos.";
  }
  return null;
}
