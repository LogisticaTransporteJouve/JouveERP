SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- create_ai_confirmation_revision: the next revision of a chat proposal and
-- the supersede of the one it replaces, in one transaction.
-- createConfirmationRevision (features/ai/lib/confirmations.ts) used to mark
-- the replaced revision superseded and then insert the new one; a failed
-- insert left the card with no pending revision, so the user's edit or the
-- assistant's re-proposal was lost along with the one it replaced.
--
-- Same rules as before:
--   * the key's latest revision must be of the same action, else
--     'ai_revision_key_mismatch';
--   * p_replaces (the revision the user edited), when given, must be the
--     key's latest revision; without it the latest one is replaced only if
--     it is pending;
--   * the replaced revision is superseded only while it is still pending: a
--     confirm, a decline or another revision that got there first leaves
--     nothing written ('ai_revision_concurrent'), so an edit never reopens a
--     proposal that was already executed. The partial unique index (one
--     pending per session and key) stays the last guard (23505).
-- The errors carry those hints for the caller; their messages are not shown.
--
-- Writes to ai_chat_confirmations go only through the service client after
-- the action's gate (20261016110000): service role only, SECURITY INVOKER,
-- the user's id passed in and every row filtered by it.
--
-- Rollback: older code does not call it and writes the two rows itself.

create function public.create_ai_confirmation_revision(
  p_user_id      uuid,
  p_session_id   uuid,
  p_tool_call_id text,
  p_action       text,
  p_revision_key text,
  p_origin       text,
  p_draft        jsonb,
  p_labels       jsonb,
  p_summary      jsonb,
  p_replaces     uuid default null
)
returns table (id uuid, revision integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_latest    public.ai_chat_confirmations%rowtype;
  v_supersede uuid;
  v_id        uuid;
  v_revision  integer;
begin
  select c.* into v_latest
    from public.ai_chat_confirmations c
   where c.user_id = p_user_id
     and c.session_id = p_session_id
     and c.revision_key = p_revision_key
   order by c.revision desc
   limit 1;

  if v_latest.id is not null and v_latest.action <> p_action then
    raise exception 'revision key of another action'
      using errcode = 'P0001', hint = 'ai_revision_key_mismatch';
  end if;
  if p_replaces is not null and v_latest.id is distinct from p_replaces then
    raise exception 'the replaced revision is not the latest'
      using errcode = 'P0001', hint = 'ai_revision_concurrent';
  end if;

  v_supersede := coalesce(
    p_replaces,
    case when v_latest.status = 'pending' then v_latest.id end);
  if v_supersede is not null then
    update public.ai_chat_confirmations c
       set status = 'superseded', decided_at = now()
     where c.user_id = p_user_id
       and c.id = v_supersede
       and c.action = p_action
       and c.status = 'pending';
    if not found then
      raise exception 'the replaced revision is no longer pending'
        using errcode = 'P0001', hint = 'ai_revision_concurrent';
    end if;
  end if;

  insert into public.ai_chat_confirmations
    (user_id, session_id, tool_call_id, action, revision_key, revision,
     origin, draft, labels, summary)
  values
    (p_user_id, p_session_id, p_tool_call_id, p_action, p_revision_key,
     coalesce(v_latest.revision, 0) + 1, p_origin, p_draft,
     coalesce(p_labels, '{}'::jsonb), p_summary)
  returning ai_chat_confirmations.id, ai_chat_confirmations.revision
    into v_id, v_revision;

  return query select v_id, v_revision;
end;
$$;

revoke all on function public.create_ai_confirmation_revision(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_ai_confirmation_revision(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, uuid) to service_role;
