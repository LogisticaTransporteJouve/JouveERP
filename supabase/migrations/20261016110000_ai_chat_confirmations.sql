-- AI CFO phase 2 — proposals the assistant drafts and the user confirms.
--
-- One row per revision of a proposal. The chat route inserts a row when a
-- `propose` tool runs (nothing is written to the business tables yet); the
-- user confirms, declines or edits it from the card. Confirming is a
-- compare-and-set (`status = 'pending'` in the UPDATE's WHERE), so a double
-- click or a stale card never executes twice. A newer revision of the same
-- proposal (`revision_key`) supersedes the pending one first; the partial
-- unique index keeps at most one pending revision per proposal.
--
-- Writes go only through the service client, after the server action has
-- checked `ai:chat` plus the proposal's own permission and filtered by the
-- caller's user id; `authenticated` can only read its own rows.

set row_security = off;

create table public.ai_chat_confirmations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    uuid not null references public.ai_chat_sessions (id) on delete cascade,
  tool_call_id  text not null,
  action        text not null,
  revision_key  text not null,
  revision      integer not null default 1 check (revision > 0),
  origin        text not null default 'assistant'
                check (origin in ('assistant', 'user')),
  draft         jsonb not null,
  labels        jsonb not null default '{}'::jsonb,
  summary       jsonb not null,
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'declined', 'superseded', 'failed')),
  result_id     text,
  error         text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

comment on table public.ai_chat_confirmations is
  'Propuestas del asistente de IA pendientes de confirmación. Una fila por revisión; confirmar es un compare-and-set sobre status = pending.';

create index ai_chat_confirmations_session_idx
  on public.ai_chat_confirmations (session_id, created_at);

create index ai_chat_confirmations_user_idx
  on public.ai_chat_confirmations (user_id);

create unique index ai_chat_confirmations_one_pending_idx
  on public.ai_chat_confirmations (session_id, revision_key)
  where status = 'pending';

alter table public.ai_chat_confirmations enable row level security;

-- Own rows only, for the roles that hold ai:chat (lib/auth/permissions.ts).
create policy "ai_chat_confirmations select"
  on public.ai_chat_confirmations for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
  );

revoke all on table public.ai_chat_confirmations from anon, authenticated;
grant select on table public.ai_chat_confirmations to authenticated;

set row_security = on;
