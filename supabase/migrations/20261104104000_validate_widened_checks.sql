SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Validates the CHECK constraints that earlier migrations added NOT VALID
-- and never validated, so pg_constraint.convalidated is true for them and a
-- later drop/re-add chain does not inherit the flag.
--
-- Every existing row passes, whatever production holds: a row written after
-- the NOT VALID add was checked on its insert or update, and a row older
-- than the add passed the check it replaced or did not have the column yet.
--   notifications_type_known (20261103000000): wider than the validated
--     check of 20261016130000.
--   file_attachments_exactly_one_target (20261103170000): the 20261103020000
--     version was NOT VALID too, but adds only columns new in those two
--     files (all NULL then); the last validated one is 20261016150000's.
--   tasks_source_known (20261103170000): same, over the validated check of
--     20261103000000 (the table's own).
--   tax_documents_payment_origin_known (20261104050100): its backfill set an
--     origin on every row with a payment, and the previous account only on
--     'link' rows; both columns were new.
--   tax_documents_credit_balance_iva (20261104050300) and
--   tax_documents_payment_previous_status_known (20261104092200): on columns
--     that were new and all NULL.
--
-- VALIDATE takes SHARE UPDATE EXCLUSIVE: reads and writes go on during the
-- scan.
--
-- Rollback: older code never reads convalidated; the constraints are the
-- same ones it already writes under.

-- squawk-ignore constraint-missing-not-valid
alter table public.notifications validate constraint notifications_type_known;
-- squawk-ignore constraint-missing-not-valid
alter table public.file_attachments validate constraint file_attachments_exactly_one_target;
-- squawk-ignore constraint-missing-not-valid
alter table public.tasks validate constraint tasks_source_known;
-- squawk-ignore constraint-missing-not-valid
alter table public.tax_documents validate constraint tax_documents_payment_origin_known;
-- squawk-ignore constraint-missing-not-valid
alter table public.tax_documents validate constraint tax_documents_credit_balance_iva;
-- squawk-ignore constraint-missing-not-valid
alter table public.tax_documents validate constraint tax_documents_payment_previous_status_known;
