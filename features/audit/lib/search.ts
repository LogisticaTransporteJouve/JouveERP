/** Shortest search the box runs: one character matches nearly everything. */
export const AUDIT_SEARCH_MIN = 2;

/**
 * The search box's text as audit_events.search_text stores it: lowercase,
 * without accents, single spaces. Twin of the SQL
 * `public.audit_search_normalize`. Null when too short to search.
 */
export function normalizeAuditSearch(
  q: string | null | undefined,
): string | null {
  const text = (q ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= AUDIT_SEARCH_MIN ? text : null;
}
