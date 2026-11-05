// The text a user can still get back from the database: the body of the
// LATEST definition of each function across the migrations, comments removed.
// A guard reworded by a later `create or replace` no longer "exists", so a
// guide quoting the old message fails (manual.test.ts).

export type MigrationFile = { name: string; sql: string };

const CREATE_FUNCTION =
  /create\s+(?:or\s+replace\s+)?function\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(/gi;

function normalizeName(raw: string): string {
  const name = raw.replace(/"/g, "").toLowerCase();
  return name.includes(".") ? name : `public.${name}`;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Function name → body of its last definition, in migration order (the
 *  file names sort by timestamp). */
export function latestFunctionBodies(
  files: readonly MigrationFile[],
): Map<string, string> {
  const bodies = new Map<string, string>();
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of ordered) {
    for (const m of file.sql.matchAll(CREATE_FUNCTION)) {
      const rest = file.sql.slice(m.index + m[0].length);
      const open = /\$([A-Za-z_]*)\$/.exec(rest);
      if (!open) continue;
      const tag = open[0];
      const start = open.index + tag.length;
      const end = rest.indexOf(tag, start);
      if (end < 0) continue;
      bodies.set(
        normalizeName(m[1] ?? ""),
        stripComments(rest.slice(start, end)),
      );
    }
  }
  return bodies;
}
