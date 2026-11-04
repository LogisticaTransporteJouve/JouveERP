-- 20261104104000 validates the CHECKs that earlier migrations left NOT
-- VALID. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(1);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Counting the validated ones, so a renamed or dropped constraint fails too.
select is(
  (select count(*)::int
     from pg_catalog.pg_constraint c
     join pg_catalog.pg_class t on t.oid = c.conrelid
     join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.contype = 'c'
      and c.convalidated
      and t.relname::text || '.' || c.conname::text in (
            'notifications.notifications_type_known',
            'file_attachments.file_attachments_exactly_one_target',
            'tasks.tasks_source_known',
            'tax_documents.tax_documents_payment_origin_known',
            'tax_documents.tax_documents_credit_balance_iva',
            'tax_documents.tax_documents_payment_previous_status_known'
          )),
  6,
  'the widened checks are validated'
);

select * from finish();
rollback;
