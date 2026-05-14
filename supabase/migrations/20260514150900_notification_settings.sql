-- Notification preferences per user + per type. Cada user puede activar
-- o desactivar el in-app para cada tipo. Defaults: enabled. Los
-- triggers de chat verifican esta tabla antes de insertar notifs.
-- No incluimos email/push columns: este sistema es 100% in-app por
-- diseño — no mandamos mails (decisión del owner) y push viene aparte
-- como suscripciones del browser.

create table public.notification_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, notification_type),
  constraint notification_settings_type_known
    check (notification_type in ('chat_message', 'chat_reply', 'chat_mention'))
);

create index idx_notification_settings_user
  on public.notification_settings (user_id);

alter table public.notification_settings enable row level security;

create policy "notification_settings_select_self"
  on public.notification_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notification_settings_insert_self"
  on public.notification_settings for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "notification_settings_update_self"
  on public.notification_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "notification_settings_delete_self"
  on public.notification_settings for delete to authenticated
  using (user_id = (select auth.uid()));

-- Helper: ¿está habilitado el tipo X para el user Y? Devuelve true por
-- default (sin row): opt-out, no opt-in.
create or replace function public.notification_type_enabled(
  p_user_id uuid,
  p_type text
) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(s.enabled, true)
  from (select 1) _
  left join public.notification_settings s
    on s.user_id = p_user_id and s.notification_type = p_type;
$$;

revoke all on function public.notification_type_enabled(uuid, text) from public;
grant execute on function public.notification_type_enabled(uuid, text) to authenticated;

-- Triggers que respetan las settings -----------------------------------

create or replace function public.notify_on_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_member record;
  v_origin_sender uuid;
begin
  for v_member in
    select user_id, is_muted from public.chat_channel_members
    where channel_id = new.channel_id and user_id <> new.sender_id
  loop
    if v_member.is_muted then continue; end if;
    if not public.notification_type_enabled(v_member.user_id, 'chat_message') then
      continue;
    end if;

    insert into public.notifications (recipient_id, sender_id, type, metadata)
    values (
      v_member.user_id, new.sender_id, 'chat_message',
      jsonb_build_object(
        'message_id', new.id,
        'channel_id', new.channel_id,
        'preview', left(new.body, 240)
      )
    );
  end loop;

  if new.reply_to_message_id is not null then
    select sender_id into v_origin_sender
      from public.chat_messages
      where id = new.reply_to_message_id;

    if v_origin_sender is not null
       and v_origin_sender <> new.sender_id
       and public.notification_type_enabled(v_origin_sender, 'chat_reply')
       and exists (
         select 1 from public.chat_channel_members
         where channel_id = new.channel_id
           and user_id = v_origin_sender
           and is_muted = false
       )
    then
      insert into public.notifications (recipient_id, sender_id, type, metadata)
      values (
        v_origin_sender, new.sender_id, 'chat_reply',
        jsonb_build_object(
          'message_id', new.id,
          'channel_id', new.channel_id,
          'reply_to_message_id', new.reply_to_message_id,
          'preview', left(new.body, 240)
        )
      );
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.notify_on_chat_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_msg record;
  v_member record;
begin
  select m.id, m.channel_id, m.sender_id, m.body
    into v_msg
    from public.chat_messages m
    where m.id = new.message_id;
  if not found then return new; end if;

  if new.user_id = v_msg.sender_id then return new; end if;

  select user_id, is_muted into v_member
    from public.chat_channel_members
    where channel_id = v_msg.channel_id and user_id = new.user_id;
  if not found then return new; end if;
  if v_member.is_muted then return new; end if;

  if not public.notification_type_enabled(new.user_id, 'chat_mention') then
    return new;
  end if;

  -- Dedupe: borrar chat_message del mismo mensaje (la mention lo reemplaza).
  delete from public.notifications
    where recipient_id = new.user_id
      and type = 'chat_message'
      and metadata->>'message_id' = v_msg.id::text;

  insert into public.notifications (recipient_id, sender_id, type, metadata)
  values (
    new.user_id, v_msg.sender_id, 'chat_mention',
    jsonb_build_object(
      'message_id', v_msg.id,
      'channel_id', v_msg.channel_id,
      'preview', left(v_msg.body, 240)
    )
  );

  return new;
end;
$$;

-- RPC para que la UI cargue todas las settings del user, llenando con
-- defaults los tipos sin row.
create or replace function public.get_my_notification_settings()
returns table (
  notification_type text,
  enabled boolean
) language sql stable security definer set search_path = public as $$
  with types as (
    select unnest(array['chat_message', 'chat_reply', 'chat_mention']) as type
  )
  select
    t.type as notification_type,
    coalesce(s.enabled, true) as enabled
  from types t
  left join public.notification_settings s
    on s.user_id = auth.uid() and s.notification_type = t.type;
$$;

revoke all on function public.get_my_notification_settings() from public;
grant execute on function public.get_my_notification_settings() to authenticated;

create or replace function public.upsert_my_notification_setting(
  p_type text,
  p_enabled boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'unauthenticated'; end if;
  insert into public.notification_settings
    (user_id, notification_type, enabled, updated_at)
  values (v_me, p_type, p_enabled, now())
  on conflict (user_id, notification_type) do update set
    enabled = excluded.enabled,
    updated_at = now();
end;
$$;

revoke all on function public.upsert_my_notification_setting(text, boolean) from public;
grant execute on function public.upsert_my_notification_setting(text, boolean) to authenticated;
