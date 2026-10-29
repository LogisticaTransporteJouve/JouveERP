// A SECURITY DEFINER function runs with its owner's rights, and Supabase grants
// EXECUTE on every new public function to anon and authenticated through
// PostgREST. A new migration that creates one must revoke it from all three
// roles in the same file (granting back only to whom it is meant for).
//
//   node .github/scripts/check-migration-definer-revoke.mjs <migration.sql>...
//
// Comments, '…' literals and $tag$…$tag$ bodies are blanked before statements
// are split on `;`, so `security definer` only counts in a function header and
// a mention in a comment or COMMENT ON literal does not. A revoke built inside a
// DO block (format/EXECUTE) is not seen; write it as a plain statement.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REQUIRED = ["public", "anon", "authenticated"];

/** `sql` with comments, string literals and dollar-quoted bodies blanked. */
function outsideCode(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      i = j + 1;
      out += "''";
      continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(rest);
    if (tag) {
      const end = sql.indexOf(tag[0], i + tag[0].length);
      i = end === -1 ? sql.length : end + tag[0].length;
      out += " $body$ ";
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function normalizeName(raw) {
  const name = raw.replaceAll('"', "").toLowerCase();
  return name.includes(".") ? name : `public.${name}`;
}

const NAME = String.raw`((?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))?)`;
const CREATE = new RegExp(
  String.raw`^create\s+(?:or\s+replace\s+)?function\s+${NAME}\s*\(`,
);
const ALTER = new RegExp(String.raw`^alter\s+function\s+${NAME}\b`);
const REVOKE = new RegExp(
  String.raw`^revoke\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+${NAME}\b[\s\S]*?\bfrom\s+([\s\S]+?)(?:\s+(?:cascade|restrict))?$`,
);

/** Definer functions in `sql` whose EXECUTE is not revoked from all of REQUIRED. */
export function unrevokedDefiners(sql) {
  const statements = outsideCode(sql)
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const definers = new Set();
  const revoked = new Map();
  for (const statement of statements) {
    const created = CREATE.exec(statement) ?? ALTER.exec(statement);
    if (created && /\bsecurity definer\b/.test(statement)) {
      definers.add(normalizeName(created[1]));
    }
    const revoke = REVOKE.exec(statement);
    if (revoke) {
      const name = normalizeName(revoke[1]);
      const roles = revoked.get(name) ?? new Set();
      for (const role of revoke[2].split(",")) roles.add(role.trim());
      revoked.set(name, roles);
    }
  }
  return [...definers]
    .map((name) => ({
      name,
      missing: REQUIRED.filter((role) => !revoked.get(name)?.has(role)),
    }))
    .filter(({ missing }) => missing.length > 0);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failed = false;
  for (const file of process.argv.slice(2)) {
    for (const { name, missing } of unrevokedDefiners(
      readFileSync(file, "utf8"),
    )) {
      console.log(
        `::error file=${file}::${name} is SECURITY DEFINER; revoke EXECUTE from ${missing.join(", ")} in the same migration`,
      );
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
