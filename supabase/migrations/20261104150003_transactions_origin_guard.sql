SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W8 · S2 F3: a Caja movement on a check cartera, or one that names
-- its document, is written only by that document. RLS lets owner and finance
-- insert transactions, and only createTransactionAction refused a cartera:
-- - a direct POST on a checks/echeq account moved the cartera with no check,
--   so the cartera and Σ its checks disagreed;
-- - a direct POST with receipt_id, payment_order_id or issued_check_id booked
--   Caja under that document with no journal entry (the document posts its
--   own movements, build_transaction_journal_lines skips them), and the row
--   could not be deleted or edited afterwards (owned by the document).
-- rejected_check_id, manual_check_id and check_sale_id are the same kind of
-- link (owned, posted by the check's own entries), so they follow the same
-- rule. invoice_id stays free: «Nuevo movimiento» sets it.
--
-- The writers, latest definitions, of a transaction on a cartera or with one
-- of those links:
-- - create_receipt / update_receipt (receipt_id; cartera lines with their
--   check) and create_payment_order / update_payment_order (payment_order_id;
--   endorsed checks leave the cartera), with every RPC that reaches them
--   (settle_billed_remito, the driver settlements, impute_purchase_remitos);
-- - deposit_check and sell_checks (the cartera side of the transfer;
--   check_sale_id), reject_check and pay_check_sale_debt
--   (rejected_check_id);
-- - apply_account_opening_balance (owner only), which adjusts any account;
-- - triggers, at pg_trigger_depth() > 1: checks_manual_inflow
--   (manual_check_id, a check loaded by hand, by the importer or by the
--   seed), issued_check_cashed_outflow and issued_check_rejected_inflow
--   (issued_check_id), payroll_payment_sync_transaction (account_id on
--   update).
-- The other money RPCs (create_transfer, pay_loan_installment,
-- record_loan_disbursement, pay_tax_document, payroll, employee accounts,
-- bank reconciliation) refuse a cartera and set none of those links. No app
-- code writes one: createTransactionAction refuses carteras and sets none.
-- An UPDATE is checked the same way when it moves a movement onto a cartera
-- or sets one of those links; a foreign key's set null clears them and passes.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code writes these movements only through those writers, so
-- it is unaffected.

create function public.guard_transaction_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.receipt_id is null
       and new.payment_order_id is null
       and new.issued_check_id is null
       and new.rejected_check_id is null
       and new.manual_check_id is null
       and new.check_sale_id is null
       and not exists (
         select 1 from public.accounts a
          where a.id = new.account_id and a.type in ('checks', 'echeq')
       ) then
      return new;
    end if;
  elsif not (
    (new.receipt_id is not null and new.receipt_id is distinct from old.receipt_id)
    or (new.payment_order_id is not null and new.payment_order_id is distinct from old.payment_order_id)
    or (new.issued_check_id is not null and new.issued_check_id is distinct from old.issued_check_id)
    or (new.rejected_check_id is not null and new.rejected_check_id is distinct from old.rejected_check_id)
    or (new.manual_check_id is not null and new.manual_check_id is distinct from old.manual_check_id)
    or (new.check_sale_id is not null and new.check_sale_id is distinct from old.check_sale_id)
    or (new.account_id is distinct from old.account_id
        and exists (
          select 1 from public.accounts a
           where a.id = new.account_id and a.type in ('checks', 'echeq')
        ))
  ) then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;
  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?(create_receipt|update_receipt|create_payment_order|update_payment_order|deposit_check|sell_checks|reject_check|pay_check_sale_debt|apply_account_opening_balance)\(' then
    return new;
  end if;

  raise exception 'Un movimiento en una cartera de cheques, o ligado a un recibo, una orden de pago o un cheque, lo genera solo ese documento: cargalo desde Recibos, Órdenes de pago o Cheques'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_transaction_origin() from public, anon, authenticated;

create trigger transactions_guard_origin
  before insert or update of account_id, receipt_id, payment_order_id, issued_check_id,
                             rejected_check_id, manual_check_id, check_sale_id
  on public.transactions
  for each row execute function public.guard_transaction_origin();
