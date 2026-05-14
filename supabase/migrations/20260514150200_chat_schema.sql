-- Chat: schema completo (channels + members + messages + reactions).
-- Modelo unificado por canal — DM, self y group viven en la misma tabla
-- con discriminador `kind`. DMs son idempotentes vía `dm_pair_key`
-- (string canónico "min_uuid|max_uuid"). Soft-delete de mensajes para
-- preservar replies.

create type public.chat_channel_kind as enum ('self', 'dm', 'group');

create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  kind public.chat_channel_kind not null,
  name text,
  description text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  -- Cargado por el RPC open_or_create_dm (no es generated porque el valor
  -- depende de chat_channel_members, no de columnas propias).
  dm_pair_key text,

  constraint chat_channels_name_required_for_group
    check (kind <> 'group' or (name is not null and length(trim(name)) > 0)),
  constraint chat_channels_no_name_for_self_or_dm
    check (kind = 'group' or name is null),
  constraint chat_channels_dm_pair_key_format
    check (
      dm_pair_key is null
      or dm_pair_key ~ '^[0-9a-f-]{36}\|[0-9a-f-]{36}$'
    )
);

create index idx_chat_channels_last_message
  on public.chat_channels (last_message_at desc nulls last);

create unique index chat_channels_dm_pair_unique
  on public.chat_channels (dm_pair_key)
  where dm_pair_key is not null;

create trigger chat_channels_set_updated_at
  before update on public.chat_channels
  for each row execute function public.set_updated_at();

-- Members --------------------------------------------------------------

create table public.chat_channel_members (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  is_muted boolean not null default false,
  primary key (channel_id, user_id),
  constraint chat_channel_members_role_valid
    check (role in ('member', 'admin'))
);

create index idx_chat_channel_members_user
  on public.chat_channel_members (user_id);

-- Messages -------------------------------------------------------------

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  reply_to_message_id uuid references public.chat_messages(id) on delete set null,
  body text not null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_chat_messages_channel_created
  on public.chat_messages (channel_id, created_at desc);

create index idx_chat_messages_reply_to
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- Reply tiene que apuntar a mensaje del mismo canal.
create or replace function public.chat_messages_validate_reply()
returns trigger language plpgsql as $$
declare same_channel uuid;
begin
  if new.reply_to_message_id is null then return new; end if;
  select channel_id into same_channel
    from public.chat_messages where id = new.reply_to_message_id;
  if same_channel is null or same_channel <> new.channel_id then
    raise exception 'reply_to_message_id must reference a message in the same channel';
  end if;
  return new;
end;
$$;

create trigger trg_chat_messages_validate_reply
  before insert on public.chat_messages
  for each row execute function public.chat_messages_validate_reply();

-- Bump last_message_at del canal en cada insert.
create or replace function public.chat_messages_bump_channel()
returns trigger language plpgsql as $$
begin
  update public.chat_channels
    set last_message_at = new.created_at,
        updated_at = now()
    where id = new.channel_id;
  return new;
end;
$$;

create trigger trg_chat_messages_bump_channel
  after insert on public.chat_messages
  for each row execute function public.chat_messages_bump_channel();

-- Reactions ------------------------------------------------------------

create table public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint chat_message_reactions_emoji_format
    check (length(emoji) between 1 and 16)
);

create index idx_chat_message_reactions_message
  on public.chat_message_reactions (message_id);

-- RLS ------------------------------------------------------------------

-- Helper compartido: ¿soy miembro de este canal?
create or replace function public.user_is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_channel_members
    where channel_id = p_channel and user_id = auth.uid()
  );
$$;
revoke all on function public.user_is_channel_member(uuid) from public;
grant execute on function public.user_is_channel_member(uuid) to authenticated;

alter table public.chat_channels enable row level security;

create policy "chat_channels_select_if_member"
  on public.chat_channels for select to authenticated
  using (public.user_is_channel_member(id));

create policy "chat_channels_insert_self_creator"
  on public.chat_channels for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "chat_channels_update_if_admin_or_creator"
  on public.chat_channels for update to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = chat_channels.id
        and m.user_id = (select auth.uid()) and m.role = 'admin'
    )
  )
  with check (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = chat_channels.id
        and m.user_id = (select auth.uid()) and m.role = 'admin'
    )
  );

alter table public.chat_channel_members enable row level security;

create policy "members_select_if_in_channel"
  on public.chat_channel_members for select to authenticated
  using (public.user_is_channel_member(channel_id));

create policy "members_update_self"
  on public.chat_channel_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "members_delete_self_or_admin"
  on public.chat_channel_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = chat_channel_members.channel_id
        and m.user_id = (select auth.uid()) and m.role = 'admin'
    )
  );

alter table public.chat_messages enable row level security;

create policy "messages_select_if_member"
  on public.chat_messages for select to authenticated
  using (public.user_is_channel_member(channel_id));

create policy "messages_insert_if_member"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.user_is_channel_member(channel_id)
  );

create policy "messages_update_self"
  on public.chat_messages for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));

alter table public.chat_message_reactions enable row level security;

create policy "reactions_select_if_member"
  on public.chat_message_reactions for select to authenticated
  using (exists (
    select 1 from public.chat_messages m
    where m.id = message_id and public.user_is_channel_member(m.channel_id)
  ));

create policy "reactions_insert_self"
  on public.chat_message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id and public.user_is_channel_member(m.channel_id)
    )
  );

create policy "reactions_delete_self"
  on public.chat_message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));
