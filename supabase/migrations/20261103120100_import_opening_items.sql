SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Importador, tanda 2 (roadmap 5.3 + the statement import of 5.4). Five new
-- kinds on the importer of 20261103110000. Expand-only.
--
--   client_tariffs    Tarifas por cliente con vigencia: inserted into
--                     client_tariffs like the tariff dialog does, so the
--                     overlap guard applies; a row with the same client,
--                     concept and start (general area) is skipped.
--   loans             Préstamos at go-live: the loan and its pending
--                     installment schedule, as the loan dialog creates them.
--                     No movement: the disbursement is before the system and
--                     the debt enters with the initial adjustment.
--   checks            Cheques de terceros en cartera at go-live: inserted as
--                     a check loaded by hand (source_kind manual), so
--                     checks_manual_inflow books its cartera inflow
--                     (Dr cartera / Cr ajustes de caja, no client) and the
--                     'received' movement anchors its timeline. Skipped when
--                     the bank and number are already loaded.
--   opening_balances  Cobranzas pendientes at go-live: one opening balance per
--                     client (client_opening_balances, the documented
--                     initial-adjustment path of the client statement),
--                     applied FIFO to invoices before the cut-off exactly as
--                     the owner's dialog does. No receipt, no movement, no
--                     journal entry. A client that already has one is skipped.
--   bank_statement    Lines of a bank statement (bank_statement_lines,
--                     20261103120000), skipped by their source hash.
--
-- 1. import_runs.kind takes the five kinds.
-- 2. import_run_id on client_tariffs, loans, checks and
--    client_opening_balances (NULL for every row loaded by hand).
-- 3. apply_client_opening_balance_core: the body of
--    apply_client_opening_balance (unchanged for its caller, which keeps the
--    owner check) with the user and run as parameters.
-- 4. guard_transaction_owned_by_document lets undo_import_run delete the
--    cartera inflow of an imported check (as update_receipt passes).
-- 5. import_run_outside_reference: the foreign-key scan of the undo, shared.
-- 6. commit_import_run (same signature) with the new kinds.
-- 7. undo_import_run (same signature): each new kind refuses once something
--    happened downstream: a tariff edited or used by a settlement or a
--    storage billing run; a loan or an installment edited, paid or disbursed;
--    a check edited, moved out of the cartera, reconciled or in a closed
--    period; an opening balance re-applied, or a receipt of its client
--    created after the import; a statement line matched or marked "no
--    corresponde".
--
-- Rollback: older code never selects import_run_id, skips runs of a kind it
-- does not know (listImportRunsAction logs and leaves them out) and cannot
-- undo them; imported rows are ordinary tariffs, loans, checks and opening
-- balances for it.

------------------------------------------------------------------------------
-- 1. Kinds
------------------------------------------------------------------------------

-- Replaced by a wider check in the next statement.
-- squawk-ignore ban-drop-constraint
alter table public.import_runs drop constraint import_runs_kind_check;
alter table public.import_runs
  add constraint import_runs_kind_check check (kind in (
    'clients', 'suppliers', 'employees', 'vehicles', 'historic_payroll', 'historic_trips',
    'client_tariffs', 'loans', 'checks', 'opening_balances', 'bank_statement'
  )) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.import_runs validate constraint import_runs_kind_check;

------------------------------------------------------------------------------
-- 2. import_run_id
------------------------------------------------------------------------------

-- Each column is new and all NULL: the FK check has nothing to scan and the
-- partial index starts empty.
alter table public.client_tariffs
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index client_tariffs_import_run_idx on public.client_tariffs (import_run_id)
  where import_run_id is not null;

alter table public.loans
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index loans_import_run_idx on public.loans (import_run_id)
  where import_run_id is not null;

alter table public.checks
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index checks_import_run_idx on public.checks (import_run_id)
  where import_run_id is not null;

alter table public.client_opening_balances
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index client_opening_balances_import_run_idx on public.client_opening_balances (import_run_id)
  where import_run_id is not null;

comment on column public.client_tariffs.import_run_id is
  'Importación que creó la tarifa (import_runs); NULL si se cargó a mano.';
comment on column public.loans.import_run_id is
  'Importación que creó el préstamo con su cronograma (import_runs); NULL si se cargó a mano.';
comment on column public.checks.import_run_id is
  'Importación que cargó el cheque en cartera al arranque (import_runs); NULL si se cargó a mano o por recibo.';
comment on column public.client_opening_balances.import_run_id is
  'Importación que cargó el saldo inicial (import_runs); NULL si lo cargó el owner a mano. Volver a aplicarlo a mano lo reemplaza.';

------------------------------------------------------------------------------
-- 3. Client opening balance, shared body
------------------------------------------------------------------------------

-- The body of apply_client_opening_balance (20261031193400): replaces the
-- client's opening balance and applies it FIFO to the invoices and NDs up to
-- the cut-off that receipts leave open. Callers check who may.
create function public.apply_client_opening_balance_core(
  p_client_id      uuid,
  p_opening_date   date,
  p_target_balance numeric,
  p_notes          text,
  p_user_id        uuid,
  p_import_run_id  uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_invoices   numeric(14, 2);
  v_sum_ncs        numeric(14, 2);
  v_sum_receipts   numeric(14, 2);
  v_real_open      numeric(14, 2);
  v_to_settle      numeric(14, 2);
  v_remaining      numeric(14, 2);
  v_inv            record;
  v_capacity       numeric(14, 2);
  v_apply          numeric(14, 2);
begin
  if p_target_balance is null or p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  delete from public.client_opening_balance_allocations where client_id = p_client_id;
  delete from public.client_opening_balances where client_id = p_client_id;

  select coalesce(sum(c.imp_total), 0) into v_sum_invoices
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and c.fecha <= p_opening_date;

  select coalesce(sum(c.imp_total), 0) into v_sum_ncs
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind = 'nc'
    and c.fecha <= p_opening_date;

  select coalesce(sum(ra.amount_applied), 0) into v_sum_receipts
  from public.receipt_allocations ra
  join public.receipts r on r.id = ra.receipt_id
  join public.invoices  c on c.id = ra.invoice_id
  where r.status = 'issued'
    and r.receipt_date <= p_opening_date
    and c.client_id = p_client_id
    and c.fecha <= p_opening_date;

  v_real_open := v_sum_invoices - v_sum_ncs - v_sum_receipts;
  v_to_settle := greatest(v_real_open - p_target_balance, 0);

  insert into public.client_opening_balances (
    client_id, opening_date, target_balance, total_settled, notes, created_by, import_run_id
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle, p_notes, p_user_id, p_import_run_id
  );

  if v_to_settle = 0 then
    return;
  end if;

  v_remaining := v_to_settle;
  for v_inv in
    select
      c.id,
      c.imp_total - coalesce((
        select sum(ra.amount_applied)
        from public.receipt_allocations ra
        join public.receipts r on r.id = ra.receipt_id
        where ra.invoice_id = c.id
          and r.status = 'issued'
      ), 0) as capacity
    from public.invoices c
    where c.client_id = p_client_id
      and c.status = 'emitted'
      and c.kind in ('factura', 'nd')
      and c.fecha <= p_opening_date
    order by c.fecha asc, c.numero asc, c.created_at asc
  loop
    exit when v_remaining <= 0;
    v_capacity := greatest(v_inv.capacity, 0);
    if v_capacity = 0 then
      continue;
    end if;
    v_apply := least(v_capacity, v_remaining);
    insert into public.client_opening_balance_allocations (
      client_id, invoice_id, amount_applied
    ) values (
      p_client_id, v_inv.id, v_apply
    );
    v_remaining := v_remaining - v_apply;
  end loop;
end;
$$;

comment on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid) is
  'Cuerpo de apply_client_opening_balance: reemplaza el saldo inicial del cliente y lo imputa FIFO a facturas y ND hasta el corte. Interna: la llaman el RPC del owner y el importador.';

revoke all on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.apply_client_opening_balance(
  p_client_id      uuid,
  p_opening_date   date,
  p_target_balance numeric,
  p_notes          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'Solo el owner puede ajustar saldos de cliente' using errcode = '42501';
  end if;
  perform public.apply_client_opening_balance_core(
    p_client_id, p_opening_date, p_target_balance, p_notes, auth.uid(), null
  );
end;
$$;

revoke all on function public.apply_client_opening_balance(uuid, date, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_client_opening_balance(uuid, date, numeric, text) to authenticated;

------------------------------------------------------------------------------
-- 4. The undo deletes an imported check's inflow
------------------------------------------------------------------------------

-- Same as 20261103100200 plus undo_import_run in the stack bypass.
create or replace function public.guard_transaction_owned_by_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
  v_owner text;
begin
  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(update_receipt|update_payment_order|apply_account_opening_balance|clear_account_opening_balance|undo_import_run)\(' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if (old.rejected_check_id is not null
        or old.manual_check_id is not null
        or old.check_sale_id is not null
        or exists (select 1 from public.payroll_payments where transaction_id = old.id)
        or exists (select 1 from public.loan_installments where transaction_id = old.id)
        or exists (select 1 from public.loans where disbursement_transaction_id = old.id)
        or exists (select 1 from public.check_movements where transaction_id = old.id)
        or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
        or exists (select 1 from public.employee_account_movements where transaction_id = old.id))
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id
         or new.check_sale_id    is distinct from old.check_sale_id) then
      raise exception
        'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un documento (sueldo, préstamo, cheque, saldo inicial o cuenta corriente de un empleado): editá el documento de origen'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  v_owner := case
    when old.receipt_id is not null then 'un recibo'
    when old.payment_order_id is not null then 'una orden de pago'
    when old.invoice_id is not null then 'un comprobante'
    when old.issued_check_id is not null then 'el cobro de un cheque propio'
    when old.rejected_check_id is not null then 'un cheque rechazado'
    when old.manual_check_id is not null then 'un cheque cargado a mano'
    when old.check_sale_id is not null then 'una venta de cheques'
    when exists (select 1 from public.loan_installments where transaction_id = old.id)
      then 'una cuota de préstamo'
    when exists (select 1 from public.loans where disbursement_transaction_id = old.id)
      then 'el desembolso de un préstamo'
    when exists (select 1 from public.payroll_payments where transaction_id = old.id)
      then 'un pago de sueldo'
    when exists (select 1 from public.check_movements where transaction_id = old.id)
      then 'un movimiento de cheque'
    when exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
      then 'un saldo inicial de cuenta'
    when exists (select 1 from public.employee_account_movements where transaction_id = old.id)
      then 'la cuenta corriente de un empleado'
  end;
  if v_owner is not null then
    raise exception
      'No se puede borrar un movimiento generado por %: anulá o editá el documento de origen', v_owner
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_transaction_owned_by_document() from public, anon, authenticated;

------------------------------------------------------------------------------
-- 5. Foreign-key scan of the undo
------------------------------------------------------------------------------

-- The first table (schema.table) with a row outside the run that references
-- one of the run's rows of p_table, through any single-column foreign key,
-- or NULL. A referencing table that has import_run_id ignores its rows of the
-- same run; p_skip lists the 'table.column' references the caller deletes
-- itself (rows the import created along with its own).
create function public.import_run_outside_reference(
  p_table  text,
  p_run_id uuid,
  p_skip   text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fk    record;
  v_found boolean;
begin
  for v_fk in
    select sn.nspname as src_schema, src.relname as src_table,
           sa.attname as src_column, ta.attname as ref_column,
           exists (
             select 1 from pg_catalog.pg_attribute ia
              where ia.attrelid = c.conrelid and ia.attname = 'import_run_id'
                and not ia.attisdropped
           ) as src_has_run
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class src on src.oid = c.conrelid
      join pg_catalog.pg_namespace sn on sn.oid = src.relnamespace
      join pg_catalog.pg_attribute sa on sa.attrelid = c.conrelid and sa.attnum = c.conkey[1]
      join pg_catalog.pg_attribute ta on ta.attrelid = c.confrelid and ta.attnum = c.confkey[1]
     where c.contype = 'f'
       and c.confrelid = format('public.%I', p_table)::regclass
       and cardinality(c.conkey) = 1
  loop
    if v_fk.src_schema = 'public'
       and (v_fk.src_table || '.' || v_fk.src_column) = any (coalesce(p_skip, '{}')) then
      continue;
    end if;
    execute format(
      'select exists (select 1 from %I.%I r where r.%I in (select t.%I from public.%I t where t.import_run_id = $1)%s)',
      v_fk.src_schema, v_fk.src_table, v_fk.src_column, v_fk.ref_column, p_table,
      case when v_fk.src_has_run then ' and r.import_run_id is distinct from $1' else '' end)
      into v_found using p_run_id;
    if v_found then
      return v_fk.src_table;
    end if;
  end loop;
  return null;
end;
$$;

comment on function public.import_run_outside_reference(text, uuid, text[]) is
  'Para deshacer una importación: la primera tabla con una fila de afuera de la corrida que referencia una de sus filas, o NULL. Interna (la llama undo_import_run).';

revoke all on function public.import_run_outside_reference(text, uuid, text[]) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 6. commit_import_run
------------------------------------------------------------------------------

-- Same as 20261103110000 plus the five kinds. Each row of the new kinds
-- carries its targets (client, account, channel) as the action resolved
-- them; the checks below are the database's own line behind the preview.
create or replace function public.commit_import_run(
  p_kind         text,
  p_file_name    text,
  p_file_sha256  text,
  p_mapping      jsonb,
  p_total_rows   integer,
  p_skipped_rows integer,
  p_invalid_rows integer,
  p_rows         jsonb,
  p_user_id      uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id   uuid;
  v_sent     integer;
  v_inserted integer := 0;
  v_row      record;
  v_loan_id  uuid;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Las filas de la importación no son válidas'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  v_sent := jsonb_array_length(p_rows);
  if v_sent = 0 then
    raise exception 'No hay filas para importar'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if v_sent > 5000 then
    raise exception 'Una importación lleva hasta 5000 filas: dividí el archivo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Two imports of the same kind never interleave their duplicate checks.
  perform pg_advisory_xact_lock(hashtextextended('import_runs:' || p_kind, 0));

  insert into public.import_runs (
    kind, file_name, file_sha256, mapping, total_rows, invalid_rows, created_by
  )
  values (
    p_kind, p_file_name, p_file_sha256, coalesce(p_mapping, '{}'::jsonb),
    p_total_rows, coalesce(p_invalid_rows, 0), p_user_id
  )
  returning id into v_run_id;

  if p_kind = 'clients' then
    with src as (
      select distinct on (coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))))
             r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               legal_name text, display_name text, cuit text, iva_condition text,
               email text, phone text, address text, real_address text, notes text,
               is_fiscal boolean
             )
       order by coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))), e.ord
    ),
    ins as (
      insert into public.clients (
        legal_name, display_name, cuit, iva_condition, email, phone, address,
        real_address, notes, is_fiscal, created_by, import_run_id
      )
      select s.legal_name, s.display_name, s.cuit, s.iva_condition, s.email, s.phone,
             s.address, s.real_address, s.notes, s.is_fiscal, p_user_id, v_run_id
        from src s
       where (s.is_fiscal and not exists (
                select 1 from public.clients c where c.cuit = s.cuit))
          or (not s.is_fiscal and not exists (
                select 1 from public.clients c
                 where not c.is_fiscal
                   and lower(regexp_replace(trim(c.legal_name), '\s+', ' ', 'g'))
                     = lower(regexp_replace(trim(s.legal_name), '\s+', ' ', 'g'))))
      on conflict do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'suppliers' then
    with src as (
      select distinct on (coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))))
             r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               legal_name text, display_name text, cuit text, iva_condition text,
               email text, phone text, address text, real_address text, notes text,
               is_fiscal boolean
             )
       order by coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))), e.ord
    ),
    ins as (
      insert into public.suppliers (
        legal_name, display_name, cuit, iva_condition, email, phone, address,
        real_address, notes, is_fiscal, created_by, import_run_id
      )
      select s.legal_name, s.display_name, s.cuit, s.iva_condition, s.email, s.phone,
             s.address, s.real_address, s.notes, s.is_fiscal, p_user_id, v_run_id
        from src s
       where (s.is_fiscal and not exists (
                select 1 from public.suppliers c where c.cuit = s.cuit))
          or (not s.is_fiscal and not exists (
                select 1 from public.suppliers c
                 where not c.is_fiscal
                   and lower(regexp_replace(trim(c.legal_name), '\s+', ' ', 'g'))
                     = lower(regexp_replace(trim(s.legal_name), '\s+', ' ', 'g'))))
      on conflict do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'employees' then
    with src as (
      select distinct on (coalesce(r.cuil, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))))
             r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               legal_name text, position text, cuil text, cbu text, pay_frequency text,
               base_salary numeric, viatico_monthly numeric, is_monotributo boolean,
               hire_date date, termination_date date, notes text, convenio text,
               categoria text, obra_social text, art text
             )
       order by coalesce(r.cuil, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))), e.ord
    ),
    ins as (
      insert into public.employees (
        legal_name, position, cuil, cbu, pay_frequency, base_salary, viatico_monthly,
        is_monotributo, hire_date, termination_date, is_active, notes, convenio,
        categoria, obra_social, art, created_by, import_run_id
      )
      select s.legal_name, s.position, s.cuil, s.cbu, s.pay_frequency, s.base_salary,
             coalesce(s.viatico_monthly, 0), coalesce(s.is_monotributo, false), s.hire_date,
             s.termination_date, s.termination_date is null, s.notes, s.convenio,
             s.categoria, s.obra_social, s.art, p_user_id, v_run_id
        from src s
       where (s.cuil is not null and not exists (
                select 1 from public.employees e where e.cuil = s.cuil))
          or (s.cuil is null and not exists (
                select 1 from public.employees e
                 where lower(regexp_replace(trim(e.legal_name), '\s+', ' ', 'g'))
                     = lower(regexp_replace(trim(s.legal_name), '\s+', ' ', 'g'))))
      returning id, legal_name, cuil, is_active, position
    ),
    drv as (
      -- The employee form gives a driver position its driver record
      -- (features/hr/lib/employee-driver.ts): the same here.
      insert into public.drivers (
        employee_id, full_name, cuit, is_active, created_by, import_run_id
      )
      select i.id, i.legal_name, i.cuil, i.is_active, p_user_id, v_run_id
        from ins i
       where i.position = 'Chofer / Acompañante'
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'vehicles' then
    with src as (
      select distinct on (upper(regexp_replace(r.patente, '[^0-9A-Za-z]', '', 'g')))
             r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               patente text, vehicle_type text, alias text, brand text, model text,
               year integer, fleet text, fuel_card text, capacity_kg numeric, notes text
             )
       order by upper(regexp_replace(r.patente, '[^0-9A-Za-z]', '', 'g')), e.ord
    ),
    ins as (
      insert into public.vehicles (
        patente, vehicle_type, alias, brand, model, year, fleet, fuel_card,
        capacity_kg, notes, created_by, import_run_id
      )
      select s.patente, s.vehicle_type, s.alias, s.brand, s.model, s.year, s.fleet,
             s.fuel_card, s.capacity_kg, s.notes, p_user_id, v_run_id
        from src s
       where not exists (
               select 1 from public.vehicles v
                where upper(regexp_replace(v.patente, '[^0-9A-Za-z]', '', 'g'))
                    = upper(regexp_replace(s.patente, '[^0-9A-Za-z]', '', 'g')))
      on conflict do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'historic_payroll' then
    with ins as (
      insert into public.historic_payroll_entries (
        import_run_id, employee_id, period, kind, net_amount, paid_amount, paid_on, notes
      )
      select v_run_id, r.employee_id, r.period, r.kind, r.net_amount, r.paid_amount,
             r.paid_on, r.notes
        from jsonb_to_recordset(p_rows) as r(
               employee_id uuid, period text, kind text, net_amount numeric,
               paid_amount numeric, paid_on date, notes text
             )
      on conflict (employee_id, period, kind) do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'historic_trips' then
    with ins as (
      insert into public.historic_trips (
        import_run_id, trip_date, vehicle_id, vehicle_label, driver_id, driver_label,
        client_id, client_label, origin, destination, km, freight_amount, notes,
        source_hash
      )
      select v_run_id, r.trip_date, r.vehicle_id, r.vehicle_label, r.driver_id,
             r.driver_label, r.client_id, r.client_label, r.origin, r.destination,
             r.km, r.freight_amount, r.notes, r.source_hash
        from jsonb_to_recordset(p_rows) as r(
               trip_date date, vehicle_id uuid, vehicle_label text, driver_id uuid,
               driver_label text, client_id uuid, client_label text, origin text,
               destination text, km numeric, freight_amount numeric, notes text,
               source_hash text
             )
      on conflict (source_hash) do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'client_tariffs' then
    -- One row per client, concept and start: the first one in the file wins
    -- and an existing general-area tariff with that start skips it. Any other
    -- overlap is refused by guard_client_tariff_overlap and fails the run.
    with src as (
      select distinct on (r.client_id, r.concept, r.valid_from) r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               client_id uuid, concept text, unit text, price numeric, currency text,
               valid_from date, valid_to date, notes text
             )
       order by r.client_id, r.concept, r.valid_from, e.ord
    ),
    ins as (
      insert into public.client_tariffs (
        client_id, concept, unit, price, currency, valid_from, valid_to, notes,
        created_by, import_run_id
      )
      select s.client_id, s.concept, s.unit, s.price, coalesce(s.currency, 'ARS'),
             s.valid_from, s.valid_to, s.notes, p_user_id, v_run_id
        from src s
       where not exists (
               select 1 from public.client_tariffs t
                where t.client_id = s.client_id
                  and t.concept = s.concept
                  and t.area_id is null
                  and t.valid_from = s.valid_from)
       order by s.client_id, s.concept, s.valid_from
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'loans' then
    -- The loan and its schedule, as the loan dialog writes them. Same
    -- description, lender and first due date as a loan already loaded (or
    -- earlier in the file) = the same loan.
    for v_row in
      select r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               kind text, description text, lender text, principal numeric,
               currency text, channel_id text, installments_count integer,
               first_due_date date, notes text, installments jsonb
             )
       order by e.ord
    loop
      if exists (
        select 1 from public.loans l
         where lower(regexp_replace(trim(l.description), '\s+', ' ', 'g'))
             = lower(regexp_replace(trim(v_row.description), '\s+', ' ', 'g'))
           and lower(regexp_replace(trim(coalesce(l.lender, '')), '\s+', ' ', 'g'))
             = lower(regexp_replace(trim(coalesce(v_row.lender, '')), '\s+', ' ', 'g'))
           and l.first_due_date = v_row.first_due_date
      ) then
        continue;
      end if;
      if v_row.installments is null
         or jsonb_typeof(v_row.installments) <> 'array'
         or jsonb_array_length(v_row.installments) <> v_row.installments_count then
        raise exception 'El cronograma del préstamo "%" no coincide con su cantidad de cuotas', v_row.description
          using errcode = '22023', hint = 'jouve_guard';
      end if;

      insert into public.loans (
        kind, description, lender, principal, currency, channel_id,
        installments_count, first_due_date, notes, created_by, import_run_id
      ) values (
        v_row.kind::public.loan_kind, v_row.description, v_row.lender, v_row.principal,
        v_row.currency, v_row.channel_id, v_row.installments_count, v_row.first_due_date,
        v_row.notes, p_user_id, v_run_id
      )
      returning id into v_loan_id;

      insert into public.loan_installments (loan_id, number, due_date, amount)
      select v_loan_id, i.number, i.due_date, i.amount
        from jsonb_to_recordset(v_row.installments) as i(
               number integer, due_date date, amount numeric
             );

      v_inserted := v_inserted + 1;
    end loop;

  elsif p_kind = 'checks' then
    if exists (
      select 1
        from jsonb_to_recordset(p_rows) as r(cartera_account_id uuid)
        left join public.accounts a on a.id = r.cartera_account_id
       where a.id is null or a.type not in ('checks', 'echeq')
    ) then
      raise exception 'La cuenta de cartera no es una cuenta de cheques'
        using errcode = '22023', hint = 'jouve_guard';
    end if;

    -- A check loaded by hand: checks_manual_inflow books its cartera inflow.
    -- Bank and number already loaded (checks_unique_number_per_bank_idx) =
    -- the same check.
    with ins as (
      insert into public.checks (
        kind, check_number, bank_name, drawer_name, drawer_cuit, issue_date, due_date,
        amount, currency, cartera_account_id, channel_id, source_kind, notes,
        created_by, import_run_id
      )
      select r.kind, r.check_number, r.bank_name, r.drawer_name, r.drawer_cuit,
             r.issue_date, r.due_date, r.amount, r.currency, r.cartera_account_id,
             r.channel_id, 'manual', r.notes, p_user_id, v_run_id
        from jsonb_to_recordset(p_rows) as r(
               kind text, check_number text, bank_name text, drawer_name text,
               drawer_cuit text, issue_date date, due_date date, amount numeric,
               currency text, cartera_account_id uuid, channel_id text, notes text
             )
      on conflict do nothing
      returning id, issue_date
    ),
    mov as (
      insert into public.check_movements (check_id, event, event_date, created_by)
      select i.id, 'received', i.issue_date, p_user_id from ins i
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'opening_balances' then
    -- The owner's opening balance of each client, applied as the dialog does.
    -- A client that already has one (or appears earlier in the file) is
    -- skipped: the import never replaces a balance.
    for v_row in
      select r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               client_id uuid, opening_date date, target_balance numeric, notes text
             )
       order by e.ord
    loop
      if exists (
        select 1 from public.client_opening_balances ob where ob.client_id = v_row.client_id
      ) then
        continue;
      end if;
      perform public.apply_client_opening_balance_core(
        v_row.client_id, v_row.opening_date, v_row.target_balance, v_row.notes,
        p_user_id, v_run_id
      );
      v_inserted := v_inserted + 1;
    end loop;

  elsif p_kind = 'bank_statement' then
    if exists (
      select 1
        from jsonb_to_recordset(p_rows) as r(account_id uuid)
        left join public.accounts a on a.id = r.account_id
       where a.id is null or a.type in ('checks', 'echeq')
    ) then
      raise exception 'El extracto es de una cuenta de banco, billetera, caja o inversión'
        using errcode = '22023', hint = 'jouve_guard';
    end if;

    with ins as (
      insert into public.bank_statement_lines (
        account_id, import_run_id, line_date, description, amount, balance,
        reference, source_hash
      )
      select r.account_id, v_run_id, r.line_date, r.description, r.amount, r.balance,
             r.reference, r.source_hash
        from jsonb_to_recordset(p_rows) as r(
               account_id uuid, line_date date, description text, amount numeric,
               balance numeric, reference text, source_hash text
             )
      on conflict (account_id, source_hash) do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  else
    raise exception 'Tipo de importación desconocido: %', p_kind
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  update public.import_runs
     set inserted_rows = v_inserted,
         skipped_rows = coalesce(p_skipped_rows, 0) + (v_sent - v_inserted)
   where id = v_run_id;

  return v_run_id;
end;
$$;

comment on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid) is
  'Registra una importación y sus filas en una transacción, salteando las que ya existen por su clave natural. Solo service role (la acción exige imports:write y el permiso del módulo).';

revoke all on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)
  to service_role;

------------------------------------------------------------------------------
-- 7. undo_import_run
------------------------------------------------------------------------------

create or replace function public.undo_import_run(p_run_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run    public.import_runs%rowtype;
  v_tables text[];
  v_table  text;
  v_ref    text;
  v_edited boolean;
begin
  select * into v_run from public.import_runs where id = p_run_id for update;
  if not found then
    raise exception 'La importación no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  -- A retry of an undo that already went through.
  if v_run.status = 'undone' then
    return;
  end if;

  if v_run.kind in ('clients', 'suppliers', 'employees', 'vehicles', 'historic_payroll', 'historic_trips') then
    -- Children before parents: an imported driver points at its employee.
    v_tables := case v_run.kind
      when 'clients' then array['clients']
      when 'suppliers' then array['suppliers']
      when 'employees' then array['drivers', 'employees']
      when 'vehicles' then array['vehicles']
      when 'historic_payroll' then array['historic_payroll_entries']
      when 'historic_trips' then array['historic_trips']
    end;

    foreach v_table in array v_tables loop
      -- Locking the rows first keeps anyone from pointing a new row at them
      -- (a foreign key insert takes KEY SHARE) until this transaction ends.
      execute format('select 1 from public.%I where import_run_id = $1 for update', v_table)
        using p_run_id;

      if v_table not in ('historic_payroll_entries', 'historic_trips') then
        execute format(
          'select exists (select 1 from public.%I where import_run_id = $1 and updated_at > created_at)',
          v_table)
          into v_edited using p_run_id;
        if v_edited then
          raise exception 'No se puede deshacer la importación: algún registro se editó después de importarlo'
            using errcode = '55006', hint = 'jouve_guard';
        end if;
      end if;

      v_ref := public.import_run_outside_reference(v_table, p_run_id, null);
      if v_ref is not null then
        raise exception 'No se puede deshacer la importación: sus registros ya se usan en otros datos (%)', v_ref
          using errcode = '55006', hint = 'jouve_guard';
      end if;

      execute format('delete from public.%I where import_run_id = $1', v_table)
        using p_run_id;
    end loop;

  elsif v_run.kind = 'client_tariffs' then
    perform 1 from public.client_tariffs where import_run_id = p_run_id for update;
    if exists (
      select 1 from public.client_tariffs
       where import_run_id = p_run_id and updated_at > created_at
    ) then
      raise exception 'No se puede deshacer la importación: alguna tarifa se editó después de importarla'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- A storage billing run created since, for a client and period an
    -- imported tariff covers, may have priced with it.
    if exists (
      select 1
        from public.client_tariffs t
        join public.storage_billing_runs b on b.client_id = t.client_id
       where t.import_run_id = p_run_id
         and b.created_at > v_run.created_at
         and daterange(t.valid_from, t.valid_to, '[]')
             && daterange(b.period_start, b.period_end, '[]')
    ) then
      raise exception 'No se puede deshacer la importación: ya se facturó almacenaje con estas tarifas'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    v_ref := public.import_run_outside_reference('client_tariffs', p_run_id, null);
    if v_ref is not null then
      raise exception 'No se puede deshacer la importación: sus tarifas ya se usan en otros datos (%)', v_ref
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    delete from public.client_tariffs where import_run_id = p_run_id;

  elsif v_run.kind = 'loans' then
    perform 1 from public.loans where import_run_id = p_run_id for update;
    perform 1 from public.loan_installments i
      join public.loans l on l.id = i.loan_id
     where l.import_run_id = p_run_id
       for update of i;
    if exists (
      select 1 from public.loans
       where import_run_id = p_run_id
         and (updated_at > created_at or status <> 'active'
              or disbursement_transaction_id is not null)
    ) or exists (
      select 1 from public.loan_installments i
        join public.loans l on l.id = i.loan_id
       where l.import_run_id = p_run_id
         and (i.updated_at > i.created_at or i.status <> 'pendiente'
              or i.transaction_id is not null)
    ) then
      raise exception 'No se puede deshacer la importación: algún préstamo o cuota se editó, se pagó o tiene desembolso'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    v_ref := public.import_run_outside_reference('loans', p_run_id, array['loan_installments.loan_id']);
    if v_ref is not null then
      raise exception 'No se puede deshacer la importación: sus préstamos ya se usan en otros datos (%)', v_ref
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- The installments go with their loan (on delete cascade).
    delete from public.loans where import_run_id = p_run_id;

  elsif v_run.kind = 'checks' then
    perform 1 from public.checks where import_run_id = p_run_id for update;
    if exists (
      select 1 from public.checks
       where import_run_id = p_run_id
         and (status <> 'en_cartera' or updated_at > created_at)
    ) or exists (
      select 1 from public.check_movements m
        join public.checks k on k.id = m.check_id
       where k.import_run_id = p_run_id and m.event <> 'received'
    ) then
      raise exception 'No se puede deshacer la importación: algún cheque se editó o ya salió de la cartera'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    v_ref := public.import_run_outside_reference(
      'checks', p_run_id, array['check_movements.check_id', 'transactions.manual_check_id']);
    if v_ref is not null then
      raise exception 'No se puede deshacer la importación: sus cheques ya se usan en otros datos (%)', v_ref
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- The cartera inflow of each check (and its journal entry, on delete).
    -- A reconciled inflow or one in a closed period is refused by its guards.
    delete from public.transactions t
     using public.checks k
     where t.manual_check_id = k.id and k.import_run_id = p_run_id;
    delete from public.check_movements m
     using public.checks k
     where m.check_id = k.id and k.import_run_id = p_run_id;
    delete from public.checks where import_run_id = p_run_id;

  elsif v_run.kind = 'opening_balances' then
    perform 1 from public.client_opening_balances where import_run_id = p_run_id for update;
    if exists (
      select 1 from public.client_opening_balances
       where import_run_id = p_run_id and updated_at > created_at
    ) then
      raise exception 'No se puede deshacer la importación: algún saldo inicial se editó después de importarlo'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- A receipt of the client since the import may be collecting this debt.
    if exists (
      select 1
        from public.client_opening_balances ob
        join public.receipts r on r.client_id = ob.client_id
       where ob.import_run_id = p_run_id
         and r.created_at > v_run.created_at
    ) then
      raise exception 'No se puede deshacer la importación: algún cliente ya tiene recibos cargados después de importar su saldo'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    v_ref := public.import_run_outside_reference(
      'client_opening_balances', p_run_id, array['client_opening_balance_allocations.client_id']);
    if v_ref is not null then
      raise exception 'No se puede deshacer la importación: sus saldos ya se usan en otros datos (%)', v_ref
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    delete from public.client_opening_balance_allocations a
     using public.client_opening_balances ob
     where a.client_id = ob.client_id and ob.import_run_id = p_run_id;
    delete from public.client_opening_balances where import_run_id = p_run_id;

  elsif v_run.kind = 'bank_statement' then
    perform 1 from public.bank_statement_lines where import_run_id = p_run_id for update;
    if exists (
      select 1 from public.bank_statement_lines
       where import_run_id = p_run_id and status <> 'open'
    ) then
      raise exception 'No se puede deshacer la importación: alguna línea del extracto ya está conciliada o marcada como que no corresponde'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    v_ref := public.import_run_outside_reference('bank_statement_lines', p_run_id, null);
    if v_ref is not null then
      raise exception 'No se puede deshacer la importación: sus líneas ya se usan en otros datos (%)', v_ref
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    delete from public.bank_statement_lines where import_run_id = p_run_id;

  else
    raise exception 'Tipo de importación desconocido: %', v_run.kind
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  update public.import_runs
     set status = 'undone', undone_at = now(), undone_by = p_user_id
   where id = p_run_id;
end;
$$;

comment on function public.undo_import_run(uuid, uuid) is
  'Deshace una importación: borra sus filas si ninguna se editó, se usa en otros datos ni tuvo efectos posteriores (cobros, pagos, conciliación, facturación) y la marca deshecha. Idempotente. Solo service role (la acción exige imports:write y el permiso del módulo).';

revoke all on function public.undo_import_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.undo_import_run(uuid, uuid) to service_role;
