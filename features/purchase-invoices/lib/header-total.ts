/** The header-mode total to set, or null to leave a total the user typed. It
 *  follows the derived sum while the total is empty or still equals the
 *  previous derived sum (±0.01). */
export function followHeaderTotal(
  current: number,
  previous: number | null,
  derived: number,
): number | null {
  if (current === 0) return derived;
  if (previous !== null && Math.abs(current - previous) < 0.01) return derived;
  return null;
}

/** Whether an edit changes any amount field (numerically) from what the form
 *  loaded. An older purchase whose total and parts differ still saves an edit
 *  that leaves them as they are. */
export function amountsDiffer<K extends string>(
  current: Record<K, string | undefined>,
  loaded: { readonly [P in NoInfer<K>]?: unknown } | undefined,
): boolean {
  for (const name in current) {
    if (Number(current[name] || 0) !== Number(loaded?.[name] || 0)) {
      return true;
    }
  }
  return false;
}

/** Where a total-minus-parts gap goes: no gravado on a fiscal A (it shows
 *  the field), the net otherwise. Null for no gap or a total below its parts. */
export function partsGapFix(
  gap: number | null,
  toNoGravado: boolean,
  values: { imp_neto: string; imp_no_gravado: string },
): { field: "imp_neto" | "imp_no_gravado"; value: string } | null {
  if (gap === null || gap <= 0) return null;
  const field = toNoGravado ? "imp_no_gravado" : "imp_neto";
  const current = Number(values[field] || 0);
  return { field, value: String(+(current + gap).toFixed(2)) };
}
