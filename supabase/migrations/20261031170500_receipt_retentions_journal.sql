SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A fiscal receipt credits `clientes` by total_amount, which includes the
-- retentions and perceptions the client withheld, but only debited the payment
-- lines: the entry never balanced and jel_enforce_balance refused it at commit,
-- so a fiscal receipt with retentions could not be created. Each retention is
-- now debited to the asset it is: percepciones de IIBB to
-- percepciones_iibb_pagadas, everything else to retenciones_pagadas.
-- Same signature and ACL; only the retention lines are new.
create or replace function public.emit_journal_for_receipt(
  p_receipt_id uuid,
  p_reverse boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r       public.receipts;
  v_line    record;
  v_lines   jsonb := '[]'::jsonb;
  v_role    public.coa_system_role;
  v_dir     numeric;
  v_desc    text;
  v_number  text;
  v_entry   uuid;
begin
  select * into v_r from public.receipts where id = p_receipt_id;
  if v_r.id is null then return null; end if;

  if not public.is_channel_fiscal(v_r.channel_id) then
    return null;
  end if;

  v_dir := case when p_reverse then -1 else 1 end;
  v_number := 'R' || lpad(v_r.punto_venta::text, 4, '0') || '-' || lpad(v_r.numero::text, 8, '0');
  v_desc := case when p_reverse then 'Anulación ' else '' end || 'Recibo ' || v_number;

  for v_line in
    select rpl.account_id, rpl.amount, a.name as account_name
      from public.receipt_payment_lines rpl
      join public.accounts a on a.id = rpl.account_id
     where rpl.receipt_id = p_receipt_id
  loop
    v_role := public.coa_role_for_account(v_line.account_id);
    if v_role is null then
      raise warning 'emit_journal_for_receipt: account % sin mapping COA', v_line.account_id;
      continue;
    end if;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      case when v_dir > 0 then 'debit' else 'credit' end, v_line.amount,
      'description', v_desc || ' — ' || v_line.account_name
    );
  end loop;

  for v_line in
    select rr.kind, rr.tax_type, rr.amount
      from public.receipt_retentions rr
     where rr.receipt_id = p_receipt_id
     order by rr.created_at, rr.id
  loop
    v_lines := v_lines || jsonb_build_object(
      'system_role',
        case when v_line.kind = 'percepcion' and v_line.tax_type = 'iibb'
             then 'percepciones_iibb_pagadas' else 'retenciones_pagadas' end,
      case when v_dir > 0 then 'debit' else 'credit' end, v_line.amount,
      'description', v_desc || ' — ' ||
        case when v_line.kind = 'percepcion' then 'percepción ' else 'retención ' end ||
        v_line.tax_type
    );
  end loop;

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'clientes',
    case when v_dir > 0 then 'credit' else 'debit' end, v_r.total_amount,
    'description', v_desc || ' — cliente'
  );

  begin
    v_entry := public.create_journal_entry(
      p_entry_date := v_r.receipt_date,
      p_accrual_period := to_char(v_r.receipt_date, 'YYYY-MM'),
      p_description := v_desc,
      p_lines := v_lines,
      p_source_table := 'receipts',
      p_source_id := v_r.id,
      p_channel_id := v_r.channel_id,
      p_is_reversal := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
    return v_entry;
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_receipt: % (receipt=%)', sqlerrm, v_r.id;
    return null;
  end;
end;
$$;

revoke all on function public.emit_journal_for_receipt(uuid, boolean, uuid) from public, anon, authenticated;
