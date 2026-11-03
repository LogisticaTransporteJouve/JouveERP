-- AI CFO 6.3 + 6.4 (20261103160000): ai_proposals moves only pending →
-- accepted | dismissed | expired and accepted → failed; an expired proposal
-- cannot be accepted; what the user saw never changes; one pending proposal
-- per user and key; each user reads only their own rows. ai_insights shows
-- the new kinds to the roles of their domain. One transaction, rolled back.

begin;

select plan(18);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a601', 'finance@proposals.test'),
  ('00000000-0000-0000-0000-00000000a602', 'ops@proposals.test'),
  ('00000000-0000-0000-0000-00000000a603', 'warehouse@proposals.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000a601', 'finance'),
  ('00000000-0000-0000-0000-00000000a602', 'operations'),
  ('00000000-0000-0000-0000-00000000a603', 'warehouse');

insert into public.ai_insights (id, kind, severity, title, finding) values
  ('00000000-0000-0000-0000-00000000a6c1', 'late_interest_uncharged', 'warning', 'Mora', 'x'),
  ('00000000-0000-0000-0000-00000000a6c2', 'vehicle_cost_per_km', 'warning', 'Km', 'x'),
  ('00000000-0000-0000-0000-00000000a6c3', 'unreconciled_bank_lines', 'warning', 'Banco', 'x');

insert into public.ai_proposals
  (id, user_id, action, source, insight_id, dedupe_key, draft, summary, title, expires_at)
values
  ('00000000-0000-0000-0000-00000000a6d1', '00000000-0000-0000-0000-00000000a601',
   'proposeTask', 'insight', '00000000-0000-0000-0000-00000000a6c1', 'proposeTask:a',
   '{"title":"x"}', '[]', 'Crear tarea', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000a6d2', '00000000-0000-0000-0000-00000000a601',
   'proposeTask', 'insight', null, 'proposeTask:b',
   '{"title":"y"}', '[]', 'Crear tarea', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-00000000a6d3', '00000000-0000-0000-0000-00000000a602',
   'proposeTask', 'insight', null, 'proposeTask:a',
   '{"title":"z"}', '[]', 'Crear tarea', now() + interval '1 day');

-- 1. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.guard_ai_proposal()', 'execute')
  and not has_function_privilege('anon', 'public.guard_ai_proposal()', 'execute'),
  'the guard function is not exposed'
);

select ok(
  has_table_privilege('authenticated', 'public.ai_proposals', 'select')
  and not has_table_privilege('authenticated', 'public.ai_proposals', 'insert')
  and not has_table_privilege('authenticated', 'public.ai_proposals', 'update')
  and not has_table_privilege('anon', 'public.ai_proposals', 'select'),
  'authenticated only reads ai_proposals; anon nothing'
);

-- 2. One pending per user and key ---------------------------------------------

select throws_ok(
  $$insert into public.ai_proposals
      (user_id, action, source, dedupe_key, draft, summary, title, expires_at)
    values ('00000000-0000-0000-0000-00000000a601', 'proposeTask', 'insight',
            'proposeTask:a', '{}', '[]', 'Crear tarea', now() + interval '1 day')$$,
  '23505',
  null,
  'a second pending proposal with the same key is refused'
);

-- 3. Transitions (as owner of the table: the guard, not RLS) -------------------

reset role;

select throws_ok(
  $$update public.ai_proposals set status = 'accepted', decided_at = now()
     where id = '00000000-0000-0000-0000-00000000a6d2'$$,
  '55006',
  null,
  'an expired proposal cannot be accepted'
);

select lives_ok(
  $$update public.ai_proposals set status = 'expired', decided_at = now()
     where id = '00000000-0000-0000-0000-00000000a6d2'$$,
  'an overdue pending proposal moves to expired'
);

select throws_ok(
  $$update public.ai_proposals set draft = '{"title":"otra"}'
     where id = '00000000-0000-0000-0000-00000000a6d1'$$,
  '55006',
  null,
  'the draft the user saw never changes'
);

select throws_ok(
  $$update public.ai_proposals set result = '{"id":"x"}'
     where id = '00000000-0000-0000-0000-00000000a6d1'$$,
  '55006',
  null,
  'a pending proposal has no result'
);

select lives_ok(
  $$update public.ai_proposals set status = 'accepted', decided_at = now()
     where id = '00000000-0000-0000-0000-00000000a6d1' and status = 'pending'$$,
  'a pending proposal is accepted'
);

select is(
  (select count(*)::int from public.ai_proposals
    where id = '00000000-0000-0000-0000-00000000a6d1' and status = 'accepted'),
  1,
  'the claim moved it to accepted'
);

select throws_ok(
  $$update public.ai_proposals set status = 'pending', decided_at = null
     where id = '00000000-0000-0000-0000-00000000a6d1'$$,
  '55006',
  null,
  'an accepted proposal never goes back to pending'
);

select lives_ok(
  $$update public.ai_proposals set result = '{"id":"t1"}'
     where id = '00000000-0000-0000-0000-00000000a6d1'$$,
  'the outcome is stored after the claim'
);

select lives_ok(
  $$update public.ai_proposals set status = 'failed', error = 'boom'
     where id = '00000000-0000-0000-0000-00000000a6d1'$$,
  'an accepted proposal whose write failed moves to failed'
);

select throws_ok(
  $$update public.ai_proposals set status = 'dismissed'
     where id = '00000000-0000-0000-0000-00000000a6d1'$$,
  '55006',
  null,
  'a failed proposal is final'
);

select lives_ok(
  $$delete from public.ai_insights where id = '00000000-0000-0000-0000-00000000a6c1'$$,
  'the analyst can replace an insight a proposal points at'
);

-- 4. RLS -------------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a602","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ai_proposals),
  1,
  'operations reads only its own proposal'
);
select is(
  (select array_agg(kind order by kind) from public.ai_insights
    where id in ('00000000-0000-0000-0000-00000000a6c2', '00000000-0000-0000-0000-00000000a6c3')),
  array['vehicle_cost_per_km'],
  'operations sees the fleet indicator, not the bank one'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a601","role":"authenticated"}', true);
select is(
  (select array_agg(kind order by kind) from public.ai_insights
    where id in ('00000000-0000-0000-0000-00000000a6c2', '00000000-0000-0000-0000-00000000a6c3')),
  array['unreconciled_bank_lines'],
  'finance sees the bank indicator, not the fleet one'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a603","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ai_proposals),
  0,
  'a role without ai:read reads no proposal'
);

reset role;

select * from finish(true);

rollback;
