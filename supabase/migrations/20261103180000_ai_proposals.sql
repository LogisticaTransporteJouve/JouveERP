SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- AI CFO 6.3 + 6.4 — proposals outside the chat, and the new insight kinds.
-- Expand-only.
--
-- 1. ai_proposals: a write the assistant proposes outside a chat session
--    (today: from an insight card), for one user, waiting for their Aceptar
--    or Descartar. `action` names a `propose` action of the registry
--    (features/ai/registry); `draft` is already parsed with that action's
--    form schema and `summary` is what the card showed. Accepting is a
--    compare-and-set in the app (UPDATE ... WHERE status = 'pending', which
--    takes the row lock and re-checks the predicate) and
--    guard_ai_proposal below refuses every other transition, so a double
--    click executes once. `expires_at` bounds how long a figure the user saw
--    stays acceptable. Chat proposals keep ai_chat_confirmations (revisions
--    per session and tool call).
-- 2. ai_insights.proposal: the proposal an insight offers ({ action, label,
--    input }), written by the analyst. Each user prepares it with their own
--    permissions when they click it; nothing is drafted in the background.
-- 3. ai_insights select: the new kinds by role, mirroring
--    INSIGHT_KIND_PERMISSION (features/ai/insights/lib/visibility.ts).
--
-- Rollback: older code never reads ai_proposals nor ai_insights.proposal;
-- the analyst of an older deploy deletes and re-inserts only its own kinds,
-- so rows of the new kinds stay until the next run of this code.
--
-- RLS: authenticated reads only its own proposals, for the roles holding
-- ai:read (lib/auth/permissions.ts); every write goes through the service
-- client after the server action's gate, filtering by the caller.

------------------------------------------------------------------------------
-- 1. ai_proposals
------------------------------------------------------------------------------

create table public.ai_proposals (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  action              text not null check (char_length(action) between 1 and 64),
  source              text not null check (source in ('insight')),
  insight_id          uuid references public.ai_insights (id) on delete set null,
  insight_kind        text check (insight_kind is null or char_length(insight_kind) <= 64),
  -- The action and its input, normalized: one pending proposal per user and
  -- key, so clicking the same insight twice returns the same card.
  dedupe_key          text not null check (char_length(dedupe_key) between 1 and 200),
  input               jsonb not null default '{}'::jsonb,
  draft               jsonb not null,
  labels              jsonb not null default '{}'::jsonb,
  summary             jsonb not null,
  title               text not null check (char_length(title) between 1 and 200),
  status              text not null default 'pending'
                        check (status in ('pending', 'accepted', 'dismissed', 'failed', 'expired')),
  result              jsonb,
  error               text check (error is null or char_length(error) <= 500),
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  constraint ai_proposals_decided
    check ((status = 'pending') = (decided_at is null))
);

comment on table public.ai_proposals is
  'Propuestas de escritura del AI CFO fuera del chat (hoy, desde un insight), para un usuario. Nada se escribe hasta que el usuario acepta; aceptar es un compare-and-set sobre status = pending y el guard rechaza cualquier otra transición.';
comment on column public.ai_proposals.action is
  'Acción propose del registry de IA (features/ai/registry) que ejecuta el borrador al aceptar.';
comment on column public.ai_proposals.result is
  'Lo que produjo la escritura aceptada (id creado y notas); null mientras está pendiente o si falló.';

create index ai_proposals_user_idx
  on public.ai_proposals (user_id, created_at desc);

create index ai_proposals_insight_idx
  on public.ai_proposals (insight_id)
  where insight_id is not null;

create unique index ai_proposals_one_pending_idx
  on public.ai_proposals (user_id, dedupe_key)
  where status = 'pending';

-- pending → accepted (before it expires) | dismissed | expired, and
-- accepted → failed. What the user saw never changes; the outcome (result,
-- error) is written only after the claim. insight_id may only go to null
-- (the analyst replaces its insight rows on each run).
create function public.guard_ai_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.action is distinct from old.action
     or new.source is distinct from old.source
     or new.insight_kind is distinct from old.insight_kind
     or new.dedupe_key is distinct from old.dedupe_key
     or new.input is distinct from old.input
     or new.draft is distinct from old.draft
     or new.labels is distinct from old.labels
     or new.summary is distinct from old.summary
     or new.title is distinct from old.title
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at
     or (new.insight_id is distinct from old.insight_id and new.insight_id is not null) then
    raise exception 'Una propuesta de IA no se modifica: descartala y generá otra'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('accepted', 'dismissed', 'expired'))
      or (old.status = 'accepted' and new.status = 'failed')
    ) then
      raise exception 'Esta propuesta ya no está pendiente'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if old.status = 'pending' and new.status = 'accepted' and old.expires_at <= now() then
      raise exception 'La propuesta venció: generala de nuevo para ver los datos actuales'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  elsif new.decided_at is distinct from old.decided_at then
    raise exception 'Esta propuesta ya no está pendiente'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if (new.result is distinct from old.result or new.error is distinct from old.error)
     and old.status <> 'accepted' then
    raise exception 'El resultado de una propuesta se guarda solo después de aceptarla'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_ai_proposal() from public, anon, authenticated;

create trigger ai_proposals_guard
  before update on public.ai_proposals
  for each row execute function public.guard_ai_proposal();

alter table public.ai_proposals enable row level security;

-- Own rows only, for the roles that hold ai:read (lib/auth/permissions.ts).
create policy "ai_proposals select"
  on public.ai_proposals for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
  );

revoke all on table public.ai_proposals from public, anon, authenticated;
grant select on table public.ai_proposals to authenticated;

------------------------------------------------------------------------------
-- 2. ai_insights.proposal
------------------------------------------------------------------------------

alter table public.ai_insights
  add column proposal jsonb;

comment on column public.ai_insights.proposal is
  'Propuesta que ofrece la tarjeta: { action, label, input } (acción propose del registry de IA y su input). Cada usuario la prepara con sus permisos al hacer click; null si la tarjeta no propone nada.';

------------------------------------------------------------------------------
-- 3. ai_insights select — new kinds
------------------------------------------------------------------------------

drop policy if exists "ai_insights select" on public.ai_insights;

create policy "ai_insights select"
  on public.ai_insights for select
  to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin']))
    or (
      kind in ('cashflow', 'receivables_risk', 'dup_invoice', 'unusual_amount', 'client_margin_drop', 'late_interest_uncharged', 'unreconciled_bank_lines', 'pending_driver_settlements', 'loan_installments_due', 'cash_vs_financing')
      and (select public.user_has_role(array['finance']))
    )
    or (
      kind in ('fleet_doc_expiry', 'trip_margin', 'vehicle_cost_per_km', 'fuel_consumption_outlier')
      and (select public.user_has_role(array['operations']))
    )
  );
