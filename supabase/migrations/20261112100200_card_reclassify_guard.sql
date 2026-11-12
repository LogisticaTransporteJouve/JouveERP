SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- reclassify_card_statement_lines (20261108183459) fails closed: a paid part
-- whose bank debit is no longer matched (the match was undone by hand) was
-- skipped while its lines still changed, so the lines stopped saying what
-- its booked expenses say. Now nothing changes and the user is told to undo
-- the payment and pay it again. Everything else as before.
--
-- Rollback: older code calls the same signature; the refusal only stops a
-- change that left the lines and the entries apart.

create or replace function public.reclassify_card_statement_lines(
  p_statement_id     uuid,
  p_line_ids         uuid[],
  p_treatment        text,
  p_user_id          uuid,
  p_chart_account_id uuid default null,
  p_employee_id      uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_st      public.card_statements%rowtype;
  v_parts   record;
  v_paid    jsonb := '[]'::jsonb;
  v_part    jsonb;
  v_n       integer;
begin
  if p_treatment is null or p_treatment not in ('expense', 'advance', 'ignore') then
    raise exception 'Un consumo es un gasto, un adelanto o no corresponde'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  select * into v_st from public.card_statements where id = p_statement_id for update;
  if v_st.id is null then
    raise exception 'El resumen no existe' using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  -- The paid parts these lines are in, with the debit and channel that paid
  -- them: read before undoing them.
  for v_parts in
    select distinct on (l.currency) l.currency, m.line_id, t.channel_id
      from public.card_statement_lines l
      join public.transactions t on t.id = l.transaction_id
      join public.bank_statement_matches m on m.transaction_id = t.id
     where l.statement_id = v_st.id
       and l.currency in (
         select x.currency from public.card_statement_lines x
          where x.statement_id = v_st.id and x.id = any (p_line_ids))
       and ((l.currency = 'ARS' and v_st.paid_ars_on is not null)
            or (l.currency = 'USD' and v_st.paid_usd_on is not null))
     order by l.currency
  loop
    v_paid := v_paid || jsonb_build_object(
      'currency', v_parts.currency, 'line_id', v_parts.line_id, 'channel_id', v_parts.channel_id);
  end loop;

  -- A paid part with no matched debit cannot be booked again: refuse
  -- before anything changes.
  if exists (
    select 1 from public.card_statement_lines x
     where x.statement_id = v_st.id and x.id = any (p_line_ids)
       and ((x.currency = 'ARS' and v_st.paid_ars_on is not null)
            or (x.currency = 'USD' and v_st.paid_usd_on is not null))
       and not exists (select 1 from jsonb_array_elements(v_paid) p
                        where p->>'currency' = x.currency)
  ) then
    raise exception 'No se encontró la línea del extracto que pagó este resumen: deshacé el pago y volvé a pagarlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  for v_part in select * from jsonb_array_elements(v_paid) loop
    perform public.unsettle_card_statement(v_st.id, v_part->>'currency', p_user_id);
  end loop;

  update public.card_statement_lines
     set treatment        = p_treatment,
         chart_account_id = case when p_treatment = 'expense' then p_chart_account_id end,
         employee_id      = case when p_treatment = 'advance' then p_employee_id end
   where statement_id = v_st.id and id = any (p_line_ids);
  get diagnostics v_n = row_count;

  for v_part in select * from jsonb_array_elements(v_paid) loop
    perform public.settle_card_statement(
      v_st.id, (v_part->>'line_id')::uuid, v_part->>'currency', v_part->>'channel_id', p_user_id);
  end loop;

  return v_n;
end;
$$;


revoke all on function public.reclassify_card_statement_lines(uuid, uuid[], text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reclassify_card_statement_lines(uuid, uuid[], text, uuid, uuid, uuid)
  to service_role;
