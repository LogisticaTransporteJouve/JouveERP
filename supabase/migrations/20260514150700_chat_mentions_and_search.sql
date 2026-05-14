-- @-mentions: tabla chat_message_mentions + trigger que genera notifs
-- de type 'chat_mention' (el type ya estaba en el check de notifications).
-- Búsqueda full-text con índice GIN sobre los mensajes activos.

-- Mentions --------------------------------------------------------------

create table public.chat_message_mentions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index idx_chat_message_mentions_user
  on public.chat_message_mentions (user_id);

alter table public.chat_message_mentions enable row level security;

-- Read: si podés ver el mensaje, podés ver sus mentions.
create policy "mentions_select_if_message_visible"
  on public.chat_message_mentions for select to authenticated
  using (exists (
    select 1 from public.chat_messages m
    where m.id = message_id and public.user_is_channel_member(m.channel_id)
  ));

-- Insert: solo el sender del mensaje. Sin policy de update/delete — la
-- cascade del FK message_id se encarga al editar/borrar el mensaje.
create policy "mentions_insert_by_sender"
  on public.chat_message_mentions for insert to authenticated
  with check (exists (
    select 1 from public.chat_messages m
    where m.id = message_id
      and m.sender_id = (select auth.uid())
      and public.user_is_channel_member(m.channel_id)
  ));

-- Trigger que genera notif chat_mention al insertar una mention.
create or replace function public.notify_on_chat_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_msg record;
  v_member record;
begin
  -- Cargar metadata del mensaje + verificar membresía + mute del recipient.
  select m.id, m.channel_id, m.sender_id, m.body
    into v_msg
    from public.chat_messages m
    where m.id = new.message_id;
  if not found then return new; end if;

  -- No notificar self-mentions.
  if new.user_id = v_msg.sender_id then return new; end if;

  select user_id, is_muted into v_member
    from public.chat_channel_members
    where channel_id = v_msg.channel_id and user_id = new.user_id;
  if not found then return new; end if;
  if v_member.is_muted then return new; end if;

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

create trigger trg_notify_on_chat_mention
  after insert on public.chat_message_mentions
  for each row execute function public.notify_on_chat_mention();

-- Búsqueda full-text en mensajes ---------------------------------------

-- Índice GIN sobre body usando el dictionary 'simple' para no perder
-- precisión con stemming agresivo (search interno de empresa, queries
-- cortas literales). Filtramos deleted_at en el WHERE del RPC, no en
-- el índice — el costo extra es mínimo.
create index idx_chat_messages_body_search
  on public.chat_messages
  using gin (to_tsvector('simple', body));

create or replace function public.search_chat_messages(
  p_query text,
  p_limit int default 30,
  p_channel uuid default null
) returns table (
  id uuid,
  channel_id uuid,
  channel_kind public.chat_channel_kind,
  channel_display_name text,
  sender_id uuid,
  sender_first_name text,
  sender_last_name text,
  sender_email text,
  sender_avatar_path text,
  sender_avatar_color text,
  body text,
  created_at timestamptz
) language sql stable security definer set search_path = public as $$
  with v_me as (select auth.uid() as uid),
  q as (
    select trim(p_query) as raw,
           plainto_tsquery('simple', trim(p_query)) as ts
  )
  select
    m.id,
    m.channel_id,
    c.kind as channel_kind,
    case
      when c.kind = 'self'  then 'Mis notas'
      when c.kind = 'group' then c.name
      when c.kind = 'dm'    then trim(coalesce(other_up.first_name, '') || ' ' || coalesce(other_up.last_name, ''))
    end as channel_display_name,
    m.sender_id,
    up.first_name,
    up.last_name,
    u.email,
    up.avatar_path,
    up.avatar_color,
    m.body,
    m.created_at
  from public.chat_messages m
  join public.chat_channels c on c.id = m.channel_id
  left join public.user_profiles up on up.user_id = m.sender_id
  left join auth.users u on u.id = m.sender_id
  left join lateral (
    select cm.user_id from public.chat_channel_members cm
    where cm.channel_id = c.id and cm.user_id <> (select uid from v_me)
    limit 1
  ) other on c.kind = 'dm'
  left join public.user_profiles other_up on other_up.user_id = other.user_id
  cross join q
  where q.raw <> ''
    and m.deleted_at is null
    and public.user_is_channel_member(m.channel_id)
    and (p_channel is null or m.channel_id = p_channel)
    and to_tsvector('simple', m.body) @@ q.ts
  order by m.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.search_chat_messages(text, int, uuid) from public;
grant execute on function public.search_chat_messages(text, int, uuid) to authenticated;
