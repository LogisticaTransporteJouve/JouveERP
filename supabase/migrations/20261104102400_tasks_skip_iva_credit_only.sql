SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- W1 · S3 #19: an IVA document that only carries a saldo a favor técnico
-- (credit_balance set, no amount: 20261104050300 keeps such a month
-- pendiente) no longer opens a "Pagar IVA" task; the next sync closes an
-- open one (auto_closed). Same signature and result; everything else is as
-- in 20261103170000.
--
-- Rollback: older code calls the same function; older SQL opens the task
-- again.

create or replace function public.sync_automatic_tasks(p_today date)
returns table (task_id uuid, kind text, change text)
language sql
volatile
security invoker
set search_path = ''
as $$
  with desired as (
    select
      'purchase_invoices'::text as source_table,
      d.purchase_invoice_id as source_id,
      'supplier_payment'::text as kind,
      format('Pagar a %s: %s', s.legal_name, concat_ws(' ',
        case d.kind when 'nd' then 'ND' else 'Factura' end,
        d.letter,
        lpad(d.punto_venta::text, 4, '0') || '-' || lpad(d.numero::text, 8, '0'))) as title,
      coalesce(d.fch_vto_pago, d.fecha) as due_date
    from public.v_supplier_aging_documents d
    join public.suppliers s on s.id = d.supplier_id
    where coalesce(d.fch_vto_pago, d.fecha) <= p_today + 7

    union all

    select
      'invoices',
      d.invoice_id,
      'collection',
      format('Cobrar a %s: %s', c.legal_name, concat_ws(' ',
        case d.kind when 'nd' then 'ND' else 'Factura' end,
        d.letter,
        lpad(d.punto_venta::text, 4, '0') || '-' || coalesce(lpad(d.numero::text, 8, '0'), 's/n'))),
      coalesce(d.fch_vto_pago, d.fecha)
    from public.v_aging_documents d
    join public.clients c on c.id = d.client_id
    where d.document_type = 'invoice'
      and coalesce(d.fch_vto_pago, d.fecha) < p_today

    union all

    select
      'loan_installments',
      li.id,
      'loan_installment',
      format('Pagar cuota %s de %s', li.number, l.description),
      li.due_date
    from public.loan_installments li
    join public.loans l on l.id = li.loan_id
    where li.status = 'pendiente'
      and l.status = 'active'
      and li.due_date <= p_today + 7

    union all

    select
      'issued_checks',
      ic.id,
      'issued_check',
      format('Cubrir cheque propio N° %s (%s)', ic.check_number, ic.bank_name),
      ic.due_date
    from public.issued_checks ic
    where ic.status = 'emitted'
      and ic.due_date <= p_today + 7

    union all

    select
      'fleet_documents',
      fd.id,
      'fleet_document',
      format('Renovar %s de %s', replace(fd.kind, '_', ' '), coalesce(v.patente, dr.full_name)),
      fd.expires_at
    from public.fleet_documents fd
    left join public.vehicles v on v.id = fd.vehicle_id
    left join public.drivers dr on dr.id = fd.driver_id
    where fd.expires_at <= p_today + 30
      and coalesce(v.is_active, dr.is_active, false)
      and not exists (
        select 1 from public.fleet_documents n
         where n.id <> fd.id
           and n.kind = fd.kind
           and n.vehicle_id is not distinct from fd.vehicle_id
           and n.driver_id is not distinct from fd.driver_id
           and n.expires_at > p_today + 30
      )

    union all

    select
      'employee_documents',
      ed.id,
      'employee_document',
      format('Renovar %s de %s', replace(ed.kind::text, '_', ' '), e.legal_name),
      ed.expires_at
    from public.employee_documents ed
    join public.employees e on e.id = ed.employee_id
    where ed.expires_at <= p_today + 30
      and e.is_active
      and not exists (
        select 1 from public.employee_documents n
         where n.id <> ed.id
           and n.employee_id = ed.employee_id
           and n.kind = ed.kind
           and n.expires_at > p_today + 30
      )

    union all

    select
      'vehicle_km_readings',
      md5('vehicle_km:' || m.period)::uuid,
      'vehicle_km',
      format('Cargar km de %s %s',
        (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])
          [extract(month from p_today)::int],
        extract(year from p_today)::int),
      make_date(extract(year from p_today)::int, extract(month from p_today)::int, 5)
    from (select to_char(p_today, 'YYYY-MM') as period) m
    where exists (
      select 1 from public.vehicles v
       where v.is_active
         and v.vehicle_type not in ('acoplado', 'semi')
         and not exists (
           select 1 from public.vehicle_km_readings r
            where r.vehicle_id = v.id
              and r.period = m.period
         )
    )

    union all

    select
      'tax_documents',
      td.id,
      'tax_document',
      format('Pagar %s del período %s',
        public.tax_document_label(td.kind, td.title, td.jurisdiction),
        to_char(to_date(td.period, 'YYYY-MM'), 'MM/YYYY')),
      td.due_date
    from public.tax_documents td
    where td.status in ('pendiente', 'liquidado')
      and td.due_date <= p_today + 7
      -- A month whose IVA DDJJ only leaves a saldo a favor has nothing to pay.
      and not (td.amount is null and td.credit_balance is not null)
  ),
  upserted as (
    insert into public.tasks as t (title, due_date, origin, kind, source_table, source_id)
    select d.title, d.due_date, 'automatic', d.kind, d.source_table, d.source_id
      from desired d
    on conflict (source_table, source_id, kind) do update
      set title = excluded.title,
          due_date = case when t.due_date_locked then t.due_date else excluded.due_date end,
          notified_stage = case
            when t.due_date_locked or t.due_date = excluded.due_date then t.notified_stage
          end,
          status = case when t.auto_closed then 'open' else t.status end,
          completed_at = case when t.auto_closed then null else t.completed_at end,
          auto_closed = false
      where t.title is distinct from excluded.title
         or (not t.due_date_locked and t.due_date is distinct from excluded.due_date)
         or t.auto_closed
    returning t.id, t.kind, (t.xmax = 0) as inserted
  ),
  closed as (
    update public.tasks t
       set status = 'done',
           completed_at = now(),
           completed_by = null,
           auto_closed = true
     where t.origin = 'automatic'
       and t.status = 'open'
       and not exists (
         select 1 from desired d
          where d.source_table = t.source_table
            and d.source_id = t.source_id
            and d.kind = t.kind
       )
    returning t.id, t.kind
  )
  select u.id, u.kind, case when u.inserted then 'created' else 'updated' end
    from upserted u
  union all
  select c.id, c.kind, 'closed'
    from closed c;
$$;

comment on function public.sync_automatic_tasks(date) is
  'Crea, actualiza y cierra las tareas automáticas según los documentos pendientes al día p_today (cron tasks-daily). Idempotente.';

revoke all on function public.sync_automatic_tasks(date) from public, anon, authenticated;
grant execute on function public.sync_automatic_tasks(date) to service_role;
