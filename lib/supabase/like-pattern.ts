/**
 * `ilike` pattern for a search, with the user's `%`, `_` and `\\` taken
 * literally. PostgREST turns `*` into `%`, so a `*` becomes `_`: one
 * character, which still matches a literal asterisk.
 */
export function containsPattern(search: string): string {
  const escaped = search
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/\*/g, "_");
  return `%${escaped}%`;
}
