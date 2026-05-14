-- Bug: cuando el user cerraba un DM (= dejaba el channel via leave_chat_channel)
-- y después reabría el chat con la misma persona, el RPC devolvía el
-- channel_id existente sin re-insertar la fila en chat_channel_members.
-- Resultado: el frontend redirige a /chat/<id>, la RLS bloquea el SELECT y
-- aparece un 404.
--
-- Fix: en la rama "ya existe el canal", upsert los dos miembros con
-- on conflict do nothing. Si ya están, no pasa nada; si faltan (uno o
-- ambos lo habían cerrado), se re-agregan como `member`.
--
-- Side effect: el `last_read_at` se resetea a now() para los miembros que
-- vuelven a entrar, así no les llega como "no leído" todo el historial
-- previo de cuando estaban dentro.

set row_security = off;

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
  else
    -- Re-join: si alguno (o ambos) había dejado el DM, lo re-agregamos.
    -- on conflict do nothing → no toca a los que ya están.
    insert into public.chat_channel_members (channel_id, user_id, role, last_read_at)
    values
      (v_channel_id, v_me, 'member', now()),
      (v_channel_id, p_other, 'member', now())
    on conflict (channel_id, user_id) do nothing;
  end if;

  return v_channel_id;
end;
$$;

set row_security = on;
