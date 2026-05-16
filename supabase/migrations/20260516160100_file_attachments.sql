-- K.10a — File attachments (N:1 links to business entities).
--
-- One FK column per atachable entity + a check constraint that exactly
-- one is set. K.10 wires only `purchase_invoices`; M.4 extends to
-- comprobantes / receipts / payment_orders / clients / suppliers /
-- transactions / cheques by adding columns + rebuilding the check.
--
-- `kind` discriminates intent within a target (a purchase invoice can
-- have an attached "comprobante" PDF and a "remito" photo). Free text;
-- the action layer enforces the per-target whitelist.

set row_security = off;

------------------------------------------------------------------------------
-- 1. file_attachments table
------------------------------------------------------------------------------
create table public.file_attachments (
  id                   uuid primary key default gen_random_uuid(),
  file_id              uuid not null references public.files (id) on delete cascade,

  -- One FK per atachable entity. Only purchase_invoices for now.
  purchase_invoice_id  uuid references public.purchase_invoices (id) on delete cascade,

  kind                 text not null,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),

  constraint file_attachments_kind_length
    check (length(kind) between 1 and 64),

  -- Exactly one target set. K.10 has a single FK so this is
  -- effectively `purchase_invoice_id is not null`, but the shape is
  -- ready for M.4 to add `+ (other_id is not null)::int` terms.
  constraint file_attachments_exactly_one_target
    check (
      (purchase_invoice_id is not null)::int = 1
    )
);

comment on table public.file_attachments is
  'Links files to business entities. One FK per entity + exactly-one check.';
comment on column public.file_attachments.kind is
  'Per-target discriminator (e.g. "comprobante", "remito"). Validated in action layer.';

create index file_attachments_file_id_idx
  on public.file_attachments (file_id);
create index file_attachments_purchase_invoice_idx
  on public.file_attachments (purchase_invoice_id)
  where purchase_invoice_id is not null;

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.file_attachments enable row level security;

create policy "Authenticated users can view file_attachments"
  on public.file_attachments for select
  to authenticated
  using (true);

create policy "Finance and ops can attach files"
  on public.file_attachments for insert
  to authenticated
  with check (
    public.user_has_role(array['owner', 'admin', 'finance', 'operations'])
  );

create policy "Creator or admin can detach files"
  on public.file_attachments for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    or public.user_has_role(array['owner', 'admin'])
  );

------------------------------------------------------------------------------
-- 3. Resolved view
------------------------------------------------------------------------------
-- Convenience view that flattens file + attachment + target_type. Useful
-- for the attachments-list component — picks the non-null FK and tags it.
create or replace view public.v_file_attachments_resolved as
select
  fa.id                  as attachment_id,
  fa.kind,
  fa.created_at          as attached_at,
  fa.created_by,
  f.id                   as file_id,
  f.original_filename,
  f.mime_type,
  f.file_size,
  f.bucket,
  f.bucket_path,
  f.quick_ocr,
  fa.purchase_invoice_id as target_id,
  'purchase_invoice'     as target_type
from public.file_attachments fa
join public.files f on f.id = fa.file_id
where fa.purchase_invoice_id is not null;

comment on view public.v_file_attachments_resolved is
  'Flattened file + attachment + target_type. M.4 extends with UNION ALL per new FK.';

------------------------------------------------------------------------------
-- 4. Realtime publication
------------------------------------------------------------------------------
-- Cross-user invalidation of attachments lists.
alter publication supabase_realtime add table public.file_attachments;

set row_security = on;
