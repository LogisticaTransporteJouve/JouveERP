const MONTH = /^\d{4}-\d{2}$/;

/** A YYYY-MM month. */
export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** The statement month a page opens on: the URL's `?month=`, if valid. */
export function monthParam(value: string | undefined): string | null {
  return value !== undefined && isMonth(value) ? value : null;
}

/** The first and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}
