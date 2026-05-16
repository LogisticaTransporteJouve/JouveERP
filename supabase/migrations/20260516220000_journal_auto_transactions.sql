-- L.2b — Asientos automáticos desde transactions.
--
-- Caso más simple del L.2: cada `transactions` row genera UN asiento
-- contable con dos líneas (Debe / Haber). Reglas:
--
--   * Skip si `transactions.invoice_id is not null` — esos movimientos
--     son cobranza/pago de comprobante y van a ser generados por L.2d
--     (recibos / OPs). Generarlos aquí los duplicaría.
--   * Skip `kind = 'transfer_out'` — los transfers son un par (out/in).
--     Procesamos solo el `transfer_in` para emitir UN asiento entre las
--     dos cuentas.
--   * income (sin invoice): Debe(cuenta_tesorería) / Haber(ajustes_caja).
--   * expense (sin invoice): Debe(gastos) / Haber(cuenta_tesorería).
--   * transfer_in: Debe(cuenta_destino) / Haber(cuenta_origen via
--     transfer_pair_id).
--
-- Mapping accounts.type → coa_system_role:
--   bank, investment → 'banco'
--   cash, wallet     → 'caja'
--   checks, echeq    → 'cheques_cartera'
--
-- DELETE: borramos el asiento generado (vía source_table/source_id).
-- UPDATE: out of scope — las transactions son inmutables en la práctica
-- y los UI no permiten editarlas.
--
-- Backfill: al final de esta migration generamos los asientos faltantes
-- de todas las transactions ya existentes que califican.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Helper: coa_role_for_account
------------------------------------------------------------------------------
create or replace function public.coa_role_for_account(p_account_id uuid)
returns public.coa_system_role
language sql
stable
security invoker
set search_path = public
as $$
  select case a.type
    when 'bank'       then 'banco'::public.coa_system_role
    when 'investment' then 'banco'::public.coa_system_role
    when 'cash'       then 'caja'::public.coa_system_role
    when 'wallet'     then 'caja'::public.coa_system_role
    when 'checks'     then 'cheques_cartera'::public.coa_system_role
    when 'echeq'      then 'cheques_cartera'::public.coa_system_role
  end
  from public.accounts a
  where a.id = p_account_id;
$$;

comment on function public.coa_role_for_account(uuid) is
  'Mapea accounts.type → coa_system_role del plan. bank/investment → banco; cash/wallet → caja; checks/echeq → cheques_cartera.';

------------------------------------------------------------------------------
-- 2. Trigger function: generate_journal_for_transaction (AFTER INSERT)
------------------------------------------------------------------------------
create or replace function public.generate_journal_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair          public.transactions;
  v_role          public.coa_system_role;
  v_pair_role     public.coa_system_role;
  v_period        text;
  v_lines         jsonb;
  v_description   text;
begin
  -- Skip movimientos atados a comprobantes (los cubre L.2d).
  if new.invoice_id is not null then
    return new;
  end if;

  -- Transfers: solo procesamos el transfer_in para emitir UN asiento.
  if new.kind = 'transfer_out' then
    return new;
  end if;

  v_period := to_char(new.accrual_month, 'YYYY-MM');
  v_role := public.coa_role_for_account(new.account_id);

  if v_role is null then
    raise warning 'generate_journal_for_transaction: account % sin mapping COA, asiento omitido', new.account_id;
    return new;
  end if;

  if new.kind = 'income' then
    v_description := coalesce(new.description, 'Ingreso de caja');
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', new.amount, 'description', v_description),
      jsonb_build_object('system_role', 'ajustes_caja', 'credit', new.amount, 'description', v_description)
    );

  elsif new.kind = 'expense' then
    v_description := coalesce(new.description, 'Egreso de caja');
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', 'gastos', 'debit', new.amount, 'description', v_description),
      jsonb_build_object('system_role', v_role::text, 'credit', new.amount, 'description', v_description)
    );

  elsif new.kind = 'transfer_in' then
    -- Buscar la otra mitad del par
    select * into v_pair from public.transactions where id = new.transfer_pair_id;
    if v_pair.id is null then
      raise warning 'generate_journal_for_transaction: transfer_in % sin par, asiento omitido', new.id;
      return new;
    end if;
    v_pair_role := public.coa_role_for_account(v_pair.account_id);
    if v_pair_role is null then
      raise warning 'generate_journal_for_transaction: par % sin mapping COA, asiento omitido', v_pair.account_id;
      return new;
    end if;
    v_description := coalesce(new.description, 'Transferencia interna');
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', new.amount, 'description', v_description || ' (entrada)'),
      jsonb_build_object('system_role', v_pair_role::text, 'credit', new.amount, 'description', v_description || ' (salida)')
    );
  else
    return new;
  end if;

  begin
    perform public.create_journal_entry(
      p_entry_date     := new.transaction_date,
      p_accrual_period := v_period,
      p_description    := v_description,
      p_lines          := v_lines,
      p_source_table   := 'transactions',
      p_source_id      := new.id,
      p_channel_id     := new.channel_id
    );
  exception when sqlstate 'P0002' then
    -- Cuenta del plan no asignada — log y seguir; el contador puede correr
    -- el backfill después de asignar el rol faltante.
    raise warning 'generate_journal_for_transaction: % (transaction=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

comment on function public.generate_journal_for_transaction() is
  'AFTER INSERT trigger en transactions: genera el asiento contable correspondiente. Skip transactions con invoice_id (L.2d las cubre) y kind=transfer_out (procesamos solo transfer_in del par).';

create trigger transactions_after_insert_journal
  after insert on public.transactions
  for each row execute function public.generate_journal_for_transaction();

------------------------------------------------------------------------------
-- 3. Trigger AFTER DELETE: borrar el asiento asociado
------------------------------------------------------------------------------
create or replace function public.delete_journal_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.journal_entries
  where source_table = 'transactions'
    and source_id    = old.id;
  return old;
end;
$$;

comment on function public.delete_journal_for_transaction() is
  'AFTER DELETE trigger en transactions: borra el asiento asociado (cascade en journal_entry_lines via FK).';

create trigger transactions_after_delete_journal
  after delete on public.transactions
  for each row execute function public.delete_journal_for_transaction();

------------------------------------------------------------------------------
-- 4. Backfill — asientos para transactions existentes
------------------------------------------------------------------------------
-- Recorre todas las transactions sin asiento (filtra por source_table +
-- source_id) y emite el asiento. Mismo set de skips que el trigger.
-- Llamado al final de la migration con loop para que pueda manejar
-- transfer pairs (necesitamos procesar el in conociendo el out).

do $$
declare
  v_txn public.transactions;
  v_existing uuid;
begin
  for v_txn in
    select t.*
      from public.transactions t
      left join public.journal_entries j
        on j.source_table = 'transactions' and j.source_id = t.id
     where j.id is null
       and t.invoice_id is null
       and t.kind <> 'transfer_out'
     order by t.transaction_date, t.created_at
  loop
    -- Dispará la misma lógica que el trigger via INSERT … vacío no es
    -- posible; en cambio replicamos la lógica básica llamando al trigger
    -- manual. Más simple: usar el mismo PATH llamando a la función
    -- imitando NEW.
    declare
      v_role        public.coa_system_role := public.coa_role_for_account(v_txn.account_id);
      v_pair        public.transactions;
      v_pair_role   public.coa_system_role;
      v_period      text := to_char(v_txn.accrual_month, 'YYYY-MM');
      v_lines       jsonb;
      v_desc        text;
    begin
      if v_role is null then
        continue;
      end if;

      if v_txn.kind = 'income' then
        v_desc := coalesce(v_txn.description, 'Ingreso de caja');
        v_lines := jsonb_build_array(
          jsonb_build_object('system_role', v_role::text, 'debit', v_txn.amount, 'description', v_desc),
          jsonb_build_object('system_role', 'ajustes_caja', 'credit', v_txn.amount, 'description', v_desc)
        );
      elsif v_txn.kind = 'expense' then
        v_desc := coalesce(v_txn.description, 'Egreso de caja');
        v_lines := jsonb_build_array(
          jsonb_build_object('system_role', 'gastos', 'debit', v_txn.amount, 'description', v_desc),
          jsonb_build_object('system_role', v_role::text, 'credit', v_txn.amount, 'description', v_desc)
        );
      elsif v_txn.kind = 'transfer_in' then
        select * into v_pair from public.transactions where id = v_txn.transfer_pair_id;
        if v_pair.id is null then
          continue;
        end if;
        v_pair_role := public.coa_role_for_account(v_pair.account_id);
        if v_pair_role is null then
          continue;
        end if;
        v_desc := coalesce(v_txn.description, 'Transferencia interna');
        v_lines := jsonb_build_array(
          jsonb_build_object('system_role', v_role::text, 'debit', v_txn.amount, 'description', v_desc || ' (entrada)'),
          jsonb_build_object('system_role', v_pair_role::text, 'credit', v_txn.amount, 'description', v_desc || ' (salida)')
        );
      else
        continue;
      end if;

      begin
        perform public.create_journal_entry(
          p_entry_date     := v_txn.transaction_date,
          p_accrual_period := v_period,
          p_description    := v_desc,
          p_lines          := v_lines,
          p_source_table   := 'transactions',
          p_source_id      := v_txn.id,
          p_channel_id     := v_txn.channel_id
        );
      exception when sqlstate 'P0002' then
        raise notice 'backfill: rol faltante para transaction % — skip', v_txn.id;
      end;
    end;
  end loop;
end;
$$;

set row_security = on;
