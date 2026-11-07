SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A loan as the bank shows it.
--
-- 1. loans: the bank's loan number, the account its cuotas are debited from,
--    the date it was granted, the amount granted and its rates (TNA, TEA,
--    CFT). All optional: loans loaded before keep working.
-- 2. loan_installments.paid_outside: a cuota already paid before the loan
--    was loaded (a loan in course). It is «pagada» with no movement in Caja
--    and no journal entry: that money left before the system's start.
--    Only create_loan_core writes it, at creation.
-- 3. create_loan_core takes the new loan fields and, per cuota, its split
--    and whether it was paid before; the import keeps sending the old shape.
-- 4. guard_loan_installment_payment lets create_loan_core insert such a
--    cuota; guard_loan lets a loan whose only paid cuotas were paid before
--    be cancelled or have its terms fixed (nothing of it is in Caja).

alter table public.loans
  add column loan_number text,
  add column account_id uuid references public.accounts (id) on delete restrict,
  add column start_date date,
  add column original_amount numeric(14, 2),
  add column tna numeric(7, 3),
  add column tea numeric(7, 3),
  add column cft numeric(7, 3);

alter table public.loans
  add constraint loans_loan_number_check
    check (loan_number is null or char_length(loan_number) between 1 and 60),
  add constraint loans_original_amount_check
    check (original_amount is null or original_amount > 0),
  add constraint loans_rates_check
    check (
      (tna is null or tna between 0 and 1000)
      and (tea is null or tea between 0 and 1000)
      and (cft is null or cft between 0 and 1000)
    );

create index loans_account_idx on public.loans (account_id)
  where account_id is not null;

alter table public.loan_installments
  add column paid_outside boolean not null default false;

alter table public.loan_installments
  add constraint loan_installments_paid_outside_check
    check (
      not paid_outside
      or (status = 'pagada' and transaction_id is null and paid_date is not null)
    );

create or replace function public.create_loan_core(
  p_loan jsonb,
  p_installments jsonb,
  p_created_by uuid,
  p_import_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan_id uuid;
  v_count   int := (p_loan ->> 'installments_count')::int;
begin
  if p_installments is null
     or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) is distinct from v_count then
    raise exception 'El cronograma no coincide con la cantidad de cuotas del préstamo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  insert into public.loans (
    kind, description, lender, principal, currency, channel_id,
    installments_count, first_due_date, notes, created_by, import_run_id,
    loan_number, account_id, start_date, original_amount, tna, tea, cft
  ) values (
    (p_loan ->> 'kind')::public.loan_kind,
    p_loan ->> 'description',
    p_loan ->> 'lender',
    (p_loan ->> 'principal')::numeric,
    p_loan ->> 'currency',
    p_loan ->> 'channel_id',
    v_count,
    (p_loan ->> 'first_due_date')::date,
    p_loan ->> 'notes',
    p_created_by,
    p_import_run_id,
    p_loan ->> 'loan_number',
    (p_loan ->> 'account_id')::uuid,
    (p_loan ->> 'start_date')::date,
    (p_loan ->> 'original_amount')::numeric,
    (p_loan ->> 'tna')::numeric,
    (p_loan ->> 'tea')::numeric,
    (p_loan ->> 'cft')::numeric
  )
  returning id into v_loan_id;

  insert into public.loan_installments (
    loan_id, number, due_date, amount,
    capital_amount, interest_amount, iva_amount, perception_amount,
    other_charges_amount,
    status, paid_date, paid_amount, paid_outside
  )
  select v_loan_id, i.number, i.due_date, i.amount,
         i.capital, i.interest, i.iva, i.perception, i.other,
         case when coalesce(i.paid_outside, false)
              then 'pagada'::public.loan_installment_status
              else 'pendiente'::public.loan_installment_status end,
         case when coalesce(i.paid_outside, false) then i.due_date end,
         case when coalesce(i.paid_outside, false) then i.amount end,
         coalesce(i.paid_outside, false)
    from jsonb_to_recordset(p_installments) as i(
           number integer, due_date date, amount numeric,
           capital numeric, interest numeric, iva numeric,
           perception numeric, other numeric, paid_outside boolean
         );

  return v_loan_id;
end;
$$;

revoke all on function public.create_loan_core(jsonb, jsonb, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.guard_loan_installment_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if (old.status <> 'pendiente'
        or old.paid_date is not null
        or old.paid_amount is not null
        or old.transaction_id is not null)
       and not old.paid_outside then
      raise exception 'No se puede borrar una cuota pagada: su pago queda en Caja y en el libro diario'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.paid_outside then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?create_loan_core\(' then
        raise exception 'Una cuota pagada antes de cargar el préstamo se marca solo al crearlo'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
      return new;
    end if;
    if new.status <> 'pendiente'
       or new.paid_date is not null
       or new.paid_amount is not null
       or new.transaction_id is not null then
      raise exception 'Una cuota se carga pendiente: se paga después con «Pagar» o «Usar un egreso ya cargado»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if new.loan_id is distinct from old.loan_id then
    raise exception 'Una cuota no se pasa a otro préstamo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.paid_outside is distinct from old.paid_outside then
    raise exception 'Si una cuota se pagó antes de cargar el préstamo se decide solo al crearlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.number is distinct from old.number
     and (old.status <> 'pendiente'
          or old.paid_date is not null
          or old.paid_amount is not null
          or old.transaction_id is not null) then
    raise exception 'No se puede cambiar el número de una cuota pagada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status         is not distinct from old.status
     and new.paid_date      is not distinct from old.paid_date
     and new.paid_amount    is not distinct from old.paid_amount
     and new.transaction_id is not distinct from old.transaction_id then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;
  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?(pay_loan_installment|adopt_loan_installment_payment)\(' then
    return new;
  end if;
  raise exception 'El estado, la fecha y el importe pagados y el movimiento de una cuota se cambian solo pagándola («Pagar» o «Usar un egreso ya cargado»)'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_loan_installment_payment()
  from public, anon, authenticated;

create or replace function public.guard_loan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.disbursement_transaction_id is not null then
      raise exception 'El desembolso de un préstamo se registra solo con «Registrar desembolso»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if new.import_run_id is not null then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?commit_import_run\(' then
        raise exception 'Un préstamo queda marcado como importado solo al importarlo desde «Importar datos»'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.import_run_id is distinct from old.import_run_id then
    raise exception 'La importación de la que viene un préstamo no se cambia'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE'
     and old.disbursement_transaction_id is not null
     and new.disbursement_transaction_id is distinct from old.disbursement_transaction_id then
    raise exception 'El desembolso registrado de un préstamo no se puede cambiar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE'
     and old.disbursement_transaction_id is null
     and new.disbursement_transaction_id is not null then
    get diagnostics v_stack = pg_context;
    if v_stack !~ 'function (public\.)?record_loan_disbursement\(' then
      raise exception 'El desembolso de un préstamo se registra solo con «Registrar desembolso»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;

  -- A cuota paid before the loan was loaded left no movement: it does not
  -- hold the loan back.
  if (tg_op = 'DELETE'
      or (new.status = 'cancelled' and old.status is distinct from 'cancelled'))
     and (old.disbursement_transaction_id is not null
          or exists (select 1 from public.loan_installments i
                      where i.loan_id = old.id
                        and i.status = 'pagada'
                        and not i.paid_outside)) then
    raise exception 'No se puede anular el préstamo: tiene el desembolso registrado o cuotas pagadas, y sus movimientos quedarían en Caja y en el libro diario. Anulalo solo si se cargó por error y todavía no registró dinero.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if (new.principal   is distinct from old.principal
      or new.currency   is distinct from old.currency
      or new.channel_id is distinct from old.channel_id)
     and (old.disbursement_transaction_id is not null
          or old.import_run_id is not null
          or exists (select 1 from public.loan_installments i
                      where i.loan_id = old.id
                        and i.status = 'pagada'
                        and not i.paid_outside)) then
    raise exception 'El capital, la moneda y el canal de un préstamo no cambian una vez registrado su desembolso o pagada una cuota'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'cancelled') then
    get diagnostics v_stack = pg_context;
    if not (old.status = 'active' and new.status = 'paid'
            and v_stack ~ 'function (public\.)?(pay_loan_installment|adopt_loan_installment_payment)\(') then
      raise exception 'Un préstamo queda pagado solo al pagar su última cuota, y anulado solo con «Anular»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_loan()
  from public, anon, authenticated;
