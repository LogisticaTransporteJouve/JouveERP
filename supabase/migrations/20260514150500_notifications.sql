-- Sistema de notificaciones in-app con realtime. v1 single-CUIT, sin
-- email digest ni preferencias por tipo. Schema preparado para sumar
-- esos canales más adelante (columna `email_enabled` por default true,
-- worker pendiente).
--
-- Tipos soportados en v1: chat_message, chat_reply, chat_mention
-- (este último cableado pero todavía sin generador automático). Tipos
-- nuevos se suman extendiendo el CHECK + un trigger por feature.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  type text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_type_known
    check (type in ('chat_message', 'chat_reply', 'chat_mention'))
);

create index idx_notifications_recipient_created
  on public.notifications (recipient_id, created_at desc);

create index idx_notifications_recipient_unread
  on public.notifications (recipient_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- El recipient puede leer las propias y nadie más.
create policy "notifications_select_recipient"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

-- El recipient puede marcarlas como leídas (read_at).
create policy "notifications_update_recipient"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- INSERT solo desde triggers / service role; sin policy. Las funciones
-- que generan notifs corren security definer.

-- Generador para mensajes de chat ---------------------------------------

create or replace function public.notify_on_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_member record;
  v_origin_sender uuid;
begin
  -- No notificar self-chat (canal con un solo miembro = el sender).
  -- Notificar a todos los miembros del canal menos al sender.
  for v_member in
    select user_id, is_muted
    from public.chat_channel_members
    where channel_id = new.channel_id
      and user_id <> new.sender_id
  loop
    if v_member.is_muted then continue; end if;

    insert into public.notifications (recipient_id, sender_id, type, metadata)
    values (
      v_member.user_id,
      new.sender_id,
      'chat_message',
      jsonb_build_object(
        'message_id', new.id,
        'channel_id', new.channel_id,
        'preview', left(new.body, 240)
      )
    );
  end loop;

  -- Si es un reply, notif extra al sender del mensaje original (si
  -- todavía está en el canal y no es el propio replicador). Esto se
  -- suma al chat_message general — la UI puede agrupar después.
  if new.reply_to_message_id is not null then
    select sender_id into v_origin_sender
      from public.chat_messages
      where id = new.reply_to_message_id;

    if v_origin_sender is not null
       and v_origin_sender <> new.sender_id
       and exists (
         select 1 from public.chat_channel_members
         where channel_id = new.channel_id
           and user_id = v_origin_sender
           and is_muted = false
       )
    then
      insert into public.notifications (recipient_id, sender_id, type, metadata)
      values (
        v_origin_sender,
        new.sender_id,
        'chat_reply',
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

create trigger trg_notify_on_chat_message
  after insert on public.chat_messages
  for each row execute function public.notify_on_chat_message();

-- Extender mark_chat_channel_read para marcar también notifs del canal --

create or replace function public.mark_chat_channel_read(p_channel uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'unauthenticated'; end if;

  update public.chat_channel_members
    set last_read_at = now()
    where channel_id = p_channel and user_id = v_me;

  -- Marcar las notifs in-app de este canal como leídas: las que apuntan
  -- a chat_messages cuyo channel_id coincide. metadata->>'channel_id'
  -- está indexado por el GIN-on-jsonb que viene con jsonb por default,
  -- pero igual el filter por recipient_id es el selectivo.
  update public.notifications
    set read_at = now()
    where recipient_id = v_me
      and read_at is null
      and type in ('chat_message', 'chat_reply', 'chat_mention')
      and metadata->>'channel_id' = p_channel::text;
end;
$$;

revoke all on function public.mark_chat_channel_read(uuid) from public;
grant execute on function public.mark_chat_channel_read(uuid) to authenticated;

-- RPCs de notifs --------------------------------------------------------

create or replace function public.list_my_notifications(
  p_filter text default 'all',
  p_limit int default 50
) returns table (
  id uuid,
  recipient_id uuid,
  sender_id uuid,
  type text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz,
  sender_first_name text,
  sender_last_name text,
  sender_email text,
  sender_avatar_path text,
  sender_avatar_color text
) language sql stable security definer set search_path = public as $$
  select
    n.id, n.recipient_id, n.sender_id, n.type, n.metadata, n.read_at, n.created_at,
    sp.first_name, sp.last_name, u.email, sp.avatar_path, sp.avatar_color
  from public.notifications n
  left join auth.users u on u.id = n.sender_id
  left join public.user_profiles sp on sp.user_id = n.sender_id
  where n.recipient_id = auth.uid()
    and (
      p_filter = 'all'
      or (p_filter = 'unread' and n.read_at is null)
      or (p_filter = 'read'   and n.read_at is not null)
    )
  order by n.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.list_my_notifications(text, int) from public;
grant execute on function public.list_my_notifications(text, int) to authenticated;

create or replace function public.get_my_unread_notification_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.notifications
    where recipient_id = auth.uid() and read_at is null;
$$;

revoke all on function public.get_my_unread_notification_count() from public;
grant execute on function public.get_my_unread_notification_count() to authenticated;

create or replace function public.mark_all_my_notifications_read()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  with upd as (
    update public.notifications
      set read_at = now()
      where recipient_id = auth.uid() and read_at is null
      returning 1
  )
  select count(*) into v_count from upd;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.mark_all_my_notifications_read() from public;
grant execute on function public.mark_all_my_notifications_read() to authenticated;

-- Realtime para que el bell del header se entere al instante.
alter publication supabase_realtime add table public.notifications;
