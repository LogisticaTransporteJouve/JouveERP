SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A bank code for the credit of a cheque discount (Banco Galicia: «Credito
-- Descuento Documento»): the line is reconciled with the transfers of the
-- cheques sold to the bank (sell_checks), one credit per «N° de préstamo».
--
-- Rollback: older code drops a code of a kind it does not know, so its
-- lines show as without a code; nothing posts.

alter table public.bank_statement_codes
  -- squawk-ignore ban-drop-constraint
  drop constraint bank_statement_codes_kind_check,
  -- squawk-ignore constraint-missing-not-valid
  add constraint bank_statement_codes_kind_check check (kind in (
    'tax', 'bank_fee', 'receipt', 'payment', 'transfer', 'loan', 'ignore',
    'check_sale'
  ));

-- The IVA a bank charges on its fees and on a cheque discount's interest
-- (Galicia: «Iva», «Percep. Iva») is a tax credit like the IIBB ones: a
-- statement line may post to IVA Crédito Fiscal and Percepciones IVA too.
create or replace function public.is_bank_tax_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chart_of_accounts
     where id = p_account_id
       and is_active
       and system_role in (
         'percepciones_iibb_pagadas', 'retenciones_pagadas', 'percepciones_ganancias',
         'iva_credito', 'percepciones_iva_pagadas'
       )
  );
$$;

revoke all on function public.is_bank_tax_account(uuid) from public, anon, authenticated;

comment on function public.is_bank_tax_account(uuid) is
  'Cuentas de impuestos a favor que el banco debita (percepciones y recaudaciones de IIBB, retenciones, pagos a cuenta de Ganancias, IVA crédito fiscal y percepciones de IVA): una línea del extracto (o el pago de una tarjeta) puede imputarse a ellas.';
