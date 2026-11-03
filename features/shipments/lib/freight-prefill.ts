/** The flete a new carga's field should show once its client's tariff is
 *  known, or null to leave the field alone. Only a value the field took from
 *  a tariff (`lastAuto`), or an empty field, follows the tariff: a typed
 *  flete stays. A client or date with no tariff empties a prefilled one. */
export function nextFreightPrefill(input: {
  current: string;
  dirty: boolean;
  lastAuto: string | null;
  suggested: number | null;
}): string | null {
  const { current, dirty, lastAuto, suggested } = input;
  const owned = current === "" || (lastAuto !== null && current === lastAuto);
  if (dirty || !owned) return null;
  const next = suggested === null ? "" : String(suggested);
  return next === current ? null : next;
}
