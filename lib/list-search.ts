/** The search box of a document list: digits match the document number
 *  exactly, anything else the counterparty's (client or supplier) legal name. Every list and its totals read it the same way. */
export function parseSearchTerm(term: string | null | undefined): {
  numero: number | null;
  name: string | null;
} {
  const trimmed = term?.trim() ?? "";
  if (trimmed.length === 0) return { numero: null, name: null };
  // Up to 9 digits: document numbers are int columns.
  if (/^\d{1,9}$/.test(trimmed)) return { numero: Number(trimmed), name: null };
  return { numero: null, name: trimmed };
}
