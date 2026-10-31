SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- D11: a rejected check is a receivable ("Deudores por cheques rechazados"),
-- not an expense. A new enum value cannot be used in the transaction that adds
-- it, so the account and the postings that use it come in the next migration.
alter type public.coa_system_role add value if not exists 'cheques_rechazados' after 'cheques_cartera';
