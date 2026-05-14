-- Devolver first_name, last_name, email del otro miembro en DMs para que el
-- frontend pueda computar iniciales "TD" cuando no hay foto. Antes solo
-- exponía un display_name colapsado, lo que forzaba a UserAvatar a tomar
-- la primera letra del email (ej. "T") cuando había nombre completo cargado.
--
-- Adicional: fallback a email cuando first_name + last_name están vacíos
-- (DMs con usuarios recién creados sin perfil completo).

set row_security = off;

drop function if exists public.list_chat_channels_for_user();

create or replace function public.list_chat_channels_for_user()
returns table (
  id uuid,
  kind public.chat_channel_kind,
  display_name text,
  other_user_id uuid,
  other_first_name text,
  other_last_name text,
  other_email text,
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
           up.first_name, up.last_name, u.email,
           up.avatar_path, up.avatar_color
    from my_channels c
    join public.chat_channel_members m
      on m.channel_id = c.id and m.user_id <> (select uid from v_me)
    join auth.users u on u.id = m.user_id
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
      when c.kind = 'dm'    then
        coalesce(
          nullif(trim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), ''),
          d.email
        )
    end as display_name,
    case when c.kind = 'dm' then d.other_id end as other_user_id,
    case when c.kind = 'dm' then d.first_name end as other_first_name,
    case when c.kind = 'dm' then d.last_name end as other_last_name,
    case when c.kind = 'dm' then d.email end as other_email,
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

set row_security = on;
