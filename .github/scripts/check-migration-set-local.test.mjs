// Self-test for the bare-SET gate. It only runs on a PR that adds a migration, so these cases
// prove it still fires, and still passes the shapes that look like a SET but are not one.
//
//   node --test .github/scripts/check-migration-set-local.test.mjs

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bareSets } from "./check-migration-set-local.mjs";

test("flags a session-level SET and names its setting", () => {
  assert.deepEqual(bareSets("  set lock_timeout = '1s';"), [
    { line: 1, setting: "lock_timeout" },
  ]);
  assert.deepEqual(bareSets("SET SESSION statement_timeout = '5s';"), [
    { line: 1, setting: "statement_timeout" },
  ]);
  assert.deepEqual(bareSets('SET "Search_Path" = public;'), [
    { line: 1, setting: "search_path" },
  ]);
  assert.deepEqual(bareSets("SET search_path\n  TO public;"), [
    { line: 1, setting: "search_path" },
  ]);
  assert.deepEqual(
    bareSets("COMMENT ON TABLE t IS 'a -- b';\nSET lock_timeout = '1s';"),
    [{ line: 2, setting: "lock_timeout" }],
  );
  assert.deepEqual(bareSets("BEGIN; -- start\n\nSET ROLE postgres;"), [
    { line: 3, setting: "role" },
  ]);
});

test("passes SETs that end with the transaction, and SET clauses of other statements", () => {
  const sql = [
    "SET LOCAL lock_timeout = '5s';",
    "SET CONSTRAINTS ALL DEFERRED;",
    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;",
    "CREATE FUNCTION f() RETURNS void",
    "  LANGUAGE plpgsql",
    "  SET search_path TO 'public', 'pg_temp'",
    "AS $$ BEGIN END $$;",
    "UPDATE public.organization_members",
    "  SET role = p_role WHERE id = p_id;",
  ].join("\n");
  assert.deepEqual(bareSets(sql), []);
});
