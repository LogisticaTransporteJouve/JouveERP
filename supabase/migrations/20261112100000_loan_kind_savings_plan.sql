SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A savings plan for a vehicle (Toyota Plan, Círculo Cerrado): its cuotas
-- add up to an asset instead of paying down a debt. Alone in its file: a new
-- enum value cannot be used in the transaction that adds it, and
-- 20261112100100 seeds the account and posts with them.
--   loan_kind.plan_ahorro      — the savings plan, a loan with no
--                                disbursement and no opening debt.
--   coa_system_role.planes_ahorro — 1.2.1.x «Rodados en plan de ahorro»: each
--                                cuota paid debits it.
alter type public.loan_kind add value if not exists 'plan_ahorro' after 'leasing';
alter type public.coa_system_role add value if not exists 'planes_ahorro' after 'rodados';
