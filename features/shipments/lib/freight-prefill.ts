import { amountToInput } from "@/lib/format";

/** The flete a new carga's field should show once its client's tariff is
 *  known, or null to leave the field alone. Only a value the field took from
 *  a tariff (`lastAuto`), or an empty field, follows the tariff: a typed
 *  flete stays. A client or date with no tariff empties a prefilled one; a
 *  tariff that could not be read ("unknown") leaves the field alone. The
 *  value is es-AR text, as the MoneyInput shows it. */
export function nextFreightPrefill(input: {
  current: string;
  dirty: boolean;
  lastAuto: string | null;
  suggested: number | null | "unknown";
}): string | null {
  const { current, dirty, lastAuto, suggested } = input;
  if (suggested === "unknown") return null;
  const owned = current === "" || (lastAuto !== null && current === lastAuto);
  if (dirty || !owned) return null;
  const next = suggested === null ? "" : amountToInput(suggested);
  return next === current ? null : next;
}
