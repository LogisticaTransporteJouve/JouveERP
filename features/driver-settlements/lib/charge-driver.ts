import type { Permission } from "@/lib/auth/permissions";

/** Charging a rendición's difference to the driver (or taking it back)
 *  writes his employee account and moves the cash out to him, the same as
 *  a manual "Adelanto a empleado" (recordEmployeeAccountCashAction). Gate it
 *  with `userCanAll`. */
export const CHARGE_DRIVER_PERMISSIONS = [
  "hr:write",
  "transactions:write",
] as const satisfies readonly Permission[];
