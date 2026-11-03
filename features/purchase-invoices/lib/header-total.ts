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
