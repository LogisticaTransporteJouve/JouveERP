SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A check loaded by hand («Nuevo cheque» and the cheque scan of Document
-- Intelligence) is written in one transaction with its 'received' anchor.
--
-- createCheckAction inserted the check and then the 'received' movement in a
-- second request whose error it ignored: a failed anchor left a check with
-- no history. The cheque scan inserted the check with no channel and no
-- anchor at all, so it booked no cartera inflow (checks_manual_inflow books
-- only a check with a channel) until it was deposited. Both now call this
-- function, with the channel required, so both write the same rows: the
-- check, its cartera inflow (checks_manual_inflow) and its anchor.
--
-- SECURITY INVOKER: the checks / check_movements RLS policies and the guards
-- (guard_check_edit, guard_check_movement, which stamps the anchor) apply as
-- they did to the two direct inserts.
--
-- Rollback: older code inserts the check and the anchor itself; this function
-- is then unused.

create or replace function public.create_manual_check(
  p_kind               text,
  p_check_number       text,
  p_bank_name          text,
  p_drawer_name        text,
  p_issue_date         date,
  p_due_date           date,
  p_amount             numeric,
  p_currency           text,
  p_cartera_account_id uuid,
  p_channel_id         text,
  p_drawer_cuit        text default null,
  p_source_client_id   uuid default null,
  p_notes              text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_channel_id is null or btrim(p_channel_id) = '' then
    raise exception 'Elegí el canal del cheque'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.checks (
    kind, check_number, bank_name, drawer_name, drawer_cuit, issue_date,
    due_date, amount, currency, cartera_account_id, channel_id, source_kind,
    source_client_id, notes, created_by
  ) values (
    p_kind, p_check_number, p_bank_name, p_drawer_name,
    nullif(btrim(p_drawer_cuit), ''), p_issue_date, p_due_date, p_amount,
    p_currency, p_cartera_account_id, p_channel_id, 'manual',
    p_source_client_id, nullif(btrim(p_notes), ''), auth.uid()
  )
  returning id into v_id;

  -- guard_check_movement accepts it as the check's first movement and stamps
  -- created_at, created_by and event_date (the check's issue_date).
  insert into public.check_movements (check_id, event, event_date, created_by)
  values (v_id, 'received', p_issue_date, auth.uid());

  return v_id;
end;
$$;

revoke all on function public.create_manual_check(
  text, text, text, text, date, date, numeric, text, uuid, text, text, uuid, text
) from public, anon;
grant execute on function public.create_manual_check(
  text, text, text, text, date, date, numeric, text, uuid, text, text, uuid, text
) to authenticated, service_role;
