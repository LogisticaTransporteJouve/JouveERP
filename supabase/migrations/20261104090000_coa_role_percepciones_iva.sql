SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system role for the IVA perceptions a supplier charges on a purchase
-- (an asset: a payment on account of IVA). Alone in its file: a new enum value
-- cannot be used in the transaction that adds it, and 20261104090100 assigns it.
--   percepciones_iva_pagadas — IVA perceptions suffered on purchases.
-- iva_percibido (2.1.2.2) is the opposite side: IVA the company perceives as agent.
alter type public.coa_system_role add value if not exists 'percepciones_iva_pagadas' after 'percepciones_iibb_pagadas';
