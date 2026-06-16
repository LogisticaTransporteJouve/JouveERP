-- AI.6 — Tracking de uso/costo de IA + medidor de tokens.
--
-- Una fila por turno del asistente con los tokens consumidos y el costo
-- estimado, escrita por la ruta de chat (service role) en su onFinish. Sirve
-- para (1) el medidor de la página IA y (2) el tope diario de tokens.
--
-- Privacidad: las filas crudas (qué consumió cada usuario) solo las ve ai:admin
-- (owner/admin) vía RLS. El medidor del día —visible a ai:read— lee un AGREGADO
-- global vía la RPC `ai_usage_today()` (security definer), sin exponer filas.
--
-- docs/ai-overview.md §6 / §8.

set row_security = off;

------------------------------------------------------------------------------
-- 1. ai_usage
------------------------------------------------------------------------------
create table public.ai_usage (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid references public.ai_chat_sessions (id) on delete set null,
  user_id           uuid references auth.users (id) on delete set null,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  cached_tokens     integer,
  cost_usd          numeric(10, 6),
  tool_names        text[],
  created_at        timestamptz not null default now()
);

comment on table public.ai_usage is
  'Uso/costo de IA por turno (tokens + costo estimado). Filas crudas solo ai:admin; el medidor del día lee el agregado vía ai_usage_today().';

create index ai_usage_created_idx on public.ai_usage (created_at);
create index ai_usage_user_idx on public.ai_usage (user_id, created_at);

------------------------------------------------------------------------------
-- 2. RLS — filas crudas solo owner/admin (ai:admin). Inserts vía service role.
------------------------------------------------------------------------------
alter table public.ai_usage enable row level security;

create policy "ai_usage_select"
  on public.ai_usage for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

------------------------------------------------------------------------------
-- 3. RPC: agregado del día (global), visible al medidor sin exponer filas.
------------------------------------------------------------------------------
create or replace function public.ai_usage_today()
returns table (total_tokens bigint, cost_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)),
      0
    )::bigint as total_tokens,
    coalesce(sum(cost_usd), 0)::numeric as cost_usd
  from public.ai_usage
  where created_at >= date_trunc('day', now());
$$;

comment on function public.ai_usage_today() is
  'Tokens y costo de IA consumidos hoy (global). Security definer: el medidor (ai:read) lee el agregado sin acceso a filas crudas.';

revoke all on function public.ai_usage_today() from public;
grant execute on function public.ai_usage_today() to authenticated;
