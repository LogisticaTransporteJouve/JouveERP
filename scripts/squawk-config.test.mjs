// Self-test for the migration lint: every fixture in scripts/fixtures/squawk/
// runs through squawk under .squawk.toml and its verdict is asserted.
//
//   pnpm test:scripts
//
// The lint does nothing on a change that adds no migration, so the fixtures are
// what prove it still works after a squawk bump. They also pin .squawk.toml:
// squawk ignores config keys it does not recognise, so a typo there would drop
// a setting silently, and the fixtures tied to a setting (assume_in_transaction,
// included_rules) change verdict without it.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fromRoot = (path) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

const FIXTURES = fromRoot("scripts/fixtures/squawk");
const CONFIG = fromRoot(".squawk.toml");
const SQUAWK = fromRoot("node_modules/.bin/squawk");

/** Fixture -> the rule squawk must reject it for, or "pass". */
const EXPECTED = {
  // assume_in_transaction: a concurrent build beside any other statement makes
  // the migration non-atomic under `db push`...
  "fail-concurrent-index-not-alone.sql":
    "ban-concurrent-index-creation-in-transaction",
  // ...and a lone one is legal.
  "pass-concurrent-index-alone.sql": "pass",
  // The header CLAUDE.md tells authors to copy. assume_in_transaction again:
  // the exemption for an index on a table the same file creates needs it.
  "pass-migration-header.sql": "pass",
  // The header's timeouts as SET LOCAL, on a statement that locks an existing
  // table: squawk must count them, or every new migration would fail.
  "pass-set-local-header.sql": "pass",
  "fail-index-not-concurrent.sql": "require-concurrent-index-creation",
  "fail-missing-lock-timeout.sql": "require-lock-timeout",
  "fail-missing-statement-timeout.sql": "require-statement-timeout",
  // included_rules = ["require-table-schema"].
  "fail-unqualified-table.sql": "require-table-schema",
  "pass-squawk-ignore.sql": "pass",
};

const runSquawk = (fixture) => {
  const r = spawnSync(
    SQUAWK,
    ["--reporter=gcc", "-c", CONFIG, `${FIXTURES}/${fixture}`],
    { encoding: "utf8" },
  );
  if (r.error) throw r.error;
  return { code: r.status, output: `${r.stdout}${r.stderr}` };
};

for (const [fixture, expected] of Object.entries(EXPECTED)) {
  test(`${fixture}: ${expected}`, () => {
    const { code, output } = runSquawk(fixture);
    if (expected === "pass") {
      assert.equal(
        code,
        0,
        `squawk should accept ${fixture} but reported:\n${output}`,
      );
    } else {
      assert.equal(code, 1, `squawk should reject ${fixture} but accepted it`);
      assert.match(
        output,
        new RegExp(expected),
        `squawk rejected ${fixture} for the wrong reason:\n${output}`,
      );
    }
  });
}

test("every fixture on disk has an expectation", () => {
  const onDisk = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.deepEqual(onDisk, Object.keys(EXPECTED).sort());
});

test("pg_version matches supabase/config.toml major_version", () => {
  const major = readFileSync(fromRoot("supabase/config.toml"), "utf8").match(
    /^major_version\s*=\s*(\d+)/m,
  )?.[1];
  const pgVersion = readFileSync(CONFIG, "utf8").match(
    /^pg_version\s*=\s*"([^"]+)"/m,
  )?.[1];
  assert.ok(major, "major_version not found in supabase/config.toml");
  assert.ok(pgVersion, "pg_version not found in .squawk.toml");
  assert.equal(pgVersion.split(".")[0], major);
});

// The fixtures pin only the rules they exercise; turning off any other default
// rule would pass them.
test(".squawk.toml turns off no rule", () => {
  assert.doesNotMatch(
    readFileSync(CONFIG, "utf8"),
    /^\s*(excluded_rules|disable_rules)\s*=/m,
  );
});
