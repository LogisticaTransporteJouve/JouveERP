-- set_user_access, user_permission_denies and search_global(p_types).
-- Runs as postgres; the per-user policy cases switch to `authenticated` with
-- a JWT claim. One transaction, rolled back.

begin;

select plan(24);

-- Users: a standing owner, an admin actor, two finance users, one operations
-- and one warehouse user.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@access.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@access.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'finance@access.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'finance2@access.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'ops@access.test'),
  ('00000000-0000-0000-0000-0000000000a6', 'warehouse@access.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin'),
  ('00000000-0000-0000-0000-0000000000a4', 'finance'),
  ('00000000-0000-0000-0000-0000000000a5', 'operations'),
  ('00000000-0000-0000-0000-0000000000a6', 'warehouse');

-- Shape and grants --------------------------------------------------------

select col_is_pk('public', 'user_permission_denies', array['user_id', 'permission'],
  'user_permission_denies is keyed by (user_id, permission)');

select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.user_permission_denies'::regclass
      and contype = 'f' and conkey = array[1]::smallint[]),
  'c',
  'a deleted auth user takes its denies with it'
);

select is(
  (select proacl::text from pg_proc where oid = 'public.set_user_access(uuid,uuid,text[],text[],text[],text[],text[],text[])'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres}',
  'set_user_access is executable by the service role only'
);

select ok(
  has_function_privilege('authenticated', 'public.search_global(text,integer,text[])', 'execute')
  and not has_function_privilege('anon', 'public.search_global(text,integer,text[])', 'execute'),
  'search_global(text, integer, text[]) is for authenticated, not anon'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_global'),
  1,
  'search_global has a single overload'
);

-- Last owner: the deferred trigger checks at commit, so make it immediate for
-- this one call and put it back right after.
set constraints public.user_roles_owner_minimum_trigger immediate;
select throws_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1',
      '{}', null, '{}', '{owner}', null, null)$$,
  '23514',
  null,
  'removing the last owner fails'
);
set constraints public.user_roles_owner_minimum_trigger deferred;

-- Writes ------------------------------------------------------------------

select throws_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3',
      '{finance}', null, '{finance}', '{}', null, null)$$,
  'UA001',
  null,
  'nobody edits their own access'
);

select lives_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
      '{finance}', '{accounts:read}', '{finance}', '{}', '{}', '{}')$$,
  'an allowed role and a deny are written together'
);

select results_eq(
  $$select role_id, granted_by::text from public.user_roles
     where user_id = '00000000-0000-0000-0000-0000000000a3'$$,
  $$values ('finance', '00000000-0000-0000-0000-0000000000a2')$$,
  'the role is stored with who granted it'
);

select results_eq(
  $$select permission from public.user_permission_denies
     where user_id = '00000000-0000-0000-0000-0000000000a3'$$,
  $$values ('accounts:read')$$,
  'the deny is stored'
);

select results_eq(
  $$select event_type, target_user_id::text, actor_id::text from public.audit_events
     where target_user_id = '00000000-0000-0000-0000-0000000000a3' order by event_type$$,
  $$values ('user.access.updated', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2'),
           ('user.roles.updated', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2')$$,
  'each change is audited against the target user'
);

select lives_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
      '{finance}', '{accounts:read}', '{finance}', '{}', null, null)$$,
  'saving the same access again succeeds'
);

select is(
  (select count(*)::int from public.audit_events
    where target_user_id = '00000000-0000-0000-0000-0000000000a3'),
  2,
  'a save that changes nothing writes no audit row'
);

select throws_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
      '{finance,operations}', null, '{finance}', '{}', null, null)$$,
  'UA003',
  null,
  'a role outside p_addable_roles is refused'
);

select throws_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
      '{}', null, '{}', '{}', null, null)$$,
  'UA003',
  null,
  'removing a role outside p_removable_roles is refused'
);

select throws_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
      null, '{}', '{}', '{}', '{}', null)$$,
  'UA002',
  null,
  'a save based on stale roles is refused'
);

select lives_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
      null, '{}', '{}', '{}', null, null)$$,
  'p_roles null leaves the roles alone while denies change'
);

select is(
  (select count(*)::int from public.user_roles
    where user_id = '00000000-0000-0000-0000-0000000000a3'),
  1,
  'the roles survived a denies-only save'
);

-- Owner promotion clears denies, whatever p_denied says.
select lives_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4',
      null, '{invoices:read}', '{}', '{}', null, null)$$,
  'a finance user gets a deny'
);
select lives_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4',
      '{finance,owner}', '{invoices:read,clients:read}', '{finance,owner}', '{}', null, null)$$,
  'the finance user is promoted to owner'
);
select is(
  (select count(*)::int from public.user_permission_denies
    where user_id = '00000000-0000-0000-0000-0000000000a4'),
  0,
  'an owner keeps no denies'
);

-- RLS: a user reads only their own denies ---------------------------------

select lives_ok(
  $$select public.set_user_access(
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5',
      null, '{trips:read}', '{}', '{}', null, null)$$,
  'the operations user gets a deny'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
select results_eq(
  $$select user_id::text, permission from public.user_permission_denies$$,
  $$values ('00000000-0000-0000-0000-0000000000a5', 'trips:read')$$,
  'a non-admin sees only their own deny rows'
);
reset role;

-- search_global: p_types narrows, never widens ----------------------------

insert into public.clients (cuit, legal_name, iva_condition)
  values ('30000000007', 'Zorzaltestclient SA', 'responsable_inscripto');
insert into public.suppliers (cuit, legal_name, iva_condition)
  values ('30000000015', 'Zorzaltestsupplier SA', 'responsable_inscripto');
refresh materialized view public.search_index;

create temporary table search_cases (role_user uuid, types text[], found text[]);
grant all on search_cases to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
insert into search_cases
  select '00000000-0000-0000-0000-0000000000a5', null,
    (select coalesce(array_agg(entity_type order by entity_type), '{}') from public.search_global('Zorzaltestclient or Zorzaltestsupplier', 50));
insert into search_cases
  select '00000000-0000-0000-0000-0000000000a5', '{supplier}',
    (select coalesce(array_agg(entity_type order by entity_type), '{}') from public.search_global('Zorzaltestclient or Zorzaltestsupplier', 50, '{supplier}'));
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
insert into search_cases
  select '00000000-0000-0000-0000-0000000000a6', '{client,supplier}',
    (select coalesce(array_agg(entity_type order by entity_type), '{}') from public.search_global('Zorzaltestclient or Zorzaltestsupplier', 50, '{client,supplier}'));
reset role;

select results_eq(
  $$select found from search_cases order by role_user, types nulls first$$,
  $$values ('{client,supplier}'::text[]), ('{supplier}'::text[]), ('{}'::text[])$$,
  'search sees both rows without p_types, only suppliers with {supplier}, and nothing for a role whose ceiling excludes them'
);

select * from finish(true);

rollback;
