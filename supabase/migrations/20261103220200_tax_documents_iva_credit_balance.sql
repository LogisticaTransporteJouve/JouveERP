SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Impuestos: el saldo a favor técnico de IVA. Expand-only: one nullable
-- column.
--
-- tax_documents.credit_balance: the saldo a favor técnico the IVA DDJJ of
-- the period leaves for the next one (ARCA's "saldo técnico a favor del
-- responsable"), typed by the user from the DDJJ. Only an IVA document
-- carries it. The IVA estimate of a period (getIvaPositionEstimateAction)
-- subtracts the one of the previous period's IVA document. A month with
-- nothing to pay keeps its document with the balance (pendiente, or
-- anulado once there is nothing to do: an annulled document still says what
-- the DDJJ left). guard_tax_document needs no change: a paid document
-- stays frozen (notes aside) and an annulled one untouched.
--
-- Rollback: older code never selects or writes the column.

-- New, all-NULL column: nothing to check.
alter table public.tax_documents
  add column credit_balance numeric(18, 2);

alter table public.tax_documents
  add constraint tax_documents_credit_balance_iva check (
    credit_balance is null or (credit_balance > 0 and kind = 'iva')
  ) not valid;

comment on column public.tax_documents.credit_balance is
  'Saldo a favor técnico de IVA que la DDJJ del período deja para el siguiente (lo carga el usuario). Lo descuenta el estimado de IVA del mes siguiente.';
