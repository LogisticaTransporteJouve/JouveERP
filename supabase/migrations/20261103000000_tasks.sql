SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Tareas (roadmap 1.4 + 1.5, decision D11): shared to-dos with one or more
-- assignees. Three origins:
--   manual     a user creates it ("llamar al cliente X en una semana");
--   recurring  materialized from recurring_tasks (every month on day N);
--   automatic  derived from a document that needs action (a purchase to pay,
--              an overdue sale, a loan installment, an own check, an expiring
--              fleet or employee document), keyed (source_table, source_id,
--              kind) and closed by sync_automatic_tasks once the document is
--              settled.
-- The daily Inngest cron `tasks-daily` calls materialize_recurring_tasks and
-- sync_automatic_tasks through the service role, assigns the new automatic
-- tasks and notifies the assignees.
--
-- tasks:read / tasks:write (lib/auth/permissions.ts): owner, admin, finance,
-- operations, warehouse. An automatic task's row is also capped by the role
-- ceiling of its source module: fleet documents reach owner/admin/operations;
-- the money and HR sources owner/admin/finance. The app reads through the
-- service client and shows a neutral title instead (features/tasks).

-- 1. Recurring tasks --------------------------------------------------------------

create table public.recurring_tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  description  text check (description is null or char_length(description) <= 2000),
  -- Clamped to the month's last day (31 → 30 Nov, 28/29 Feb). Holds 1..31.
  -- squawk-ignore prefer-bigint-over-int
  day_of_month integer not null check (day_of_month between 1 and 31),
  is_active    boolean not null default true,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index recurring_tasks_created_by_idx on public.recurring_tasks (created_by);

create trigger recurring_tasks_set_updated_at
  before update on public.recurring_tasks
  for each row execute function public.set_updated_at();

create table public.recurring_task_assignees (
  recurring_task_id uuid not null references public.recurring_tasks (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  primary key (recurring_task_id, user_id)
);

create index recurring_task_assignees_user_idx on public.recurring_task_assignees (user_id);

-- 2. Tasks --------------------------------------------------------------------------

create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  description       text check (description is null or char_length(description) <= 2000),
  due_date          date,
  -- A user moved the due date: the sync keeps it instead of the document's.
  due_date_locked   boolean not null default false,
  status            text not null default 'open' check (status in ('open', 'done')),
  origin            text not null default 'manual'
                      check (origin in ('manual', 'recurring', 'automatic')),
  kind              text,
  source_table      text,
  source_id         uuid,
  recurring_task_id uuid references public.recurring_tasks (id) on delete set null,
  -- First day of the month the occurrence belongs to.
  recurrence_period date,
  completed_at      timestamptz,
  completed_by      uuid references auth.users (id) on delete set null,
  -- Closed by the sync because its document was settled; reopened by the sync
  -- if the document opens again. A task a user closed stays closed.
  auto_closed       boolean not null default false,
  -- Last due notification sent: 'due' on the day, 'overdue' after it.
  notified_stage    text check (notified_stage in ('due', 'overdue')),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tasks_automatic_has_source check (
    (origin = 'automatic') = (source_table is not null and source_id is not null and kind is not null)
  ),
  constraint tasks_source_known check (
    source_table is null
    or (source_table, kind) in (
      ('purchase_invoices', 'supplier_payment'),
      ('invoices', 'collection'),
      ('loan_installments', 'loan_installment'),
      ('issued_checks', 'issued_check'),
      ('fleet_documents', 'fleet_document'),
      ('employee_documents', 'employee_document')
    )
  ),
  constraint tasks_recurring_has_period check (
    (origin = 'recurring') = (recurrence_period is not null)
  ),
  constraint tasks_done_stamped check ((status = 'done') = (completed_at is not null)),
  constraint tasks_auto_closed_done check (not auto_closed or status = 'done'),
  constraint tasks_source_unique unique (source_table, source_id, kind),
  constraint tasks_recurrence_unique unique (recurring_task_id, recurrence_period)
);

comment on table public.tasks is
  'Tareas compartidas: manuales, de una recurrencia o automáticas de un documento (source_table, source_id, kind). Las automáticas las abre y cierra sync_automatic_tasks.';

create index tasks_status_due_idx on public.tasks (status, due_date);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_completed_by_idx on public.tasks (completed_by);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- What a task is about never changes: the sync's unique key and the
-- recurrence link stay put (a deleted recurrence may only clear its link).
create function public.guard_task_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origin is distinct from old.origin
     or new.kind is distinct from old.kind
     or new.source_table is distinct from old.source_table
     or new.source_id is distinct from old.source_id
     or new.recurrence_period is distinct from old.recurrence_period
     or (new.recurring_task_id is distinct from old.recurring_task_id
         and new.recurring_task_id is not null) then
    raise exception 'El origen de una tarea no se puede cambiar.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

create trigger tasks_guard_identity
  before update on public.tasks
  for each row execute function public.guard_task_identity();

create table public.task_assignees (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_assignees_user_idx on public.task_assignees (user_id);
create index task_assignees_assigned_by_idx on public.task_assignees (assigned_by);

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  author_id  uuid references auth.users (id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);
create index task_comments_author_idx on public.task_comments (author_id);

-- 3. RLS ------------------------------------------------------------------------------
-- tasks:read / tasks:write roles: owner, admin, finance, operations, warehouse.
-- No delete policy on tasks or comments: a task is closed, not deleted.

alter table public.recurring_tasks enable row level security;
alter table public.recurring_task_assignees enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_comments enable row level security;

create policy "Task roles view recurring tasks" on public.recurring_tasks
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])) );

create policy "Task roles create recurring tasks" on public.recurring_tasks
  for insert to authenticated
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and created_by = (select auth.uid())
  );

create policy "Task roles edit recurring tasks" on public.recurring_tasks
  for update to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])) )
  with check ( (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])) );

create policy "Task roles view recurring task assignees" on public.recurring_task_assignees
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])) );

create policy "Task roles add recurring task assignees" on public.recurring_task_assignees
  for insert to authenticated
  with check ( (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])) );

create policy "Task roles remove recurring task assignees" on public.recurring_task_assignees
  for delete to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])) );

-- An automatic task is visible under its source module's role ceiling too.
create policy "Task roles view tasks" on public.tasks
  for select to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source_table is null
      or (source_table = 'fleet_documents'
          and (select public.user_has_role(array['owner', 'admin', 'operations'])))
      or (source_table <> 'fleet_documents'
          and (select public.user_has_role(array['owner', 'admin', 'finance'])))
    )
  );

create policy "Task roles create manual tasks" on public.tasks
  for insert to authenticated
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and origin = 'manual'
    and created_by = (select auth.uid())
  );

create policy "Task roles edit tasks" on public.tasks
  for update to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source_table is null
      or (source_table = 'fleet_documents'
          and (select public.user_has_role(array['owner', 'admin', 'operations'])))
      or (source_table <> 'fleet_documents'
          and (select public.user_has_role(array['owner', 'admin', 'finance'])))
    )
  )
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source_table is null
      or (source_table = 'fleet_documents'
          and (select public.user_has_role(array['owner', 'admin', 'operations'])))
      or (source_table <> 'fleet_documents'
          and (select public.user_has_role(array['owner', 'admin', 'finance'])))
    )
  );

-- Assignees and comments follow their task's visibility (the subquery reads
-- tasks under its own RLS).
create policy "Task roles view task assignees" on public.task_assignees
  for select to authenticated
  using ( exists (select 1 from public.tasks t where t.id = task_id) );

create policy "Task roles add task assignees" on public.task_assignees
  for insert to authenticated
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and exists (select 1 from public.tasks t where t.id = task_id)
  );

create policy "Task roles remove task assignees" on public.task_assignees
  for delete to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and exists (select 1 from public.tasks t where t.id = task_id)
  );

create policy "Task roles view task comments" on public.task_comments
  for select to authenticated
  using ( exists (select 1 from public.tasks t where t.id = task_id) );

create policy "Task roles comment on tasks" on public.task_comments
  for insert to authenticated
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and author_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id)
  );

revoke all on table public.recurring_tasks, public.recurring_task_assignees,
  public.tasks, public.task_assignees, public.task_comments
  from public, anon;

-- 4. Recurring occurrences ------------------------------------------------------------
-- Creates this month's and next month's occurrence of every active recurrence
-- once it falls due within 7 days of p_today (the Argentine day), never one
-- dated before the recurrence existed. The recurrence's assignees are copied.
-- Idempotent through tasks_recurrence_unique. Returns how many it created.

create function public.materialize_recurring_tasks(p_today date)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with months as (
    select make_date(extract(year from p_today)::int, extract(month from p_today)::int, 1) as period
    union all
    select (make_date(extract(year from p_today)::int, extract(month from p_today)::int, 1)
            + interval '1 month')::date
  ),
  occurrences as (
    select
      r.id as recurring_task_id,
      r.title,
      r.description,
      m.period,
      m.period + (least(
        r.day_of_month,
        extract(day from ((m.period + interval '1 month')::date - 1))::int
      ) - 1) as due_date,
      (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date as created_on
    from public.recurring_tasks r
    cross join months m
    where r.is_active
  ),
  inserted as (
    insert into public.tasks
      (title, description, due_date, origin, recurring_task_id, recurrence_period)
    select o.title, o.description, o.due_date, 'recurring', o.recurring_task_id, o.period
      from occurrences o
     where o.due_date >= o.created_on
       and o.due_date <= p_today + 7
    on conflict (recurring_task_id, recurrence_period) do nothing
    returning id, recurring_task_id
  ),
  assigned as (
    insert into public.task_assignees (task_id, user_id)
    select i.id, a.user_id
      from inserted i
      join public.recurring_task_assignees a on a.recurring_task_id = i.recurring_task_id
    returning task_id
  )
  select count(*)::int from inserted;
$$;

comment on function public.materialize_recurring_tasks(date) is
  'Crea las ocurrencias de las tareas recurrentes activas que vencen dentro de 7 días de p_today (cron tasks-daily). Idempotente.';

revoke all on function public.materialize_recurring_tasks(date) from public, anon, authenticated;
grant execute on function public.materialize_recurring_tasks(date) to service_role;

-- 5. Automatic tasks ---------------------------------------------------------------------
-- The documents that need action as of p_today (the Argentine day):
--   supplier_payment   a purchase factura/ND with a balance, due within 7 days;
--   collection         a sales factura/ND with a balance, past its due date;
--   loan_installment   a pending installment of an active loan, due within 7 days;
--   issued_check       an own check still emitted, due within 7 days;
--   fleet_document     a document of an active vehicle/driver expiring within
--                      30 days with no later one of its kind past that window;
--   employee_document  the same for an active employee.
-- Each one is upserted on (source_table, source_id, kind): a new one is
-- created; an existing one gets the document's title and due date (unless a
-- user moved it) and, if the sync had closed it, opens again. An open
-- automatic task whose document left the list is closed (auto_closed). A task
-- a user closed stays closed. Returns every task it touched with the change.

create function public.sync_automatic_tasks(p_today date)
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

-- 6. Notifications ------------------------------------------------------------------------
-- 'task_due': the cron tells a task's assignees on its due day and once it is
-- overdue. Every row the old check accepted passes the new, wider one, so it
-- needs no validation scan.

-- Replaced right below by a wider check.
alter table public.notifications
  -- squawk-ignore ban-drop-constraint
  drop constraint notifications_type_known;

alter table public.notifications
  add constraint notifications_type_known
  check (type in (
    'chat_message',
    'chat_reply',
    'chat_mention',
    'document_expiring',
    'ai_workflow_run',
    'task_due'
  )) not valid;
