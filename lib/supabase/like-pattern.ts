/** `text` with the LIKE wildcards `%` and `_` (and `\\`) taken literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * `ilike` pattern for a search, with the user's `%`, `_` and `\\` taken
 * literally. PostgREST turns `*` into `%`, so a `*` becomes `_`: one
 * character, which still matches a literal asterisk.
 */
export function containsPattern(search: string): string {
  return `%${escapeLike(search).replace(/\*/g, "_")}%`;
}
