-- Fixes detectados en code review post-PR:
--
-- 1. Notif duplicada por mención: cuando A menciona a B, B recibía
--    chat_message + chat_mention para el mismo mensaje. La mention
--    es la señal más específica → reemplaza al chat_message.
-- 2. Solo-admin que sale del grupo lo deja huérfano: auto-promover al
--    miembro más viejo si no quedan admins.
-- 3. chat_channel_members fuera del realtime: mute / last_read_at
--    no se sincronizaban entre dispositivos.

-- Fix 1: el trigger de mention borra el chat_message duplicado --------

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

  -- No notificar self-mentions.
  if new.user_id = v_msg.sender_id then return new; end if;

  -- Solo notificar si el recipient está en el canal y no silenciado.
  select user_id, is_muted into v_member
    from public.chat_channel_members
    where channel_id = v_msg.channel_id and user_id = new.user_id;
  if not found then return new; end if;
  if v_member.is_muted then return new; end if;

  -- Borrar la notif chat_message generada por el trigger general — la
  -- mention es más específica y la reemplaza. Si ya la leíste, igual la
  -- removemos: pasa de "te mandó un mensaje" a "te mencionó".
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

-- Fix 2: auto-promote member más viejo si el último admin se va -------

create or replace function public.ensure_group_has_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind public.chat_channel_kind;
  v_remaining_admins int;
  v_oldest_member uuid;
begin
  -- Solo aplicamos a grupos.
  select kind into v_kind from public.chat_channels where id = old.channel_id;
  if v_kind is null or v_kind <> 'group' then return old; end if;

  -- Si el que se fue no era admin, no hay nada que mover.
  if old.role <> 'admin' then return old; end if;

  -- Si quedó algún admin, ok.
  select count(*) into v_remaining_admins
    from public.chat_channel_members
    where channel_id = old.channel_id and role = 'admin';
  if v_remaining_admins > 0 then return old; end if;

  -- Sin admins: auto-promote al miembro más viejo. Si no queda
  -- ninguno (el último member se fue), el canal queda inerte — es
  -- fine, RLS lo deja inaccesible y un cron de cleanup puede
  -- removerlo más adelante.
  select user_id into v_oldest_member
    from public.chat_channel_members
    where channel_id = old.channel_id
    order by joined_at
    limit 1;
  if v_oldest_member is null then return old; end if;

  update public.chat_channel_members
    set role = 'admin'
    where channel_id = old.channel_id and user_id = v_oldest_member;

  return old;
end;
$$;

create trigger trg_ensure_group_has_admin
  after delete on public.chat_channel_members
  for each row execute function public.ensure_group_has_admin();

-- Fix 3: agregar chat_channel_members a la publication de realtime ----

alter publication supabase_realtime add table public.chat_channel_members;
