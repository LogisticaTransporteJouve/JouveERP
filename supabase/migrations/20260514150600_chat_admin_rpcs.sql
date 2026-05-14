-- RPCs admin del chat: rename/describir grupo, agregar miembros.
-- Para remove-member, leave y mute, las RLS policies de
-- chat_channel_members ya alcanzan (members_delete_self_or_admin +
-- members_update_self).

-- Agregar miembros a un grupo (solo admin).
create or replace function public.add_chat_channel_members(
  p_channel uuid,
  p_user_ids uuid[]
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_kind public.chat_channel_kind;
  v_count int := 0;
  v_uid uuid;
begin
  if v_me is null then raise exception 'unauthenticated'; end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  select kind into v_kind from public.chat_channels where id = p_channel;
  if v_kind is null then raise exception 'channel_not_found'; end if;
  if v_kind <> 'group' then
    raise exception 'only_groups_can_have_members_added';
  end if;

  if not exists (
    select 1 from public.chat_channel_members
    where channel_id = p_channel and user_id = v_me and role = 'admin'
  ) then
    raise exception 'not_channel_admin';
  end if;

  foreach v_uid in array p_user_ids loop
    if v_uid is not null and v_uid <> v_me then
      insert into public.chat_channel_members (channel_id, user_id, role)
      values (p_channel, v_uid, 'member')
      on conflict (channel_id, user_id) do nothing;
      if found then v_count := v_count + 1; end if;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.add_chat_channel_members(uuid, uuid[]) from public;
grant execute on function public.add_chat_channel_members(uuid, uuid[]) to authenticated;

-- Renombrar / cambiar descripción de un grupo (admin only).
create or replace function public.update_chat_channel(
  p_channel uuid,
  p_name text,
  p_description text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_kind public.chat_channel_kind;
begin
  if v_me is null then raise exception 'unauthenticated'; end if;

  select kind into v_kind from public.chat_channels where id = p_channel;
  if v_kind is null then raise exception 'channel_not_found'; end if;
  if v_kind <> 'group' then
    raise exception 'only_groups_can_be_renamed';
  end if;

  if not exists (
    select 1 from public.chat_channel_members
    where channel_id = p_channel and user_id = v_me and role = 'admin'
  ) then
    raise exception 'not_channel_admin';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name_required';
  end if;

  update public.chat_channels
    set
      name = trim(p_name),
      description = nullif(trim(coalesce(p_description, '')), ''),
      updated_at = now()
    where id = p_channel;
end;
$$;

revoke all on function public.update_chat_channel(uuid, text, text) from public;
grant execute on function public.update_chat_channel(uuid, text, text) to authenticated;
