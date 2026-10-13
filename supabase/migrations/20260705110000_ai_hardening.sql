-- AI hardening — insights visibility per domain + ai_usage.kind.
--
-- 1. ai_insights: the original select policy (20260616180000) let every ai:read
--    holder (incl. `operations`) read every card, leaking treasury / AR / AP
--    figures (cash-flow projection, receivables risk, duplicate/unusual
--    supplier invoices) to a role that can't see those domains in the app.
--    Visibility now follows lib/auth/permissions.ts per card kind:
--      cashflow          → accounts:read            (owner, admin, finance)
--      receivables_risk  → receipts:read            (owner, admin, finance)
--      dup_invoice       → purchase_invoices:read   (owner, admin, finance)
--      unusual_amount    → purchase_invoices:read   (owner, admin, finance)
--      fleet_doc_expiry  → fleet_documents:read     (owner, admin, operations)
--      trip_margin       → trips:read               (owner, admin, operations)
--    Any other / future kind: owner + admin only until mapped here. The server
--    action (features/ai/insights/lib/visibility.ts) applies the same map.
--
-- 2. ai_usage.kind: distinguishes chat turns from the other model calls
--    (chat titles, Document Intelligence, expense classification, tool-call
--    repair) so all of them count toward the daily cap (ai_usage_today() sums
--    every row) while staying separable in the breakdown. Existing rows were
--    all chat turns → default 'chat'.
--
-- 3. ai_usage_today(): the daily cap counted prompt-cache reads as full
--    tokens. prompt_tokens is the TOTAL input (uncached + cache read + cache
--    write), so a long cached chat/system prompt burned the cap ~10× faster
--    than its actual cost. Cache reads (cached_tokens) are now subtracted;
--    the return shape is unchanged.

set row_security = off;

------------------------------------------------------------------------------
-- 1. ai_insights — select gated by card domain
------------------------------------------------------------------------------
drop policy if exists "ai_insights select" on public.ai_insights;

create policy "ai_insights select"
  on public.ai_insights for select
  to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin']))
    or (
      kind in ('cashflow', 'receivables_risk', 'dup_invoice', 'unusual_amount')
      and (select public.user_has_role(array['finance']))
    )
    or (
      kind in ('fleet_doc_expiry', 'trip_margin')
      and (select public.user_has_role(array['operations']))
    )
  );

------------------------------------------------------------------------------
-- 2. ai_usage.kind
------------------------------------------------------------------------------
alter table public.ai_usage
  add column kind text not null default 'chat'
  check (
    kind in (
      'chat',
      'chat_title',
      'document_classify',
      'document_extract',
      'expense_classify',
      'tool_repair'
    )
  );

comment on column public.ai_usage.kind is
  'Qué originó el consumo: chat, chat_title, document_classify, document_extract, expense_classify, tool_repair. Todas cuentan para el tope diario (ai_usage_today).';

create index ai_usage_kind_idx on public.ai_usage (kind, created_at);

------------------------------------------------------------------------------
-- 3. ai_usage_today — cache reads don't count toward the daily cap
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
      sum(
        greatest(coalesce(prompt_tokens, 0) - coalesce(cached_tokens, 0), 0)
        + coalesce(completion_tokens, 0)
      ),
      0
    )::bigint as total_tokens,
    coalesce(sum(cost_usd), 0)::numeric as cost_usd
  from public.ai_usage
  where created_at >= date_trunc('day', now());
$$;

comment on function public.ai_usage_today() is
  'Tokens (input sin cache reads + output) y costo de IA consumidos hoy (global). Security definer: el medidor (ai:read) lee el agregado sin acceso a filas crudas.';

revoke all on function public.ai_usage_today() from public;
grant execute on function public.ai_usage_today() to authenticated;

set row_security = on;
