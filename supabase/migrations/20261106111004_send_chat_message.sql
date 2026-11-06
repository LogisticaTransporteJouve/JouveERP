SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- send_chat_message: a chat message and its @-mentions in one transaction.
-- sendMessageAction used to insert the message and then its mentions,
-- ignoring the second insert's error: the message went out and the people it
-- mentioned were never notified (trg_notify_on_chat_mention notifies on the
-- mention row), with nothing logged.
--
-- Only mentions of the channel's members are stored, the sender's own
-- excluded: the notify trigger skips anyone else anyway, and a stale id (a
-- user removed from the channel, or deleted) no longer fails the send.
--
-- SECURITY INVOKER, called with the user's client: the sender is auth.uid()
-- and chat_messages' and chat_message_mentions' RLS (member of the channel,
-- the message's own sender) apply as on the direct inserts.
--
-- Rollback: older code does not call it and inserts the two itself.

create function public.send_chat_message(
  p_channel_id  uuid,
  p_body        text,
  p_mention_ids uuid[],
  p_reply_to_id uuid default null
)
returns table (
  id                  uuid,
  channel_id          uuid,
  sender_id           uuid,
  reply_to_message_id uuid,
  body                text,
  edited_at           timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_message public.chat_messages%rowtype;
begin
  insert into public.chat_messages (channel_id, sender_id, body, reply_to_message_id)
  values (p_channel_id, auth.uid(), p_body, p_reply_to_id)
  returning * into v_message;

  insert into public.chat_message_mentions (message_id, user_id)
  select distinct v_message.id, m.user_id
    from public.chat_channel_members m
   where m.channel_id = p_channel_id
     and m.user_id = any (coalesce(p_mention_ids, '{}'))
     and m.user_id <> v_message.sender_id;

  return query select
    v_message.id, v_message.channel_id, v_message.sender_id,
    v_message.reply_to_message_id, v_message.body, v_message.edited_at,
    v_message.deleted_at, v_message.created_at;
end;
$$;

revoke all on function public.send_chat_message(uuid, text, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid[], uuid) to authenticated, service_role;
