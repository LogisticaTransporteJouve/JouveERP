/** The line ids a line write's input names: an id, an input with
 *  `line_id` or `line_ids`, or a list of those. */
export function lineIdsOf(input: unknown): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input.flatMap(lineIdsOf);
  if (input && typeof input === "object") {
    if ("line_id" in input && typeof input.line_id === "string") {
      return [input.line_id];
    }
    if ("line_ids" in input && Array.isArray(input.line_ids)) {
      return input.line_ids.filter((x): x is string => typeof x === "string");
    }
  }
  return [];
}
