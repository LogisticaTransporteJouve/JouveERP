SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A bank code by its text, for banks whose statement has no code (Banco
-- Provincia): a row with an empty bank_code applies to the lines whose
-- description contains its description_pattern. It needs one of the two.

alter table public.bank_statement_codes
  -- squawk-ignore ban-drop-constraint
  drop constraint bank_statement_codes_bank_code_check,
  -- squawk-ignore constraint-missing-not-valid
  add constraint bank_statement_codes_bank_code_check check (
    char_length(bank_code) <= 20
    and (bank_code <> '' or description_pattern <> '')
  );
