// A bare `SET` in a migration is session-level: it outlives the migration's transaction and
// applies to every later migration on the same connection. `SET LOCAL` ends with the transaction.
//
//   node .github/scripts/check-migration-set-local.mjs <migration.sql>...
//
// Any statement that starts with `SET` fails unless it ends with the transaction: `SET LOCAL`,
// `SET CONSTRAINTS` or `SET TRANSACTION`. That relies on migrations running in a transaction,
// which squawk assumes too (`.squawk.toml`). `set_config(..., false)` is not covered.
//
// A line counts as a statement start only when the previous code line ends in `;`, so an UPDATE's
// `SET col = …` or an ALTER's `SET search_path` clause on a line of its own passes. One statement
// per line: a `SET` after another statement on the same line is not seen.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BARE_SET =
  /^\s*set\s+(?:session\s+)?(?!local\b|constraints\b|transaction\b)"?([a-z_][\w.]*)/i;

/** Each bare `SET` in `sql`, with its 1-based line and the setting it names. */
export function bareSets(sql) {
  const found = [];
  let statementStart = true;
  sql.split("\n").forEach((text, i) => {
    // Strip a trailing `--` comment, but not a `--` inside a '…' literal on this line.
    const code = text.replace(/^((?:[^'-]|'[^']*'|-(?!-))*)--.*$/, "$1").trim();
    if (!code) return;
    const match = statementStart && BARE_SET.exec(text);
    if (match) found.push({ line: i + 1, setting: match[1].toLowerCase() });
    statementStart = code.endsWith(";");
  });
  return found;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failed = false;
  for (const file of process.argv.slice(2)) {
    for (const { line, setting } of bareSets(readFileSync(file, "utf8"))) {
      console.log(
        `::error file=${file},line=${line}::SET ${setting} is session-level; use SET LOCAL ${setting}`,
      );
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
