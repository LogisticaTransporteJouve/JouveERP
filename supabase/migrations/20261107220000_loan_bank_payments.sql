SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The bank's payment receipts of a loan in course, booked without Caja.
--
-- 1. loan_bank_payments: each «Comprobante de pago de préstamo» of a loan,
--    with what it applied (capital, interest, punitorios and compensatorios,
--    IVA, IVA and IIBB perceptions). One row per receipt number.
-- 2. record_loan_bank_payments: stores the receipts and, for each one dated
--    from p_book_from on that pays a cuota paid before the loan was loaded,
--    posts its journal entry: the capital lowers Préstamos financieros, the
--    rest goes to interest, IVA crédito fiscal and perceptions, against
--    Bancos. No movement in Caja: that money left before the system's start.
--    A cuota paid in the system already has its entry and is not posted again.
-- 3. journal_entries.source_table admits both as sources.
-- 4. book_loan_opening: what the loan owed when the year being closed began,
--    once per loan, with no movement in Caja: a loan granted before that date
--    carries its capital still owed as Préstamos financieros against
--    Resultados no asignados; one granted within the year books its
--    disbursement on the date granted, Bancos against Préstamos financieros.
--    The receipts' entries then lower it.

create table public.loan_bank_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  receipt_number text not null check (char_length(receipt_number) between 1 and 40),
  paid_date date not null,
  installment_number integer not null check (installment_number > 0),
  total numeric(14, 2) not null check (total > 0),
  capital numeric(14, 2) not null default 0 check (capital >= 0),
  interest numeric(14, 2) not null default 0 check (interest >= 0),
  late_interest numeric(14, 2) not null default 0 check (late_interest >= 0),
  iva numeric(14, 2) not null default 0 check (iva >= 0),
  iva_perception numeric(14, 2) not null default 0 check (iva_perception >= 0),
  iibb_perception numeric(14, 2) not null default 0 check (iibb_perception >= 0),
  journal_entry_id uuid references public.journal_entries (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint loan_bank_payments_receipt_key unique (loan_id, receipt_number),
  constraint loan_bank_payments_parts_check check (
    capital + interest + late_interest + iva + iva_perception + iibb_perception = total
  )
);

create index loan_bank_payments_loan_idx
  on public.loan_bank_payments (loan_id, installment_number);
create index loan_bank_payments_journal_idx
  on public.loan_bank_payments (journal_entry_id)
  where journal_entry_id is not null;

alter table public.loan_bank_payments enable row level security;

create policy "loan_bank_payments select" on public.loan_bank_payments
  for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

-- Written only through record_loan_bank_payments.
revoke insert, update, delete on public.loan_bank_payments from anon, authenticated;

alter table public.loans
  -- squawk-ignore adding-foreign-key-constraint
  add column opening_journal_entry_id uuid
    references public.journal_entries (id) on delete set null;

-- A loan's receipts and its opening debt are journal sources too.
alter table public.journal_entries
  -- squawk-ignore ban-drop-constraint
  drop constraint journal_entries_source_table_domain,
  -- squawk-ignore constraint-missing-not-valid
  add constraint journal_entries_source_table_domain check (
    source_table = any (array[
      'invoices', 'purchase_invoices', 'receipts', 'payment_orders',
      'transactions', 'checks', 'issued_checks', 'loan_bank_payments', 'loans'
    ])
  );

create or replace function public.record_loan_bank_payments(
  p_loan_id uuid,
  p_payments jsonb,
  p_book_from date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan        public.loans%rowtype;
  v_fiscal      boolean;
  v_payment     record;
  v_id          uuid;
  v_entry       uuid;
  v_paid_out    boolean;
  v_inserted    int := 0;
  v_booked      int := 0;
  v_description text;
  v_lines       jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para cargar pagos de préstamos'
      using errcode = '42501';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'El préstamo no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  select c.is_fiscal into v_fiscal
    from public.invoicing_channels c where c.id = v_loan.channel_id;

  for v_payment in
    select * from jsonb_to_recordset(p_payments) as p(
      receipt_number text, paid_date date, installment_number integer,
      total numeric, capital numeric, interest numeric, late_interest numeric,
      iva numeric, iva_perception numeric, iibb_perception numeric
    )
    order by paid_date, receipt_number
  loop
    insert into public.loan_bank_payments (
      loan_id, receipt_number, paid_date, installment_number, total,
      capital, interest, late_interest, iva, iva_perception, iibb_perception,
      created_by
    ) values (
      p_loan_id, v_payment.receipt_number, v_payment.paid_date,
      v_payment.installment_number, v_payment.total,
      coalesce(v_payment.capital, 0), coalesce(v_payment.interest, 0),
      coalesce(v_payment.late_interest, 0), coalesce(v_payment.iva, 0),
      coalesce(v_payment.iva_perception, 0),
      coalesce(v_payment.iibb_perception, 0),
      auth.uid()
    )
    on conflict (loan_id, receipt_number) do nothing
    returning id into v_id;

    if v_id is null then
      continue;
    end if;
    v_inserted := v_inserted + 1;

    select i.paid_outside into v_paid_out
      from public.loan_installments i
     where i.loan_id = p_loan_id and i.number = v_payment.installment_number;

    if coalesce(v_fiscal, false)
       and coalesce(v_paid_out, false)
       and v_payment.paid_date >= p_book_from then
      v_description := 'Cuota ' || v_payment.installment_number || ' — '
        || v_loan.description
        || coalesce(' ' || v_loan.loan_number, '')
        || ' (comprobante ' || v_payment.receipt_number || ')';
      v_lines := jsonb_build_array(
        jsonb_build_object('system_role', 'banco',
          'credit', v_payment.total, 'description', v_description)
      );
      if coalesce(v_payment.capital, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'prestamos', 'debit', v_payment.capital,
          'description', v_description || ' — capital'));
      end if;
      if coalesce(v_payment.interest, 0) + coalesce(v_payment.late_interest, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'intereses_pagados',
          'debit', coalesce(v_payment.interest, 0) + coalesce(v_payment.late_interest, 0),
          'description', v_description || ' — intereses'));
      end if;
      if coalesce(v_payment.iva, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'iva_credito', 'debit', v_payment.iva,
          'description', v_description || ' — IVA'));
      end if;
      if coalesce(v_payment.iva_perception, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'percepciones_iva_pagadas', 'debit', v_payment.iva_perception,
          'description', v_description || ' — percepción IVA'));
      end if;
      if coalesce(v_payment.iibb_perception, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'percepciones_iibb_pagadas', 'debit', v_payment.iibb_perception,
          'description', v_description || ' — percepción IIBB'));
      end if;

      v_entry := public.create_journal_entry(
        v_payment.paid_date,
        to_char(v_payment.paid_date, 'YYYY-MM'),
        v_description,
        v_lines,
        'loan_bank_payments',
        v_id,
        v_loan.channel_id
      );
      update public.loan_bank_payments set journal_entry_id = v_entry where id = v_id;
      v_booked := v_booked + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'booked', v_booked);
end;
$$;

revoke all on function public.record_loan_bank_payments(uuid, jsonb, date)
  from public, anon;
grant execute on function public.record_loan_bank_payments(uuid, jsonb, date)
  to authenticated;

create or replace function public.book_loan_opening(
  p_loan_id uuid,
  p_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan    public.loans%rowtype;
  v_fiscal  boolean;
  v_owed    numeric;
  v_equity  uuid;
  v_entry   uuid;
  v_desc    text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar la deuda de apertura'
      using errcode = '42501';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'El préstamo no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_loan.opening_journal_entry_id is not null then
    raise exception 'La deuda de apertura de este préstamo ya está registrada'
      using errcode = '23505', hint = 'jouve_guard';
  end if;
  select c.is_fiscal into v_fiscal
    from public.invoicing_channels c where c.id = v_loan.channel_id;
  if not coalesce(v_fiscal, false) then
    raise exception 'Solo un préstamo del canal fiscal lleva asientos'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_loan.start_date is null then
    raise exception 'Cargá la fecha de alta del préstamo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_loan.disbursement_transaction_id is not null then
    raise exception 'El desembolso del préstamo ya está registrado en Caja'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- Granted within the year: its disbursement, on the date granted.
  if v_loan.start_date >= p_date then
    v_owed := coalesce(v_loan.original_amount, v_loan.principal);
    v_desc := 'Desembolso — ' || v_loan.description
      || coalesce(' ' || v_loan.loan_number, '');
    v_entry := public.create_journal_entry(
      v_loan.start_date,
      to_char(v_loan.start_date, 'YYYY-MM'),
      v_desc,
      jsonb_build_array(
        jsonb_build_object('system_role', 'banco', 'debit', v_owed, 'description', v_desc),
        jsonb_build_object('system_role', 'prestamos', 'credit', v_owed, 'description', v_desc)
      ),
      'loans',
      p_loan_id,
      v_loan.channel_id
    );
    update public.loans set opening_journal_entry_id = v_entry where id = p_loan_id;
    return v_entry;
  end if;

  -- What was still owed: the amount granted less the capital of the cuotas
  -- due before the date.
  select coalesce(v_loan.original_amount, v_loan.principal)
         - coalesce(sum(coalesce(i.capital_amount, i.amount)), 0)
    into v_owed
    from public.loan_installments i
   where i.loan_id = p_loan_id and i.due_date < p_date;
  if v_owed <= 0 then
    raise exception 'El préstamo no tenía capital adeudado a esa fecha'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select a.id into v_equity
    from public.chart_of_accounts a
   where a.code = '3.2.1' and a.is_active;
  if v_equity is null then
    raise exception 'No hay una cuenta activa 3.2.1 Resultados no asignados en el plan de cuentas'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  v_desc := 'Deuda de apertura — ' || v_loan.description
    || coalesce(' ' || v_loan.loan_number, '');
  v_entry := public.create_journal_entry(
    p_date,
    to_char(p_date, 'YYYY-MM'),
    v_desc,
    jsonb_build_array(
      jsonb_build_object('account_id', v_equity, 'debit', v_owed, 'description', v_desc),
      jsonb_build_object('system_role', 'prestamos', 'credit', v_owed, 'description', v_desc)
    ),
    'loans',
    p_loan_id,
    v_loan.channel_id
  );
  update public.loans set opening_journal_entry_id = v_entry where id = p_loan_id;
  return v_entry;
end;
$$;

revoke all on function public.book_loan_opening(uuid, date) from public, anon;
grant execute on function public.book_loan_opening(uuid, date) to authenticated;
