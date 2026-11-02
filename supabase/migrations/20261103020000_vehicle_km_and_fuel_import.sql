SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 1.6 (km mensual por camión) + 1.7 (importación de combustible y
-- foto del ticket). Expand-only: one table, two nullable columns, and
-- replacements that keep every signature and every existing source.
--
-- 1. vehicle_km_readings: one odometer reading per vehicle and month
--    (period 'YYYY-MM'). fleet_km:read / fleet_km:write (lib/auth/
--    permissions.ts): owner, admin, operations. A reading lower than the
--    previous month's is allowed (a replaced odometer) and the screen warns.
-- 2. Tareas: sync_automatic_tasks gains the source ('vehicle_km_readings',
--    'vehicle_km'): one task per month, "Cargar km de <mes>", due on day 5,
--    open while an active motor vehicle (not an acoplado or semi) has no
--    reading for the month of p_today, closed by the sync once every one
--    has it. Its source_id is md5('vehicle_km:' || period)::uuid, so the
--    month is the document. A month that ends with readings missing closes
--    its task on the next month's first run; the screen still shows the gap.
--    The task's row follows the fleet ceiling (owner/admin/operations) like
--    fleet documents. Every other source is unchanged.
-- 3. vehicles.fuel_card: the fuel card number the YPF en Ruta / Axion Card
--    statements carry, so the importer can match a row without a patente.
--    Stored normalized (digits and uppercase letters), unique.
-- 4. file_attachments.fuel_load_id: the ticket / remito of a fuel load, as
--    any other attachable entity (files-patterns.md §11). v_files_hub lists
--    it; the orphan sweep already keeps every file with a link.

------------------------------------------------------------------------------
-- 1. vehicle_km_readings
------------------------------------------------------------------------------

create table public.vehicle_km_readings (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  period     text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  km         numeric(10, 1) not null check (km >= 0),
  read_on    date not null,
  loaded_by  uuid references auth.users (id) on delete set null,
  notes      text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_km_readings_vehicle_period_unique unique (vehicle_id, period)
);

comment on table public.vehicle_km_readings is
  'Km del odómetro de cada vehículo, uno por mes (period YYYY-MM). Lo carga un administrativo; la tarea automática vehicle_km lo recuerda.';

create index vehicle_km_readings_period_idx on public.vehicle_km_readings (period);
create index vehicle_km_readings_loaded_by_idx on public.vehicle_km_readings (loaded_by);

create trigger vehicle_km_readings_set_updated_at
  before update on public.vehicle_km_readings
  for each row execute function public.set_updated_at();

-- fleet_km:read / fleet_km:write roles: owner, admin, operations.
alter table public.vehicle_km_readings enable row level security;

create policy "Fleet roles view km readings" on public.vehicle_km_readings
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'operations'])) );

create policy "Fleet roles load km readings" on public.vehicle_km_readings
  for insert to authenticated
  with check ( (select public.user_has_role(array['owner', 'admin', 'operations'])) );

create policy "Fleet roles edit km readings" on public.vehicle_km_readings
  for update to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'operations'])) )
  with check ( (select public.user_has_role(array['owner', 'admin', 'operations'])) );

create policy "Fleet roles delete km readings" on public.vehicle_km_readings
  for delete to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'operations'])) );

revoke all on table public.vehicle_km_readings from public, anon;

------------------------------------------------------------------------------
-- 2. Tareas: the monthly km reminder
------------------------------------------------------------------------------

-- Every row the old check accepted passes the new, wider one, so it needs no
-- validation scan. Replaced right below.
alter table public.tasks
  -- squawk-ignore ban-drop-constraint
  drop constraint tasks_source_known;

alter table public.tasks
  add constraint tasks_source_known check (
    source_table is null
    or (source_table, kind) in (
      ('purchase_invoices', 'supplier_payment'),
      ('invoices', 'collection'),
      ('loan_installments', 'loan_installment'),
      ('issued_checks', 'issued_check'),
      ('fleet_documents', 'fleet_document'),
      ('employee_documents', 'employee_document'),
      ('vehicle_km_readings', 'vehicle_km')
    )
  ) not valid;

-- Fleet sources (documents, km) reach owner/admin/operations; the money and
-- HR sources owner/admin/finance.
drop policy "Task roles view tasks" on public.tasks;
create policy "Task roles view tasks" on public.tasks
  for select to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source_table is null
      or (source_table in ('fleet_documents', 'vehicle_km_readings')
          and (select public.user_has_role(array['owner', 'admin', 'operations'])))
      or (source_table not in ('fleet_documents', 'vehicle_km_readings')
          and (select public.user_has_role(array['owner', 'admin', 'finance'])))
    )
  );

drop policy "Task roles edit tasks" on public.tasks;
create policy "Task roles edit tasks" on public.tasks
  for update to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source_table is null
      or (source_table in ('fleet_documents', 'vehicle_km_readings')
          and (select public.user_has_role(array['owner', 'admin', 'operations'])))
      or (source_table not in ('fleet_documents', 'vehicle_km_readings')
          and (select public.user_has_role(array['owner', 'admin', 'finance'])))
    )
  )
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source_table is null
      or (source_table in ('fleet_documents', 'vehicle_km_readings')
          and (select public.user_has_role(array['owner', 'admin', 'operations'])))
      or (source_table not in ('fleet_documents', 'vehicle_km_readings')
          and (select public.user_has_role(array['owner', 'admin', 'finance'])))
    )
  );

-- The documents that need action as of p_today (the Argentine day):
--   supplier_payment   a purchase factura/ND with a balance, due within 7 days;
--   collection         a sales factura/ND with a balance, past its due date;
--   loan_installment   a pending installment of an active loan, due within 7 days;
--   issued_check       an own check still emitted, due within 7 days;
--   fleet_document     a document of an active vehicle/driver expiring within
--                      30 days with no later one of its kind past that window;
--   employee_document  the same for an active employee;
--   vehicle_km         the month of p_today while an active motor vehicle
--                      has no km reading for it, due on day 5.
-- Each one is upserted on (source_table, source_id, kind): a new one is
-- created; an existing one gets the document's title and due date (unless a
-- user moved it) and, if the sync had closed it, opens again. An open
-- automatic task whose document left the list is closed (auto_closed). A task
-- a user closed stays closed. Returns every task it touched with the change.

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

------------------------------------------------------------------------------
-- 3. vehicles.fuel_card
------------------------------------------------------------------------------

alter table public.vehicles
  add column fuel_card text check (fuel_card is null or fuel_card ~ '^[0-9A-Z]{4,30}$');

comment on column public.vehicles.fuel_card is
  'Número de la tarjeta de combustible (YPF en Ruta, Axion Card), solo dígitos y letras mayúsculas. El importador de combustible lo usa cuando el resumen no trae la patente.';

-- vehicles is small (one row per truck) and the column is all NULL.
-- squawk-ignore require-concurrent-index-creation
create unique index vehicles_fuel_card_unique
  on public.vehicles (fuel_card)
  where fuel_card is not null;

------------------------------------------------------------------------------
-- 4. file_attachments.fuel_load_id
------------------------------------------------------------------------------

-- New, all-NULL column: the FK check has nothing to scan.
alter table public.file_attachments
  -- squawk-ignore adding-foreign-key-constraint
  add column fuel_load_id uuid references public.fuel_loads (id) on delete cascade;

-- The column is all NULL, so the partial index starts empty.
-- squawk-ignore require-concurrent-index-creation
create index file_attachments_fuel_load_idx
  on public.file_attachments (fuel_load_id)
  where fuel_load_id is not null;

-- Every existing row has fuel_load_id NULL, so it passes the new sum as it
-- passed the old one. Replaced right below.
alter table public.file_attachments
  -- squawk-ignore ban-drop-constraint
  drop constraint file_attachments_exactly_one_target;

alter table public.file_attachments
  add constraint file_attachments_exactly_one_target
  check (
    (purchase_invoice_id is not null)::int
    + (invoice_id is not null)::int
    + (receipt_id is not null)::int
    + (payment_order_id is not null)::int
    + (check_id is not null)::int
    + (issued_check_id is not null)::int
    + (client_id is not null)::int
    + (supplier_id is not null)::int
    + (transaction_id is not null)::int
    + (ai_chat_message_id is not null)::int
    + (fuel_load_id is not null)::int
    = 1
  ) not valid;

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
      when fa.fuel_load_id        is not null then 'fuel_load'
    end                    as entity_type,
    coalesce(
      fa.purchase_invoice_id, fa.invoice_id, fa.receipt_id, fa.payment_order_id,
      fa.check_id, fa.issued_check_id, fa.client_id, fa.supplier_id,
      fa.transaction_id, fa.ai_chat_message_id, fa.fuel_load_id
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
  'Una fila por (archivo, entidad dueña): adjuntos (incluidos los tickets de combustible), documentos de IA, de empleados y de flota. SECURITY INVOKER: aplica la RLS de cada tabla.';

revoke all on table public.v_files_hub from public, anon, authenticated;
grant select on table public.v_files_hub to authenticated;
