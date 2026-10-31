SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system role for payroll (audit 2026-10-31, Módulos S1). Alone in its
-- file: a new enum value cannot be used in the transaction that adds it, and
-- 20261031193031 assigns it to 5.3.1.
alter type public.coa_system_role add value if not exists 'sueldos';
