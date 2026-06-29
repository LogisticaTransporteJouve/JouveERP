// Inclusive days a pallet has been stored: from entry to exit, or to `asOf`
// (today) while it's still in deposit. Pure, no DB.

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function storedDays(
  entry: string,
  exit: string | null,
  asOf: string,
): number {
  const start = dayNum(entry);
  const end = exit ? dayNum(exit) : dayNum(asOf);
  return end >= start ? end - start + 1 : 0;
}
