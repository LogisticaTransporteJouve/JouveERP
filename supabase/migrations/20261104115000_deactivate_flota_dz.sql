SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- DZ Instalaciones was retired on 2026-10-31 (20261031190209_retire_dz_division),
-- but its cost center FLOTA_DZ (seeded in 20260517200000_l_closure) stayed
-- active and kept showing in every cost picker. It is deactivated, not
-- deleted: transactions, invoices, purchases, receipts, payment orders and
-- journal entries may reference it, and the pickers still show it on those
-- records as "(inactivo)". A database without the row updates nothing.
update public.cost_centers set is_active = false where code = 'FLOTA_DZ' and is_active;
