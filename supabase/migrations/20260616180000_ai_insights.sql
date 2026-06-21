-- AI.5 — Motor de insights proactivos (ai_insights).
--
-- Un cron Inngest (analyst) corre periódicamente, calcula insights sobre el
-- negocio (cash-flow proyectado, delta de cobranzas) y los escribe acá. La
-- página de IA los renderiza como tarjetas. docs/ai-overview.md §5.
--
-- Lectura: holders de ai:read (owner/admin/finance/operations). Escritura: el
-- cron vía service role (bypass RLS) + ai:admin para gestionar (ack/dismiss).

set row_security = off;

create table public.ai_insights (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  severity     text not null check (severity in ('info', 'warning', 'critical')),
  title        text not null,
  finding      text not null,
  metrics      jsonb not null default '{}'::jsonb,
  source_refs  jsonb not null default '[]'::jsonb,
  period       text,
  status       text not null default 'open'
                 check (status in ('open', 'acknowledged', 'dismissed')),
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.ai_insights is
  'Insights proactivos generados por el cron analyst (cash-flow proyectado, delta de cobranzas). metrics = números de soporte; source_refs = [{table,id}] para drill-in. Severidad por icono+copy, nunca color.';

create index ai_insights_status_idx
  on public.ai_insights (status, severity, generated_at desc);
create index ai_insights_kind_idx
  on public.ai_insights (kind, generated_at desc);

------------------------------------------------------------------------------
-- RLS — lectura para ai:read; gestión (update) para ai:admin. Inserts del cron
-- vía service role (bypass RLS).
------------------------------------------------------------------------------
alter table public.ai_insights enable row level security;

create policy "ai_insights select"
  on public.ai_insights for select
  to authenticated
  using (
    public.user_has_role(array['owner', 'admin', 'finance', 'operations'])
  );

create policy "ai_insights update"
  on public.ai_insights for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));
