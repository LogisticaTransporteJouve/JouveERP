const MONTH = /^\d{4}-\d{2}$/;

/** A YYYY-MM month. */
export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** The statement month a page opens on: the URL's `?month=`, if valid. */
export function monthParam(value: string | undefined): string | null {
  return value !== undefined && isMonth(value) ? value : null;
}
