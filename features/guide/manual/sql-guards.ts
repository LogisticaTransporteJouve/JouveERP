// The text a user can still get back from the database: the body of the
// LATEST definition of each function across the migrations, comments removed.
// A guard reworded by a later `create or replace` no longer "exists", so a
// guide quoting the old message fails (manual.test.ts). An overload (same
// name, another argument list) is another function: each keeps its own
// latest body.

export type MigrationFile = { name: string; sql: string };

const CREATE_FUNCTION =
  /create\s+(?:or\s+replace\s+)?function\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(/gi;
const DROP_FUNCTION =
  /drop\s+function\s+(?:if\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(/gi;

function normalizeName(raw: string): string {
  const name = raw.replace(/"/g, "").toLowerCase();
  return name.includes(".") ? name : `public.${name}`;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** How many arguments the list that `rest` starts in declares (`rest`
 *  begins right after its opening parenthesis). */
function arity(rest: string): number {
  let depth = 0;
  let commas = 0;
  let empty = true;
  for (const ch of stripComments(rest)) {
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) commas += 1;
    else if (!/\s/.test(ch)) empty = false;
  }
  return empty ? 0 : commas + 1;
}

/** Function name → body of its last definition, in migration order (the
 *  file names sort by timestamp); the bodies of a name's overloads are
 *  joined. */
export function latestFunctionBodies(
  files: readonly MigrationFile[],
): Map<string, string> {
  const overloads = new Map<string, Map<number, string>>();
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of ordered) {
    const statements = [
      ...[...file.sql.matchAll(CREATE_FUNCTION)].map((m) => ({
        m,
        drop: false,
      })),
      ...[...file.sql.matchAll(DROP_FUNCTION)].map((m) => ({ m, drop: true })),
    ].sort((a, b) => a.m.index - b.m.index);
    for (const { m, drop } of statements) {
      const rest = file.sql.slice(m.index + m[0].length);
      const name = normalizeName(m[1] ?? "");
      const byArity = overloads.get(name) ?? new Map<number, string>();
      overloads.set(name, byArity);
      if (drop) {
        byArity.delete(arity(rest));
        continue;
      }
      const open = /\$([A-Za-z_]*)\$/.exec(rest);
      if (!open) continue;
      const tag = open[0];
      const start = open.index + tag.length;
      const end = rest.indexOf(tag, start);
      if (end < 0) continue;
      byArity.set(arity(rest), stripComments(rest.slice(start, end)));
    }
  }
  return new Map(
    [...overloads].map(([name, byArity]) => [
      name,
      [...byArity.values()].join("\n"),
    ]),
  );
}
