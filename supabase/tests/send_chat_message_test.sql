-- send_chat_message (20261106111004): a chat message and its mentions in one
-- transaction; only the channel's other members are mentioned; a sender who
-- is not a member writes nothing. One transaction, rolled back.

begin;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000004a1', 'a@chat-send.test'),
  ('00000000-0000-0000-0000-0000000004a2', 'b@chat-send.test'),
  ('00000000-0000-0000-0000-0000000004a3', 'c@chat-send.test');

insert into public.chat_channels (id, kind, name, created_by) values
  ('00000000-0000-0000-0000-0000000004c1', 'group', 'Depósito', '00000000-0000-0000-0000-0000000004a1');
insert into public.chat_channel_members (channel_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004a1', 'admin'),
  ('00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004a2', 'member');

select ok(
  has_function_privilege('authenticated', 'public.send_chat_message(uuid, text, uuid[], uuid)', 'execute')
  and not has_function_privilege('anon', 'public.send_chat_message(uuid, text, uuid[], uuid)', 'execute'),
  'authenticated sends; anon does not'
);

-- Filled by the sender below.
create temporary table t_sent (
  id uuid, channel_id uuid, sender_id uuid, reply_to_message_id uuid, body text,
  edited_at timestamptz, deleted_at timestamptz, created_at timestamptz
);
grant all on t_sent to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000004a1","role":"authenticated"}', true);

insert into t_sent
  select * from public.send_chat_message(
    '00000000-0000-0000-0000-0000000004c1', 'Hola @b @c',
    array['00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a2',
          '00000000-0000-0000-0000-0000000004a3', '00000000-0000-0000-0000-0000000004ff']::uuid[]);

select results_eq(
  $$select channel_id, sender_id, body from t_sent$$,
  $$values ('00000000-0000-0000-0000-0000000004c1'::uuid,
            '00000000-0000-0000-0000-0000000004a1'::uuid, 'Hola @b @c'::text)$$,
  'it returns the stored message, sent by the caller'
);

select results_eq(
  $$select user_id from public.chat_message_mentions
     where message_id = (select id from t_sent)$$,
  $$values ('00000000-0000-0000-0000-0000000004a2'::uuid)$$,
  'only the other members are mentioned: not the sender, a non-member or an unknown id'
);

select lives_ok(
  $$select * from public.send_chat_message('00000000-0000-0000-0000-0000000004c1', 'Respuesta',
      '{}'::uuid[], (select id from t_sent))$$,
  'a reply in the same channel is sent'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000004a3","role":"authenticated"}', true);

select throws_ok(
  $$select * from public.send_chat_message('00000000-0000-0000-0000-0000000004c1', 'Intruso',
      array['00000000-0000-0000-0000-0000000004a1']::uuid[])$$,
  '42501',
  null,
  'a non-member cannot send to the channel'
);

reset role;

select is(
  (select count(*)::int from public.chat_messages
    where channel_id = '00000000-0000-0000-0000-0000000004c1'),
  2,
  'the refused send stored nothing'
);

select is(
  (select count(*)::int from public.notifications
    where recipient_id = '00000000-0000-0000-0000-0000000004a2' and type = 'chat_mention'),
  1,
  'the mentioned member is notified'
);

select * from finish();
rollback;
