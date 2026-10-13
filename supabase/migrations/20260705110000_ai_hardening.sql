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
