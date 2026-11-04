SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- COA system role for the perceptions and payments on account of Ganancias
-- (and of any other national tax that is not IVA) a supplier charges on a
-- purchase: an asset, credited against that tax, never against IVA. Alone in
-- its file: a new enum value cannot be used in the transaction that adds it,
-- and 20261104113001 assigns it.
alter type public.coa_system_role add value if not exists 'percepciones_ganancias' after 'percepciones_iva_pagadas';
