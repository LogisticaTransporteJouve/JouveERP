-- ai_chat_bump_session: the trigger function that keeps ai_chat_sessions'
-- message_count / updated_at in step with ai_chat_messages inserts.
--
-- 1. EXECUTE was still granted to anon (Supabase's default privileges) and to
--    PUBLIC. Revoke both by name; authenticated keeps it.
-- 2. It runs SECURITY DEFINER, so it bumps the parent session regardless of
--    RLS. Recreated from its latest definition (20260616140000) adding only an
--    ownership check: when the insert carries a user (auth.uid() set), the
--    session must belong to that user. The chat route writes messages with the
--    service client after verifying ownership itself (auth.uid() is null
--    there), which keeps working unchanged.

set row_security = off;

create or replace function public.ai_chat_bump_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and not exists (
       select 1
       from public.ai_chat_sessions s
       where s.id = new.session_id
         and s.user_id = (select auth.uid())
     ) then
    raise exception 'ai_chat_bump_session: session % is not owned by the caller', new.session_id
      using errcode = '42501';
  end if;

  update public.ai_chat_sessions
    set message_count = message_count + 1,
        updated_at = now()
    where id = new.session_id;
  return new;
end;
$$;

revoke execute on function public.ai_chat_bump_session() from public, anon;
grant execute on function public.ai_chat_bump_session() to authenticated;

set row_security = on;
