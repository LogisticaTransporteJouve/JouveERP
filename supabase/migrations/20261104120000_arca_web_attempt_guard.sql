SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- How a sign-in to ARCA went, recorded only against the credentials the run
-- read (compare-and-set on updated_at, which every save moves), and a stop
-- after two failures in a row: ARCA locks a user after a few bad attempts,
-- and a captcha, a lock notice or a timeout after the clave is not told
-- apart from a wrong clave. A stopped account is 'sign_in_failing', so
-- get_arca_web_password hands nothing out until someone saves the clave
-- again (set_arca_web_credentials resets it).
--
-- record_arca_web_sign_in(boolean, text) stays for code from before this
-- migration.

create or replace function public.record_arca_web_attempt(
  p_ok         boolean,
  p_error_code text,
  p_version    timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.arca_web_account
       set status = 'active',
           consecutive_failures = 0,
           last_success_at = now(),
           last_error_code = null
     where id and updated_at = p_version;
  else
    update public.arca_web_account
       set consecutive_failures = consecutive_failures + 1,
           last_error_code = left(coalesce(p_error_code, 'SIGN_IN_FAILED'), 40),
           status = case when p_error_code = 'SIGN_IN_REJECTED'
                           or consecutive_failures + 1 >= 2
                         then 'sign_in_failing' else status end
     where id and updated_at = p_version;
  end if;
  return found;
end;
$$;

revoke all on function public.record_arca_web_attempt(boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_arca_web_attempt(boolean, text, timestamptz) to service_role;

-- A received voucher is linked to a purchase only when the totals agree too
-- (within ARCA's rounding cent): a purchase with the same number and another
-- total is a different document or a typo, and the tray keeps the voucher
-- pending so a person looks at it. Same signature as 20261104104001.
create or replace function public.link_received_vouchers(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with matches as (
    select v.id as voucher_id,
           coalesce(
             (select p.id
                from public.purchase_invoices p
                join public.suppliers s on s.id = p.supplier_id
                join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
               where s.cuit = v.issuer_cuit and p.kind = v.kind
                 and p.punto_venta = v.punto_venta and p.numero = v.numero
                 and p.status = 'received' and p.letter = v.letter
                 and abs(p.imp_total - v.imp_total) <= 0.01
               limit 1),
             (select p.id
                from public.purchase_invoices p
                join public.suppliers s on s.id = p.supplier_id
                join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
               where s.cuit = v.issuer_cuit and p.kind = v.kind
                 and p.punto_venta = v.punto_venta and p.numero = v.numero
                 and p.status = 'received' and p.letter is null
                 and abs(p.imp_total - v.imp_total) <= 0.01
               limit 1)
           ) as purchase_id
      from public.arca_received_vouchers v
     where v.id = any (p_ids)
       and v.status in ('pending_review', 'discarded')
  )
  update public.arca_received_vouchers v
     set status = 'confirmed',
         purchase_invoice_id = m.purchase_id,
         reviewed_at = now(),
         claimed_at = null
    from matches m
   where v.id = m.voucher_id
     and m.purchase_id is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.link_received_vouchers(uuid[]) from public, anon, authenticated;
grant execute on function public.link_received_vouchers(uuid[]) to service_role;
