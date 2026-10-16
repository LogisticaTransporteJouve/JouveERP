import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Static view of supabase/migrations for tests that assert on the deployed
// schema without a database: every migration concatenated in apply order.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

export const ALL_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");

/** Source of the last `create [or replace] function public.<fn>(` up to the
 *  end of its `$$` body. */
export function latestDefinition(fn: string): string {
  const header = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(`,
    "gi",
  );
  let lastStart = -1;
  for (const match of ALL_SQL.matchAll(header)) {
    lastStart = match.index ?? -1;
  }
  if (lastStart < 0) throw new Error(`No definition found for ${fn}`);
  const open = ALL_SQL.indexOf("$$", lastStart);
  const close = ALL_SQL.indexOf("$$", open + 2);
  return ALL_SQL.slice(lastStart, close + 2);
}

/** Last match of `pattern` (which must carry the `g` flag) across all
 *  migrations, or null. */
export function lastStatement(pattern: RegExp): string | null {
  let last: string | null = null;
  for (const match of ALL_SQL.matchAll(pattern)) last = match[0];
  return last;
}
