-- Audit remediation T1b — RLS tightening on master tables, storage buckets,
-- and the global search surface.
--
-- Round-2/3 post-audit migrations tightened journal_entries and sales invoices
-- but left the master/reference tables and the purchase side at USING(true), so
-- any authenticated user (driver, warehouse) could read the full customer/
-- supplier master (names, CUITs), every purchase invoice with amounts, and all
-- file metadata via PostgREST. The `files` bucket and `invoices-pdf` bucket were
-- likewise readable/deletable by any authenticated user. And search_global's
-- role->entity map diverged from the RBAC matrix while the underlying matview
-- was directly REST-readable, bypassing the filter entirely.
--
-- Each SELECT policy below is scoped to exactly the roles that hold the matching
-- ":read" permission in lib/auth/permissions.ts. All reads of these tables in
-- the app go through the RLS user client for those roles (or the service client,
-- which bypasses RLS), so scoping to the permission holders is behavior-neutral
-- for authorized roles and closes the leak for the rest.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Master/reference table SELECT policies (drop USING(true) -> role-scoped)
------------------------------------------------------------------------------

-- clients / suppliers: read by owner, admin, finance, operations.
drop policy if exists "Authenticated users can view clients" on public.clients;
create policy "Roles with clients:read can view clients"
  on public.clients for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance', 'operations']));

drop policy if exists "Authenticated users can view suppliers" on public.suppliers;
create policy "Roles with suppliers:read can view suppliers"
  on public.suppliers for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance', 'operations']));

-- purchase invoices + items + chart of accounts: read by owner, admin, finance.
drop policy if exists "Authenticated users can view purchase invoices" on public.purchase_invoices;
create policy "Roles with purchase_invoices:read can view purchase invoices"
  on public.purchase_invoices for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

drop policy if exists "Authenticated users can view purchase invoice items" on public.purchase_invoice_items;
create policy "purchase_invoice_items select by accounting roles"
  on public.purchase_invoice_items for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

drop policy if exists "Authenticated users can view chart_of_accounts" on public.chart_of_accounts;
create policy "Roles with accounting:read can view chart_of_accounts"
  on public.chart_of_accounts for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- files + file_attachments: read by files:read holders (all roles except driver).
-- NOTE: this closes the driver/anon surface and, because the `files` storage
-- bucket SELECT/DELETE policies gate on `exists(select 1 from public.files ...)`
-- under the caller's RLS, it also tightens blob access to these roles. Per-entity
-- scoping (so warehouse cannot read HR-document attachments) is a larger change
-- tracked as a T6 design item (shared bucket vs per-entity confidentiality).
drop policy if exists "Authenticated users can view files" on public.files;
create policy "Roles with files:read can view files"
  on public.files for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']));

drop policy if exists "Authenticated users can view file_attachments" on public.file_attachments;
create policy "Roles with files:read can view file_attachments"
  on public.file_attachments for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']));

------------------------------------------------------------------------------
-- 2. invoices-pdf storage bucket: gate SELECT on finance roles
------------------------------------------------------------------------------
-- Serving goes through the service role (createSignedUrl), which bypasses RLS,
-- so this only affects direct authenticated access. invoices:read = finance.

drop policy if exists "Authenticated users can read invoices pdf" on storage.objects;
create policy "Roles with invoices:read can read invoices pdf"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'invoices-pdf'
    and public.user_has_role(array['owner', 'admin', 'finance'])
  );

------------------------------------------------------------------------------
-- 3. search_global: SECURITY DEFINER + role map aligned to the RBAC matrix
------------------------------------------------------------------------------
-- Flip to definer so it can read search_index after the matview grants are
-- revoked. Fix the role->entity map: operations lacks invoices:read and
-- transactions:read; warehouse lacks every search entity's :read permission.

create or replace function public.search_global(
  p_query text,
  p_limit int default 20
)
returns table (
  entity_type text,
  entity_id   text,
  title       text,
  subtitle    text,
  url         text,
  rank        real
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('spanish', p_query) as tsq
  ),
  caller_roles as (
    select array_agg(role_id) as roles
      from public.user_roles
     where user_id = auth.uid()
  ),
  allowed_types as (
    select case
      when (select roles from caller_roles) && array['owner', 'admin', 'finance']
        then array['client', 'supplier', 'invoice', 'purchase_invoice',
                   'receipt', 'payment_order', 'transaction']
      when (select roles from caller_roles) && array['operations']
        then array['client', 'supplier']
      else array[]::text[]
    end as types
  )
  select
    s.entity_type, s.entity_id, s.title, s.subtitle, s.url,
    ts_rank(s.tsv, q.tsq) as rank
  from public.search_index s, q, allowed_types a
  where s.tsv @@ q.tsq
    and s.entity_type = any (a.types)
  order by rank desc, s.title asc
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.search_global is
  'M.3 global search gated by caller permissions (SECURITY DEFINER). Role->entity map mirrors lib/auth/permissions.ts: owner/admin/finance = all; operations = client+supplier; warehouse/driver = none.';

revoke all on function public.search_global from public;
grant execute on function public.search_global(text, int) to authenticated;

-- Block direct REST reads of the matview (bypassed the role filter above).
revoke select on public.search_index from anon, authenticated;

set row_security = on;
