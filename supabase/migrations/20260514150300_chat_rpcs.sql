-- RPCs del chat. Todos con security definer para que el INSERT
-- transaccional de canal + members se ejecute sin pegarse contra RLS
-- en pasos intermedios (la membresía recién existe después del segundo
-- insert).

-- Devuelve el id del canal "self" del user actual, creándolo si no existe.
create or replace function public.get_or_create_self_channel()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'unauthenticated'; end if;

  select c.id into v_id
  from public.chat_channels c
  join public.chat_channel_members m on m.channel_id = c.id
  where c.kind = 'self' and m.user_id = v_me
  limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.chat_channels (kind, created_by) values ('self', v_me) returning id into v_id;
  insert into public.chat_channel_members (channel_id, user_id, role) values (v_id, v_me, 'admin');
  return v_id;
end;
$$;

revoke all on function public.get_or_create_self_channel() from public;
grant execute on function public.get_or_create_self_channel() to authenticated;

-- Abre (o crea) el DM 1-on-1 entre el user actual y p_other. Idempotente
-- vía dm_pair_key canónico.
create or replace function public.open_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_pair_key text;
  v_channel_id uuid;
begin
  if v_me is null then raise exception 'unauthenticated'; end if;
  if v_me = p_other then raise exception 'use_self_channel_for_self_dm'; end if;
  if not exists (select 1 from auth.users where id = p_other) then
    raise exception 'other_user_not_found';
  end if;

  v_pair_key := least(v_me::text, p_other::text) || '|' || greatest(v_me::text, p_other::text);

  select id into v_channel_id
  from public.chat_channels
  where dm_pair_key = v_pair_key;

  if v_channel_id is null then
    insert into public.chat_channels (kind, created_by, dm_pair_key)
    values ('dm', v_me, v_pair_key)
    returning id into v_channel_id;

    insert into public.chat_channel_members (channel_id, user_id, role)
    values (v_channel_id, v_me, 'member'), (v_channel_id, p_other, 'member');
  end if;

  return v_channel_id;
end;
$$;

revoke all on function public.open_or_create_dm(uuid) from public;
grant execute on function public.open_or_create_dm(uuid) to authenticated;

-- Crear grupo: nombre + miembros. El creator se inserta como admin.
create or replace function public.create_chat_group(
  p_name text,
  p_description text,
  p_member_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_channel_id uuid;
  v_member uuid;
begin
  if v_me is null then raise exception 'unauthenticated'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'name_required'; end if;
  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    raise exception 'members_required';
  end if;

  insert into public.chat_channels (kind, name, description, created_by)
  values ('group', trim(p_name), nullif(trim(coalesce(p_description, '')), ''), v_me)
  returning id into v_channel_id;

  insert into public.chat_channel_members (channel_id, user_id, role)
  values (v_channel_id, v_me, 'admin');

  foreach v_member in array p_member_ids loop
    if v_member <> v_me then
      insert into public.chat_channel_members (channel_id, user_id, role)
      values (v_channel_id, v_member, 'member')
      on conflict (channel_id, user_id) do nothing;
    end if;
  end loop;

  return v_channel_id;
end;
$$;

revoke all on function public.create_chat_group(text, text, uuid[]) from public;
grant execute on function public.create_chat_group(text, text, uuid[]) to authenticated;

-- Listado de canales para el sidebar, con display_name resuelto,
-- preview del último mensaje y unread count.
create or replace function public.list_chat_channels_for_user()
returns table (
  id uuid,
  kind public.chat_channel_kind,
  display_name text,
  other_user_id uuid,
  avatar_path text,
  avatar_color text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid,
  unread_count integer,
  is_muted boolean,
  member_count integer
) language sql stable security definer set search_path = public as $$
  with v_me as (select auth.uid() as uid),
  my_channels as (
    select c.*, m.last_read_at, m.is_muted
    from public.chat_channels c
    join public.chat_channel_members m on m.channel_id = c.id
    join v_me on m.user_id = v_me.uid
  ),
  unread as (
    select c.id as channel_id, count(*)::integer as cnt
    from my_channels c
    join public.chat_messages msg on msg.channel_id = c.id
    join v_me on true
    where msg.created_at > c.last_read_at
      and msg.deleted_at is null
      and msg.sender_id <> v_me.uid
    group by c.id
  ),
  last_msgs as (
    select distinct on (channel_id)
      channel_id, body, deleted_at, sender_id, created_at
    from public.chat_messages
    order by channel_id, created_at desc
  ),
  dm_others as (
    select c.id as channel_id, m.user_id as other_id,
           up.first_name, up.last_name, up.avatar_path, up.avatar_color
    from my_channels c
    join public.chat_channel_members m
      on m.channel_id = c.id and m.user_id <> (select uid from v_me)
    left join public.user_profiles up on up.user_id = m.user_id
    where c.kind = 'dm'
  ),
  member_counts as (
    select channel_id, count(*)::integer as cnt
    from public.chat_channel_members
    group by channel_id
  )
  select
    c.id,
    c.kind,
    case
      when c.kind = 'self'  then 'Mis notas'
      when c.kind = 'group' then c.name
      when c.kind = 'dm'    then trim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''))
    end as display_name,
    case when c.kind = 'dm' then d.other_id end as other_user_id,
    case when c.kind = 'dm' then d.avatar_path end as avatar_path,
    case when c.kind = 'dm' then d.avatar_color end as avatar_color,
    c.last_message_at,
    case
      when lm.deleted_at is not null then '[Mensaje eliminado]'
      else left(coalesce(lm.body, ''), 80)
    end as last_message_preview,
    lm.sender_id as last_message_sender_id,
    coalesce(u.cnt, 0) as unread_count,
    c.is_muted,
    coalesce(mc.cnt, 0) as member_count
  from my_channels c
  left join unread u on u.channel_id = c.id
  left join last_msgs lm on lm.channel_id = c.id
  left join dm_others d on d.channel_id = c.id
  left join member_counts mc on mc.channel_id = c.id
  order by c.last_message_at desc nulls last;
$$;

revoke all on function public.list_chat_channels_for_user() from public;
grant execute on function public.list_chat_channels_for_user() to authenticated;

-- Listado de usuarios disponibles para abrir DM / crear grupo.
-- Devuelve a todos los authenticated excepto a vos mismo.
create or replace function public.list_chat_assignable_users()
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  avatar_path text,
  avatar_color text
) language sql stable security definer set search_path = public as $$
  select
    u.id as user_id,
    u.email,
    up.first_name,
    up.last_name,
    up.avatar_path,
    up.avatar_color
  from auth.users u
  left join public.user_profiles up on up.user_id = u.id
  where u.id <> auth.uid()
    and u.deleted_at is null
  order by coalesce(up.first_name, u.email);
$$;

revoke all on function public.list_chat_assignable_users() from public;
grant execute on function public.list_chat_assignable_users() to authenticated;

-- Mark channel as read. Solo el llamador puede marcarse a sí mismo.
create or replace function public.mark_chat_channel_read(p_channel uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'unauthenticated'; end if;
  update public.chat_channel_members
    set last_read_at = now()
    where channel_id = p_channel and user_id = v_me;
end;
$$;

revoke all on function public.mark_chat_channel_read(uuid) from public;
grant execute on function public.mark_chat_channel_read(uuid) to authenticated;
