SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system roles for loans (roadmap 2.3). Alone in their file: a new enum
-- value cannot be used in the transaction that adds it, and 20261103040100
-- assigns them and posts with them.
--   prestamos          — the loan liability: the disbursement credits it and
--                        the capital of a split installment debits it.
--   intereses_pagados  — the interest and other charges of a split
--                        installment (5.4.1 "Intereses pagados").
alter type public.coa_system_role add value if not exists 'prestamos' after 'cheques_diferidos_emitidos';
alter type public.coa_system_role add value if not exists 'intereses_pagados' after 'sueldos';
