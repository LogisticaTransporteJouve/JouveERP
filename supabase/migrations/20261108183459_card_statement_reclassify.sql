SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Changing what a paid card purchase was (its chart account or employee):
-- the card is paid first and the expenses are sorted out afterwards. A paid
-- part (pesos or dollars) is booked as a whole against its bank debit, so
-- its lines change by booking it again: undo the part, change the lines and
-- pay it with the same debit and channel, in one transaction. Lines of a
-- part not paid yet just change.
--
-- Rollback: older code does not call it; what it books is what
-- settle_card_statement books.

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
