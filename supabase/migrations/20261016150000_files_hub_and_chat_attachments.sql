-- Files hub (/files) + attachments in the AI CFO chat.
--
-- 1. file_attachments gains `ai_chat_message_id`: a file the user attaches to
--    an assistant message is linked to that message like any other attachable
--    entity (files-patterns.md §11 "extender entidades atachables"). A chat
--    upload is linked to exactly one message.
-- 2. Chat attachments are private to the session: the `files` and
--    `file_attachments` SELECT policies hide them from everyone but the
--    uploader / session owner and owner/admin (ai:admin, the same rule as
--    ai_chat_sessions). The `files` storage bucket policies read through
--    public.files, so blob access tightens with it. `authenticated` cannot
--    create chat links: the chat route links with the service client after
--    checking session ownership.
-- 3. v_files_hub: one row per (file, owning entity) across file_attachments,
--    ai_document_extractions and employee_documents. SECURITY INVOKER, so the
--    RLS of every underlying table applies; the server action also filters
--    the entity types by the caller's permissions.
-- 4. find_orphan_files: a chat upload that was never sent gets a 24 h grace
--    instead of 1 h, so a draft message keeps its files for the day.

set row_security = off;

------------------------------------------------------------------------------
-- 1. file_attachments.ai_chat_message_id
------------------------------------------------------------------------------
alter table public.file_attachments
  add column ai_chat_message_id uuid
    references public.ai_chat_messages (id) on delete cascade;

create index file_attachments_ai_chat_message_idx
  on public.file_attachments (ai_chat_message_id)
  where ai_chat_message_id is not null;

-- A chat upload belongs to one message: two concurrent sends of the same
-- draft file cannot both link it.
create unique index file_attachments_chat_file_unique_idx
  on public.file_attachments (file_id)
  where ai_chat_message_id is not null;

alter table public.file_attachments
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
    = 1
  );

------------------------------------------------------------------------------
-- 2. RLS — chat attachments are private to the session owner (+ ai:admin)
------------------------------------------------------------------------------
-- files:read roles (lib/auth/permissions.ts): owner, admin, finance,
-- operations, warehouse. ai:admin: owner, admin.
drop policy if exists "Roles with files:read can view files" on public.files;
create policy "Roles with files:read can view files"
  on public.files for select to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source <> 'chat_attachment'
      or uploaded_by = (select auth.uid())
      or (select public.user_has_role(array['owner', 'admin']))
    )
  );

drop policy if exists "Roles with files:read can view file_attachments" on public.file_attachments;
create policy "Roles with files:read can view file_attachments"
  on public.file_attachments for select to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      ai_chat_message_id is null
      or (select public.user_has_role(array['owner', 'admin']))
      or exists (
        select 1
        from public.ai_chat_messages m
        join public.ai_chat_sessions s on s.id = m.session_id
        where m.id = file_attachments.ai_chat_message_id
          and s.user_id = (select auth.uid())
      )
    )
  );

-- Chat links are written only by the chat route (service client).
drop policy if exists "Finance and ops can attach files" on public.file_attachments;
create policy "Finance and ops can attach files"
  on public.file_attachments for insert to authenticated
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
    and ai_chat_message_id is null
  );

------------------------------------------------------------------------------
-- 3. v_files_hub
------------------------------------------------------------------------------
create view public.v_files_hub
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
    end                    as entity_type,
    coalesce(
      fa.purchase_invoice_id, fa.invoice_id, fa.receipt_id, fa.payment_order_id,
      fa.check_id, fa.issued_check_id, fa.client_id, fa.supplier_id,
      fa.transaction_id, fa.ai_chat_message_id
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
  left join public.user_profiles p on p.user_id = f.uploaded_by;

comment on view public.v_files_hub is
  'Una fila por (archivo, entidad dueña): adjuntos, documentos de IA y documentos de empleados. SECURITY INVOKER: aplica la RLS de cada tabla.';

revoke all on table public.v_files_hub from public, anon, authenticated;
grant select on table public.v_files_hub to authenticated;

------------------------------------------------------------------------------
-- 4. find_orphan_files — 24 h grace for unsent chat uploads
------------------------------------------------------------------------------
create or replace function public.find_orphan_files(
  p_max_age interval default '1 hour'
)
returns table (
  id          uuid,
  bucket      text,
  bucket_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.bucket, f.bucket_path
  from public.files f
  left join public.file_attachments fa on fa.file_id = f.id
  where fa.id is null
    and f.created_at < now() - case
      when f.source = 'chat_attachment' then greatest(p_max_age, interval '24 hours')
      else p_max_age
    end
    and not exists (
      select 1 from public.ai_document_extractions e where e.file_id = f.id
    )
    and not exists (
      select 1 from public.employee_documents d where d.attachment_file_id = f.id
    );
$$;

revoke all on function public.find_orphan_files(interval) from public, anon, authenticated;
grant execute on function public.find_orphan_files(interval) to service_role;

set row_security = on;
