-- AI CFO phase 4 — recurring AI tasks, their runs, the weekly summary and
-- ignoring an insight.
--
-- 1. ai_workflows: a task a user asked for in natural language ("todos los
--    lunes resumime cobranzas vencidas") with its schedule in Buenos Aires
--    local time (UTC-3, no DST). `next_run_at` is computed by the app
--    (features/ai/workflows/schedule.ts); the every-15-minutes cron claims the
--    due rows and advances it.
-- 2. ai_workflow_runs: one row per occurrence. (workflow_id, scheduled_for) is
--    unique, so a retried materialization never queues the same occurrence
--    twice. `previous_run_id` + `summary` are the memory the next run reads.
-- 3. ai_weekly_summaries: the Monday CFO summary, one per user and week.
-- 4. ai_insights: an ignored finding keeps who, when and why, and its
--    `fingerprint` (kind + the records it points at) keeps the analyst from
--    raising the same finding again.
-- 5. ai_usage.kind and notifications.type learn the new producers.
--
-- Every new table is read-only for `authenticated` (own rows, roles holding
-- ai:chat in lib/auth/permissions.ts); writes go through the service client
-- after the server action's gate or from the Inngest functions, always
-- filtering by the owning user.

set row_security = off;

------------------------------------------------------------------------------
-- 1. ai_workflows
------------------------------------------------------------------------------
create table public.ai_workflows (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  prompt       text not null check (char_length(prompt) between 1 and 2000),
  cadence      text not null check (cadence in ('daily', 'weekly', 'monthly')),
  run_hour     smallint not null check (run_hour between 0 and 23),
  run_minute   smallint not null check (run_minute in (0, 15, 30, 45)),
  -- ISO weekday, 1 = Monday … 7 = Sunday (weekly only).
  weekday      smallint check (weekday between 1 and 7),
  -- 1–28 so every month has the day (monthly only).
  month_day    smallint check (month_day between 1 and 28),
  is_active    boolean not null default true,
  next_run_at  timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ai_workflows_schedule_shape check (
    (cadence = 'daily' and weekday is null and month_day is null)
    or (cadence = 'weekly' and weekday is not null and month_day is null)
    or (cadence = 'monthly' and month_day is not null and weekday is null)
  )
);

comment on table public.ai_workflows is
  'Tareas de IA recurrentes de un usuario: un pedido en lenguaje natural con horario en hora de Buenos Aires. El cron materializa las vencidas en ai_workflow_runs.';

create index ai_workflows_due_idx
  on public.ai_workflows (next_run_at)
  where is_active;

create index ai_workflows_user_idx
  on public.ai_workflows (user_id, created_at desc);

-- At most 10 active tasks per user (MAX_ACTIVE_WORKFLOWS_PER_USER in
-- features/ai/workflows/store.ts), checked when a row is created active or
-- resumed. The per-user lock serializes concurrent creates and resumes, so two
-- requests cannot both pass the count.
create function public.ai_workflows_enforce_active_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    perform pg_advisory_xact_lock(hashtextextended('ai_workflows:' || new.user_id::text, 0));
    if (
      select count(*) from public.ai_workflows
      where user_id = new.user_id and is_active and id <> new.id
    ) >= 10 then
      raise exception 'ai_workflows: active limit reached'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ai_workflows_enforce_active_cap() from public, anon, authenticated;

create trigger ai_workflows_enforce_active_cap
  before insert or update of is_active on public.ai_workflows
  for each row execute function public.ai_workflows_enforce_active_cap();

create trigger ai_workflows_set_updated_at
  before update on public.ai_workflows
  for each row execute function public.set_updated_at();

alter table public.ai_workflows enable row level security;

create policy "ai_workflows select"
  on public.ai_workflows for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
  );

revoke all on table public.ai_workflows from anon, authenticated;
grant select on table public.ai_workflows to authenticated;

------------------------------------------------------------------------------
-- 2. ai_workflow_runs
------------------------------------------------------------------------------
create table public.ai_workflow_runs (
  id               uuid primary key default gen_random_uuid(),
  workflow_id      uuid not null references public.ai_workflows (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  scheduled_for    timestamptz not null,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  previous_run_id  uuid references public.ai_workflow_runs (id) on delete set null,
  output           text,
  summary          text check (summary is null or char_length(summary) <= 1000),
  skip_reason      text,
  error            text,
  tool_names       text[],
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint ai_workflow_runs_occurrence_key unique (workflow_id, scheduled_for)
);

comment on table public.ai_workflow_runs is
  'Corridas de una tarea de IA. (workflow_id, scheduled_for) es único: materializar dos veces no duplica. previous_run_id + summary son la memoria de la corrida siguiente.';

create index ai_workflow_runs_workflow_idx
  on public.ai_workflow_runs (workflow_id, scheduled_for desc);

create index ai_workflow_runs_user_idx
  on public.ai_workflow_runs (user_id, created_at desc);

create index ai_workflow_runs_previous_idx
  on public.ai_workflow_runs (previous_run_id);

alter table public.ai_workflow_runs enable row level security;

create policy "ai_workflow_runs select"
  on public.ai_workflow_runs for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
  );

revoke all on table public.ai_workflow_runs from anon, authenticated;
grant select on table public.ai_workflow_runs to authenticated;

------------------------------------------------------------------------------
-- 3. ai_weekly_summaries
------------------------------------------------------------------------------
create table public.ai_weekly_summaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  week_start  date not null,
  content     text not null check (char_length(content) between 1 and 8000),
  sources     text[] not null default '{}',
  created_at  timestamptz not null default now(),
  constraint ai_weekly_summaries_user_week_key unique (user_id, week_start)
);

comment on table public.ai_weekly_summaries is
  'Resumen semanal del AI CFO, redactado por el modelo sobre cifras de las consultas del usuario (con sus permisos). Uno por usuario y semana.';

alter table public.ai_weekly_summaries enable row level security;

create policy "ai_weekly_summaries select"
  on public.ai_weekly_summaries for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
  );

revoke all on table public.ai_weekly_summaries from anon, authenticated;
grant select on table public.ai_weekly_summaries to authenticated;

------------------------------------------------------------------------------
-- 4. ai_insights — ignore with a reason
------------------------------------------------------------------------------
alter table public.ai_insights
  add column fingerprint      text,
  add column dismissed_reason text
    check (dismissed_reason is null or char_length(dismissed_reason) <= 500),
  add column dismissed_by     uuid references auth.users (id) on delete set null,
  add column dismissed_at     timestamptz;

comment on column public.ai_insights.fingerprint is
  'kind + hash de los registros a los que apunta el hallazgo. Si hay una fila descartada con el mismo fingerprint, el analyst no lo vuelve a generar. Null en tarjetas agregadas (cash-flow, cobranzas).';

create index ai_insights_dismissed_by_idx
  on public.ai_insights (dismissed_by)
  where dismissed_by is not null;

create index ai_insights_dismissed_fingerprint_idx
  on public.ai_insights (fingerprint)
  where status = 'dismissed' and fingerprint is not null;

------------------------------------------------------------------------------
-- 5. ai_usage.kind + notifications.type
------------------------------------------------------------------------------
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;

alter table public.ai_usage
  add constraint ai_usage_kind_check
  check (
    kind in (
      'chat',
      'chat_title',
      'document_classify',
      'document_extract',
      'expense_classify',
      'tool_repair',
      'workflow_run',
      'weekly_summary'
    )
  );

alter table public.notifications
  drop constraint if exists notifications_type_known;

alter table public.notifications
  add constraint notifications_type_known
  check (type in (
    'chat_message',
    'chat_reply',
    'chat_mention',
    'document_expiring',
    'ai_workflow_run'
  ));

set row_security = on;
