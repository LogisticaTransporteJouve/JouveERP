-- Align employee_documents RLS to the hr:* permission matrix.
--
-- The original policies (migration 20260518100000) gated to
-- owner/admin/operations, but lib/auth/permissions.ts grants hr:read/hr:write
-- to owner/admin/finance only. Consequence: an `operations` user passed RLS
-- but failed userCan() (redirected), and a `finance` user passed userCan() but
-- was blocked by RLS. Every other HR table (employees, payroll_*,
-- attendance_records, employee_leaves, employee_vacation_balances) already uses
-- owner/admin/finance.
--
-- Owner decision (2026-06-16): employee documents are owned by `finance`,
-- consistent with the rest of HR. The companion cron document-expiry-alerts is
-- updated in the same PR to fan out to owner/admin/finance.
--
-- RLS-only change: the table shape is unchanged, so lib/db/database.types.ts is
-- unaffected.

drop policy if exists "hr_read_documents" on public.employee_documents;
drop policy if exists "hr_write_documents" on public.employee_documents;
drop policy if exists "hr_update_documents" on public.employee_documents;
drop policy if exists "hr_delete_documents" on public.employee_documents;

create policy "hr_read_documents"
  on public.employee_documents for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr_write_documents"
  on public.employee_documents for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr_update_documents"
  on public.employee_documents for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr_delete_documents"
  on public.employee_documents for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
