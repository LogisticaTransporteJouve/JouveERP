SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system role for the partners' personal account. Alone in its file: a
-- new enum value cannot be used in the transaction that adds it, and
-- 20261112170100 creates the account and posts with it.
--   cuenta_particular_socios — «Cuenta particular de socios» (an asset under
--                              1.1): the net of a sale or purchase that does
--                              not belong to Jouve's activity.
alter type public.coa_system_role add value if not exists 'cuenta_particular_socios' after 'anticipos_personal';
