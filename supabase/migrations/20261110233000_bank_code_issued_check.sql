SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A bank code for the debit of an own cheque the bank paid (Galicia: «Echeq
-- 48 Hs. Nro. 577», «Cheque 48 Hs. Nro. …»): the line finds the emitted
-- issued cheque by its number and amount, marks it cashed on the line's date
-- and is reconciled with the bank outflow that cashing writes.
--
-- Rollback: older code reads the kind it does not know as a line with no
-- proposal; a code saved with it keeps working once the code is redeployed.
alter table public.bank_statement_codes
  -- squawk-ignore ban-drop-constraint
  drop constraint bank_statement_codes_kind_check,
  -- squawk-ignore constraint-missing-not-valid
  add constraint bank_statement_codes_kind_check check (kind in (
    'tax', 'bank_fee', 'receipt', 'payment', 'transfer', 'loan', 'ignore',
    'check_sale', 'card_payment', 'check_deposit', 'issued_check'
  ));
