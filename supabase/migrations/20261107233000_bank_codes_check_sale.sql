SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A bank code for the credit of a cheque discount (Banco Galicia: «Credito
-- Descuento Documento»): the line is reconciled with the transfers of the
-- cheques sold to the bank (sell_checks), one credit per «N° de préstamo».
--
-- Rollback: older code does not know the kind and shows the line as a code
-- it cannot act on; nothing posts.

alter table public.bank_statement_codes
  -- squawk-ignore ban-drop-constraint
  drop constraint bank_statement_codes_kind_check,
  -- squawk-ignore constraint-missing-not-valid
  add constraint bank_statement_codes_kind_check check (kind in (
    'tax', 'bank_fee', 'receipt', 'payment', 'transfer', 'loan', 'ignore',
    'check_sale'
  ));
