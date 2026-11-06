-- create_ai_confirmation_revision (20261106111003): the next revision of a
-- chat proposal and the supersede of the one it replaces, in one transaction;
-- a revision that lost the race writes nothing. Service role only. One
-- transaction, rolled back.

begin;

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009a1', 'finance@ai-revision.test');
insert into public.ai_chat_sessions (id, user_id) values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009a1');

select ok(
  not has_function_privilege('authenticated',
    'public.create_ai_confirmation_revision(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.create_ai_confirmation_revision(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.create_ai_confirmation_revision(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, uuid)', 'execute'),
  'only the service role stores revisions'
);

create temporary table t_r1 as
  select * from public.create_ai_confirmation_revision(
    '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
    'call-1', 'proposeExchangeRate', 'k1', 'assistant',
    '{"rate":1200}', '{}', '[]');

select is((select revision from t_r1), 1, 'the first revision is 1');

create temporary table t_r2 as
  select * from public.create_ai_confirmation_revision(
    '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
    'call-1', 'proposeExchangeRate', 'k1', 'user',
    '{"rate":1250}', '{}', '[]', (select id from t_r1));

select results_eq(
  $$select revision, status, origin from public.ai_chat_confirmations
     where revision_key = 'k1' order by revision$$,
  $$values (1, 'superseded'::text, 'assistant'::text), (2, 'pending'::text, 'user'::text)$$,
  'an edit supersedes the revision it replaces and adds the next one'
);

select ok(
  (select decided_at is not null from public.ai_chat_confirmations where id = (select id from t_r1)),
  'the superseded revision is stamped decided'
);

select throws_like(
  $$select * from public.create_ai_confirmation_revision(
      '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
      'call-1', 'proposeExchangeRate', 'k1', 'user', '{"rate":1}', '{}', '[]',
      (select id from t_r1))$$,
  '%not the latest%',
  'an edit of a revision a newer one replaced is refused'
);

select throws_like(
  $$select * from public.create_ai_confirmation_revision(
      '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
      'call-1', 'proposeLeave', 'k1', 'assistant', '{}', '{}', '[]')$$,
  '%another action%',
  'a revisionKey of another action is refused'
);

-- A confirm claims the pending revision first.
update public.ai_chat_confirmations set status = 'confirmed', decided_at = now()
 where id = (select id from t_r2);

select throws_like(
  $$select * from public.create_ai_confirmation_revision(
      '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
      'call-1', 'proposeExchangeRate', 'k1', 'user', '{"rate":1}', '{}', '[]',
      (select id from t_r2))$$,
  '%no longer pending%',
  'an edit of a confirmed revision is refused: it never reopens it'
);

select is(
  (select count(*)::int from public.ai_chat_confirmations where revision_key = 'k1'),
  2,
  'the refused revisions wrote nothing'
);

select is(
  (select status from public.ai_chat_confirmations where id = (select id from t_r2)),
  'confirmed',
  'and the confirmed revision stays confirmed'
);

-- The assistant's re-proposal after a decided one: no supersede, next number.
select results_eq(
  $$select revision from public.create_ai_confirmation_revision(
      '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1',
      'call-2', 'proposeExchangeRate', 'k1', 'assistant', '{"rate":1300}', '{}', '[]')$$,
  $$values (3)$$,
  'a re-proposal after a decided revision adds the next one'
);

select is(
  (select count(*)::int from public.ai_chat_confirmations
    where revision_key = 'k1' and status = 'pending'),
  1,
  'with one pending revision per key'
);

select * from finish();
rollback;
