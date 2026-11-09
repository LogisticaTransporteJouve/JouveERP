SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system roles for a leasing (a truck under a financial lease). Alone in
-- their file: a new enum value cannot be used in the transaction that adds
-- it, and 20261109120100 assigns and posts with them.
--   deudas_leasing — the leasing liability (2.1.5 «Deudas por leasing»): its
--                    opening debt credits it and each cuota's capital and
--                    valor residual debit it.
--   rodados        — the leased vehicle as a fixed asset (1.2.1.1 «Rodados»).
--   seguros        — the vehicle insurance a cuota carries (5.2.5).
--   patentes       — the vehicle registration tax a cuota carries (5.2.6).
alter type public.coa_system_role add value if not exists 'deudas_leasing' after 'prestamos';
alter type public.coa_system_role add value if not exists 'rodados' after 'anticipos_personal';
alter type public.coa_system_role add value if not exists 'seguros' after 'intereses_pagados';
alter type public.coa_system_role add value if not exists 'patentes' after 'seguros';
