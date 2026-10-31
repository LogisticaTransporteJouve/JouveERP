SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Audit 2026-10-31, Módulos (M): fleet documents get a file, a trip's revenue
-- comes from its invoiced shipments, and vacations follow LCT art. 151-153.
-- Expand-only: one nullable column, one view, two helper functions, and
-- replacements that keep every existing signature except the return columns
-- of ai_fleet_margin (same parameters, two more columns).
--
-- 1. fleet_documents.attachment_file_id, like employee_documents: a file
--    readable only by the fleet_documents:read roles (owner/admin/operations),
--    listed in v_files_hub and kept by the orphan sweep and the chat-draft
--    delete.
-- 2. v_trip_revenue: a trip with non-cancelled shipments earns the freight of
--    the invoiced ones (shipments.invoice_id, cleared when the invoice is
--    cancelled); a trip without shipments keeps its manual trips.revenue.
--    ai_fleet_margin reads it and also returns the invoiced and the manual
--    figure. trips.revenue stays.
-- 3. grant_vacation_balances: an employee who did not work at least half of
--    the calendar year's working days (art. 151) gets one day per 20 days of
--    effective work (art. 153) instead of the "hired after July 1" cut over
--    calendar days. Working days are Monday to Friday minus holidays; the
--    attendance model stores only exceptions, so a day without a row is a day
--    worked, and only an unjustified absence is not: leaves, sickness and
--    justified absences count as worked (art. 152). Carry-over rules unchanged.

------------------------------------------------------------------------------
-- 1. Fleet document files
------------------------------------------------------------------------------

-- New, all-NULL column: the FK check has nothing to scan.
alter table public.fleet_documents
  -- squawk-ignore adding-foreign-key-constraint
  add column attachment_file_id uuid references public.files (id) on delete set null;

comment on column public.fleet_documents.attachment_file_id is
  'Scanned document (files). Readable only by owner/admin/operations.';

-- fleet_documents is small (one row per vehicle/driver paper).
-- squawk-ignore require-concurrent-index-creation
create index fleet_documents_attachment_file_idx
  on public.fleet_documents (attachment_file_id)
  where attachment_file_id is not null;

-- True when a fleet document points at the file. SECURITY DEFINER so the
-- files policy can ask without the caller seeing fleet_documents.
create function public.is_fleet_document_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fleet_documents d where d.attachment_file_id = p_file_id
  );
$$;

revoke all on function public.is_fleet_document_file(uuid) from public, anon, authenticated;
grant execute on function public.is_fleet_document_file(uuid) to authenticated;

-- files:read roles: owner, admin, finance, operations, warehouse.
-- hr:read: owner, admin, finance. fleet_documents:read: owner, admin, operations.
drop policy if exists "Roles with files:read can view files" on public.files;
create policy "Roles with files:read can view files"
  on public.files for select to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source <> 'chat_attachment'
      or uploaded_by = (select auth.uid())
      or (select public.user_has_role(array['owner', 'admin']))
    )
    and (
      (select public.user_has_role(array['owner', 'admin', 'finance']))
      or not public.is_employee_document_file(id)
    )
    and (
      (select public.user_has_role(array['owner', 'admin', 'operations']))
      or not public.is_fleet_document_file(id)
    )
  );

create or replace view public.v_files_hub
with (security_invoker = on) as
  select
    fa.id                  as link_id,
    case
      when fa.purchase_invoice_id is not null then 'purchase_invoice'
      when fa.invoice_id          is not null then 'invoice'
      when fa.receipt_id          is not null then 'receipt'
      when fa.payment_order_id    is not null then 'payment_order'
      when fa.check_id            is not null then 'check'
      when fa.issued_check_id     is not null then 'issued_check'
      when fa.client_id           is not null then 'client'
      when fa.supplier_id         is not null then 'supplier'
      when fa.transaction_id      is not null then 'transaction'
      when fa.ai_chat_message_id  is not null then 'ai_chat_message'
    end                    as entity_type,
    coalesce(
      fa.purchase_invoice_id, fa.invoice_id, fa.receipt_id, fa.payment_order_id,
      fa.check_id, fa.issued_check_id, fa.client_id, fa.supplier_id,
      fa.transaction_id, fa.ai_chat_message_id
    )                      as entity_id,
    m.session_id           as parent_id,
    s.user_id              as owner_id,
    fa.kind,
    fa.created_at          as linked_at,
    f.id                   as file_id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at           as uploaded_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as uploader_name
  from public.file_attachments fa
  join public.files f on f.id = fa.file_id
  left join public.ai_chat_messages m on m.id = fa.ai_chat_message_id
  left join public.ai_chat_sessions s on s.id = m.session_id
  left join public.user_profiles p on p.user_id = f.uploaded_by
  union all
  select
    e.id,
    'ai_document',
    e.id,
    null::uuid,
    e.created_by,
    coalesce(e.detected_type, 'other'),
    e.created_at,
    f.id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.ai_document_extractions e
  join public.files f on f.id = e.file_id
  left join public.user_profiles p on p.user_id = f.uploaded_by
  union all
  select
    d.id,
    'employee_document',
    d.id,
    d.employee_id,
    null::uuid,
    d.kind::text,
    d.created_at,
    f.id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.employee_documents d
  join public.files f on f.id = d.attachment_file_id
  left join public.user_profiles p on p.user_id = f.uploaded_by
  union all
  select
    d.id,
    'fleet_document',
    d.id,
    coalesce(d.vehicle_id, d.driver_id),
    null::uuid,
    d.kind,
    d.created_at,
    f.id,
    f.original_filename,
    f.mime_type,
    f.file_size,
    f.uploaded_by,
    f.created_at,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.fleet_documents d
  join public.files f on f.id = d.attachment_file_id
  left join public.user_profiles p on p.user_id = f.uploaded_by;

comment on view public.v_files_hub is
  'Una fila por (archivo, entidad dueña): adjuntos, documentos de IA, de empleados y de flota. SECURITY INVOKER: aplica la RLS de cada tabla.';

revoke all on table public.v_files_hub from public, anon, authenticated;
grant select on table public.v_files_hub to authenticated;

create or replace function public.find_orphan_files(
  p_max_age interval default '1 hour'
)
returns table (
  id          uuid,
  bucket      text,
  bucket_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.bucket, f.bucket_path
  from public.files f
  left join public.file_attachments fa on fa.file_id = f.id
  where fa.id is null
    and f.created_at < now() - case
      when f.source = 'chat_attachment' then greatest(p_max_age, interval '24 hours')
      else p_max_age
    end
    and not exists (
      select 1 from public.ai_document_extractions e where e.file_id = f.id
    )
    and not exists (
      select 1 from public.employee_documents d where d.attachment_file_id = f.id
    )
    and not exists (
      select 1 from public.fleet_documents d where d.attachment_file_id = f.id
    );
$$;

revoke all on function public.find_orphan_files(interval) from public, anon, authenticated;
grant execute on function public.find_orphan_files(interval) to service_role;

create or replace function public.delete_chat_draft_file(
  p_file_id uuid,
  p_user_id uuid
)
returns table (bucket text, bucket_path text)
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.files f
  where f.id = p_file_id
    and f.uploaded_by = p_user_id
    and f.source = 'chat_attachment'
    and not exists (select 1 from public.file_attachments fa where fa.file_id = f.id)
    and not exists (select 1 from public.ai_document_extractions e where e.file_id = f.id)
    and not exists (select 1 from public.employee_documents d where d.attachment_file_id = f.id)
    and not exists (select 1 from public.fleet_documents d where d.attachment_file_id = f.id)
  returning f.bucket, f.bucket_path;
$$;

revoke all on function public.delete_chat_draft_file(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_chat_draft_file(uuid, uuid) to service_role;

------------------------------------------------------------------------------
-- 2. Trip revenue from invoiced shipments
------------------------------------------------------------------------------

create view public.v_trip_revenue
with (security_invoker = on) as
  select
    t.id         as trip_id,
    t.trip_date,
    t.revenue    as manual_revenue,
    coalesce(s.shipments, 0)::integer as shipments,
    coalesce(s.invoiced, 0)::numeric(14, 2) as invoiced_revenue,
    coalesce(s.uninvoiced, 0)::numeric(14, 2) as uninvoiced_freight,
    (case
       when coalesce(s.shipments, 0) > 0 then coalesce(s.invoiced, 0)
       else coalesce(t.revenue, 0)
     end)::numeric(14, 2) as revenue,
    case when coalesce(s.shipments, 0) > 0 then 'invoiced' else 'manual' end as revenue_source
  from public.trips t
  left join lateral (
    select
      count(*) as shipments,
      sum(coalesce(sh.freight_amount, 0)) filter (where sh.invoice_id is not null) as invoiced,
      sum(coalesce(sh.freight_amount, 0)) filter (where sh.invoice_id is null) as uninvoiced
    from public.shipments sh
    where sh.trip_id = t.id
      and sh.status <> 'cancelled'
  ) s on true;

comment on view public.v_trip_revenue is
  'Ingreso de cada viaje para rentabilidad: flete de sus cargas facturadas (no canceladas); sin cargas, el ingreso manual trips.revenue. SECURITY INVOKER.';

revoke all on table public.v_trip_revenue from public, anon, authenticated;
grant select on table public.v_trip_revenue to authenticated;

-- The return type gains invoiced_revenue and manual_revenue: drop + create of
-- the single version, same parameters, so callers resolve as before.
-- squawk-ignore ban-drop-function
drop function public.ai_fleet_margin(date, date, text, integer, boolean);

-- Margin over [p_from, p_to] grouped by trip, driver, vehicle or client, with
-- the same imputation as the fleet profitability report: a trip carries its
-- revenue (v_trip_revenue), its cost and the fuel loads tied to it; a vehicle
-- also carries every fuel load and maintenance record in the range.
-- invoiced_revenue is the invoiced freight and manual_revenue the trip's own
-- revenue figure, side by side; revenue is the one the margin uses. By client,
-- each shipment carries its own invoiced freight, a trip without shipments
-- goes to 'none', and costs and manual revenue split by freight share (equal
-- split when no freight is set). Window totals cover every group, not only the
-- returned page. With p_is_fiscal set, only trips of that scope count (their
-- shipments and tied fuel loads follow the trip); fuel loads without a trip
-- and maintenance carry no channel, so they only count under "Todos".
create function public.ai_fleet_margin(
  p_from date,
  p_to date,
  p_group_by text default 'vehicle',
  p_limit integer default 50,
  p_is_fiscal boolean default null
)
returns table(
  group_key text,
  label text,
  trips integer,
  revenue numeric,
  invoiced_revenue numeric,
  manual_revenue numeric,
  trip_cost numeric,
  fuel_cost numeric,
  maintenance_cost numeric,
  net numeric,
  margin_pct numeric,
  total_groups integer,
  total_revenue numeric,
  total_net numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with trips_in as (
    select
      tr.id,
      tr.trip_date,
      tr.vehicle_id,
      tr.driver_id,
      tr.origin,
      tr.destination,
      r.revenue::numeric as revenue,
      r.invoiced_revenue::numeric as invoiced_revenue,
      coalesce(r.manual_revenue, 0)::numeric as manual_revenue,
      r.revenue_source,
      coalesce(tr.cost, 0)::numeric as trip_cost
    from public.trips tr
    join public.v_trip_revenue r on r.trip_id = tr.id
    where tr.trip_date between p_from and p_to
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = tr.channel_id and c.is_fiscal = p_is_fiscal
      ))
  ),
  fuel_in as (
    select fl.vehicle_id, fl.trip_id, fl.amount
    from public.fuel_loads fl
    where fl.load_date between p_from and p_to
      and (p_is_fiscal is null or fl.trip_id in (select trips_in.id from trips_in))
  ),
  trip_rows as (
    select t.*, coalesce(tf.amount, 0)::numeric as fuel_cost
    from trips_in t
    left join (
      select fuel_in.trip_id, sum(fuel_in.amount) as amount
      from fuel_in
      where fuel_in.trip_id is not null
      group by fuel_in.trip_id
    ) tf on tf.trip_id = t.id
  ),
  ship as (
    select
      s.trip_id,
      s.client_id,
      coalesce(s.freight_amount, 0)::numeric as freight,
      case when s.invoice_id is not null then coalesce(s.freight_amount, 0) else 0 end::numeric as invoiced,
      sum(coalesce(s.freight_amount, 0)) over (partition by s.trip_id) as trip_freight,
      count(*) over (partition by s.trip_id) as trip_shipments
    from public.shipments s
    where s.trip_id in (select trips_in.id from trips_in)
      and s.status <> 'cancelled'
  ),
  grouped as (
    select
      tr.id::text as k,
      to_char(tr.trip_date, 'YYYY-MM-DD') || ' ' || coalesce(tr.origin, '?') || ' → ' || coalesce(tr.destination, '?') as lbl,
      1 as n_trips,
      tr.revenue as rev,
      tr.invoiced_revenue as inv,
      tr.manual_revenue as man,
      tr.trip_cost as tcost,
      tr.fuel_cost as fcost,
      0::numeric as mcost
    from trip_rows tr
    where p_group_by = 'trip'
    union all
    select
      coalesce(tr.driver_id::text, 'none'),
      coalesce(d.full_name, 'Sin chofer'),
      count(*)::integer,
      sum(tr.revenue),
      sum(tr.invoiced_revenue),
      sum(tr.manual_revenue),
      sum(tr.trip_cost),
      sum(tr.fuel_cost),
      0::numeric
    from trip_rows tr
    left join public.drivers d on d.id = tr.driver_id
    where p_group_by = 'driver'
    group by 1, 2
    union all
    select
      v.id::text,
      v.patente,
      coalesce(tv.n, 0)::integer,
      coalesce(tv.revenue, 0),
      coalesce(tv.invoiced_revenue, 0),
      coalesce(tv.manual_revenue, 0),
      coalesce(tv.trip_cost, 0),
      coalesce(vf.amount, 0),
      coalesce(mt.cost, 0)
    from public.vehicles v
    left join (
      select
        trip_rows.vehicle_id,
        count(*) as n,
        sum(trip_rows.revenue) as revenue,
        sum(trip_rows.invoiced_revenue) as invoiced_revenue,
        sum(trip_rows.manual_revenue) as manual_revenue,
        sum(trip_rows.trip_cost) as trip_cost
      from trip_rows
      group by trip_rows.vehicle_id
    ) tv on tv.vehicle_id = v.id
    left join (
      select fuel_in.vehicle_id, sum(fuel_in.amount) as amount
      from fuel_in
      group by fuel_in.vehicle_id
    ) vf on vf.vehicle_id = v.id
    left join (
      select m.vehicle_id, sum(coalesce(m.cost, 0)) as cost
      from public.maintenance_records m
      where m.service_date between p_from and p_to
        and p_is_fiscal is null
      group by m.vehicle_id
    ) mt on mt.vehicle_id = v.id
    where p_group_by = 'vehicle'
      and (tv.vehicle_id is not null or vf.vehicle_id is not null or mt.vehicle_id is not null)
    union all
    select
      coalesce(a.client_id::text, 'none'),
      coalesce(c.legal_name, 'Sin cliente asignado'),
      count(distinct a.id)::integer,
      sum(case when a.revenue_source = 'invoiced' then a.invoiced else a.revenue * a.share end),
      sum(a.invoiced),
      sum(a.manual_revenue * a.share),
      sum(a.trip_cost * a.share),
      sum(a.fuel_cost * a.share),
      0::numeric
    from (
      select
        tr.id,
        tr.revenue,
        tr.revenue_source,
        tr.manual_revenue,
        tr.trip_cost,
        tr.fuel_cost,
        sh.client_id,
        coalesce(sh.invoiced, 0) as invoiced,
        case
          when sh.trip_id is null then 1::numeric
          when sh.trip_freight > 0 then sh.freight / sh.trip_freight
          else 1::numeric / sh.trip_shipments
        end as share
      from trip_rows tr
      left join ship sh on sh.trip_id = tr.id
    ) a
    left join public.clients c on c.id = a.client_id
    where p_group_by = 'client'
    group by 1, 2
  )
  select
    g.k,
    g.lbl,
    g.n_trips::integer,
    round(g.rev, 2),
    round(g.inv, 2),
    round(g.man, 2),
    round(g.tcost, 2),
    round(g.fcost, 2),
    round(g.mcost, 2),
    round(g.rev - g.tcost - g.fcost - g.mcost, 2),
    case when g.rev <> 0 then round((g.rev - g.tcost - g.fcost - g.mcost) / g.rev * 100, 1) end,
    (count(*) over ())::integer,
    round(sum(g.rev) over (), 2),
    round(sum(g.rev - g.tcost - g.fcost - g.mcost) over (), 2)
  from grouped g
  order by 10 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.ai_fleet_margin(date, date, text, integer, boolean) from public, anon;
grant execute on function public.ai_fleet_margin(date, date, text, integer, boolean) to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. Vacations: LCT art. 151-153
------------------------------------------------------------------------------

-- Working days (Monday to Friday, not a holiday) of p_year: in the whole
-- calendar year, in the part the employee was employed, and of those the ones
-- without an unjustified absence. Days still to come count as worked, as the
-- attendance model does for any day without a row.
create function public.vacation_work_days(p_employee_id uuid, p_year integer)
returns table (
  year_work_days integer,
  employee_work_days integer,
  effective_work_days integer
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select
      make_date(p_year, 1, 1) as y0,
      make_date(p_year, 12, 31) as y1,
      greatest(make_date(p_year, 1, 1), e.hire_date) as e0,
      least(make_date(p_year, 12, 31), coalesce(e.termination_date, make_date(p_year, 12, 31))) as e1
    from public.employees e
    where e.id = p_employee_id
  ),
  work_days as (
    select b.y0 + i as day, b.e0, b.e1
    from bounds b
    cross join generate_series(0, b.y1 - b.y0) as i
    where extract(isodow from b.y0 + i) < 6
      and not exists (select 1 from public.holidays h where h.date = b.y0 + i)
  )
  select
    count(*)::integer,
    (count(*) filter (where w.day between w.e0 and w.e1))::integer,
    (count(*) filter (
      where w.day between w.e0 and w.e1
        and not exists (
          select 1 from public.attendance_records a
          where a.employee_id = p_employee_id
            and a.date = w.day
            and a.kind = 'absent_unjustified'
        )
    ))::integer
  from work_days w;
$$;

revoke all on function public.vacation_work_days(uuid, integer) from public, anon, authenticated;

create or replace function public.grant_vacation_balances(
  p_target_year int default extract(year from now())::int,
  p_carryover boolean default true
)
returns table (employee_id uuid, balance_id uuid, entitled_days int, carryover_days int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_emp        record;
  v_days       record;
  v_anios      int;
  v_entitled   int;
  v_source     record;
  v_carry      int;
  v_balance_id uuid;
  v_carry_on   boolean;
  v_granted_at date := make_date(p_target_year, 10, 1);
  v_expires_at date := make_date(p_target_year + 1, 4, 30);
  v_dec31      date := make_date(p_target_year, 12, 31);
begin
  -- The service-role cron and authenticated owner/admin (the HR admin action).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin']) then
    raise exception 'No autorizado para otorgar balances de vacaciones'
      using errcode = '42501';
  end if;

  v_carry_on := coalesce(p_carryover, false) and coalesce((
    select s.value = 'true'::jsonb from public.hr_settings s
     where s.key = 'vacation_carryover'
  ), false);

  update public.employee_vacation_balances
     set status = 'expired'
   where status = 'active'
     and expires_at < current_date;

  for v_emp in
    select id, hire_date
    from public.employees
    where is_active = true
  loop
    if exists (
      select 1 from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year
    ) then
      continue;
    end if;

    v_anios := extract(year from age(v_dec31, v_emp.hire_date))::int;
    select * into v_days from public.vacation_work_days(v_emp.id, p_target_year);

    -- Art. 151: half of the year's working days earns the full period;
    -- below that, art. 153: one day per 20 days of effective work.
    if v_days.effective_work_days * 2 < v_days.year_work_days then
      v_entitled := v_days.effective_work_days / 20;
    elsif v_anios < 5 then
      v_entitled := 14;
    elsif v_anios < 10 then
      v_entitled := 21;
    elsif v_anios < 20 then
      v_entitled := 28;
    else
      v_entitled := 35;
    end if;

    v_carry := 0;
    if v_carry_on then
      select b.id,
             b.entitled_days,
             (b.entitled_days + b.bonus_days + b.carryover_days - b.used_days) as remaining
        into v_source
      from public.employee_vacation_balances b
      where b.employee_id = v_emp.id
        and b.period_year = p_target_year - 1
        and (b.status = 'extended'
             or (b.status = 'active' and b.expires_at >= v_granted_at))
      for update;

      if found and v_source.remaining > 0 then
        v_carry := least(v_source.remaining, v_source.entitled_days / 3);
        update public.employee_vacation_balances
           set status = 'expired',
               notes  = concat_ws(' · ', nullif(notes, ''),
                          format('%s días arrastrados a %s', v_carry, p_target_year))
         where id = v_source.id;
      end if;
    end if;

    insert into public.employee_vacation_balances (
      employee_id, period_year, entitled_days, carryover_days,
      granted_at, expires_at, status, created_by
    )
    values (
      v_emp.id, p_target_year, v_entitled, v_carry,
      v_granted_at, v_expires_at, 'active', auth.uid()
    )
    returning id into v_balance_id;

    employee_id    := v_emp.id;
    balance_id     := v_balance_id;
    entitled_days  := v_entitled;
    carryover_days := v_carry;
    return next;
  end loop;
end;
$$;

-- The HR admin action calls it with the user's session; the body checks the role.
revoke all on function public.grant_vacation_balances(int, boolean) from public, anon, authenticated;
grant execute on function public.grant_vacation_balances(int, boolean) to authenticated, service_role;
