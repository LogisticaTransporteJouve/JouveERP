-- RG 4667 — cuenta RECPAM para el asiento manual de ajuste por inflación.
-- Cuelga de 4.2 (resultados financieros); el signo lo da el asiento
-- (débito = pérdida, crédito = ganancia), no el account_type.
-- Idempotente: si la cuenta ya fue creada a mano, no hace nada.

set row_security = off;

insert into public.chart_of_accounts (
  parent_id, code, name, level, account_type, eerr_category, system_role
)
select
  p.id,
  '4.2.2',
  'RECPAM (resultado por exposición a la inflación)',
  3,
  'resultado_positivo'::public.coa_account_type,
  'ingresos_financieros',
  null
from public.chart_of_accounts p
where p.code = '4.2'
on conflict (code) do nothing;

set row_security = on;
