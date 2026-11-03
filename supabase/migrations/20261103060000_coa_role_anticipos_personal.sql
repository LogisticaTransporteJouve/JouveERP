SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system role for the employee current account (decision D1). Alone in
-- its file: a new enum value cannot be used in the transaction that adds it,
-- and 20261103060100 assigns it and posts with it.
--   anticipos_personal — what employees owe the company: an advance paid from
--                        a cash or bank account, a purchase charged to an
--                        employee, and the cash an employee pays back.
alter type public.coa_system_role add value if not exists 'anticipos_personal' after 'cheques_rechazados';
