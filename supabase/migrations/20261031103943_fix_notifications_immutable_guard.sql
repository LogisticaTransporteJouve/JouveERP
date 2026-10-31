SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- notifications has no title/body columns; referencing them made every UPDATE
-- (including marking as read) fail with `record "new" has no field "title"`.
create or replace function public.notifications_lock_immutable_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recipient_id    is distinct from old.recipient_id
   or new.sender_id      is distinct from old.sender_id
   or new.type           is distinct from old.type
   or new.metadata       is distinct from old.metadata
   or new.created_at     is distinct from old.created_at
  then
    raise exception 'notifications: solo se puede modificar read_at desde el cliente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
