// Self-test for the definer-revoke gate. It only runs on a change that adds a
// migration, so these cases prove it still fires and still passes the house
// spellings of a revoke.
//
//   node --test .github/scripts/check-migration-definer-revoke.test.mjs

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { unrevokedDefiners } from "./check-migration-definer-revoke.mjs";

const DEFINER = `create or replace function public.do_thing(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- security definer inside a body comment
  perform 1;
end;
$$;
`;

test("a definer revoked from public, anon and authenticated passes", () => {
  assert.deepEqual(
    unrevokedDefiners(
      `${DEFINER}revoke all on function public.do_thing(uuid) from public, anon, authenticated;`,
    ),
    [],
  );
});

test("revoke execute and a reordered role list pass", () => {
  assert.deepEqual(
    unrevokedDefiners(
      `${DEFINER}REVOKE EXECUTE ON FUNCTION public.do_thing(uuid) FROM authenticated, PUBLIC, anon;`,
    ),
    [],
  );
});

test("a revoke split across two statements passes", () => {
  assert.deepEqual(
    unrevokedDefiners(
      `${DEFINER}revoke all on function public.do_thing(uuid) from public;\nrevoke execute on function public.do_thing(uuid) from anon, authenticated;`,
    ),
    [],
  );
});

test("a revoke from public only fails and names the missing roles", () => {
  assert.deepEqual(
    unrevokedDefiners(
      `${DEFINER}revoke all on function public.do_thing(uuid) from public;`,
    ),
    [{ name: "public.do_thing", missing: ["anon", "authenticated"] }],
  );
});

test("an unqualified name resolves to public", () => {
  assert.deepEqual(
    unrevokedDefiners(
      `${DEFINER}revoke all on function do_thing(uuid) from public, anon, authenticated;`,
    ),
    [],
  );
});

test("security definer in a comment or a literal is not a definer", () => {
  assert.deepEqual(
    unrevokedDefiners(
      `-- this used to be security definer\ncreate function public.plain() returns int language sql as $$ select 1 $$;\ncomment on function public.plain() is 'not (SECURITY DEFINER)';`,
    ),
    [],
  );
});

test("an invoker function needs no revoke", () => {
  assert.deepEqual(
    unrevokedDefiners(
      "create function public.plain() returns int language sql security invoker as $$ select 1 $$;",
    ),
    [],
  );
});

test("alter function to security definer without a revoke fails", () => {
  assert.deepEqual(
    unrevokedDefiners("alter function public.plain() security definer;"),
    [
      {
        name: "public.plain",
        missing: ["public", "anon", "authenticated"],
      },
    ],
  );
});
