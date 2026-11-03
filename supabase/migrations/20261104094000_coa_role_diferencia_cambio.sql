SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system role for the exchange difference of USD receivables and
-- payables (audit w1-s1 F3). Alone in its file: a new enum value cannot be
-- used in the transaction that adds it, and 20261104094300 assigns it and
-- posts with it.
--   diferencia_cambio — result account (gain or loss) for the pesos between
--                       the rate a USD comprobante was booked at and the
--                       rate of the receipt or payment order that settles it.
alter type public.coa_system_role add value if not exists 'diferencia_cambio' after 'intereses_pagados';
