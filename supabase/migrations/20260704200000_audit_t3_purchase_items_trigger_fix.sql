-- Audit remediation T3 — fix purchase_invoice_items journal regeneration.
--
-- Bug (critical): purchase_invoice_items_regen_journal was a FOR EACH STATEMENT
-- trigger whose function dereferenced new/old, which are UNASSIGNED in
-- statement-level triggers -> `record "new" is not assigned yet` on every
-- INSERT/UPDATE/DELETE. replace_purchase_invoice_items aborted on its first
-- DELETE, so purchase-invoice line items have been unsaveable since 2026-05-17,
-- and the journal was never regenerated on item edits (subledger drift).
--
-- Fix: drop the broken trigger and move the regen INTO
-- replace_purchase_invoice_items, after the header totals are recomputed, so the
-- re-emitted entry uses the final totals. The RPC becomes SECURITY DEFINER so it
-- can call emit_journal_for_purchase_invoice (revoked from authenticated in T1);
-- the purchase-invoices action already gates it with userCan, and the internal
-- create_journal_entry guard still sees the caller's finance JWT.

set row_security = off;

drop trigger if exists purchase_invoice_items_regen_journal on public.purchase_invoice_items;
drop function if exists public.regen_purchase_invoice_journal();

create or replace function public.replace_purchase_invoice_items(
  p_invoice_id uuid,
  p_items      jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item        jsonb;
  v_count       int;
  v_sum_neto    numeric(15, 2);
  v_sum_iva     numeric(15, 2);
  v_sum_total   numeric(15, 2);
  v_pi          public.purchase_invoices;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a jsonb array';
  end if;

  delete from public.purchase_invoice_items
   where purchase_invoice_id = p_invoice_id;

  v_count := jsonb_array_length(p_items);

  if v_count = 0 then
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.purchase_invoice_items (
      purchase_invoice_id, sort_order, description,
      quantity, unit_price, iva_rate_id,
      line_neto, line_iva, line_total
    ) values (
      p_invoice_id,
      coalesce((v_item ->> 'sort_order')::int, 0),
      v_item ->> 'description',
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      nullif(v_item ->> 'iva_rate_id', '')::int,
      (v_item ->> 'line_neto')::numeric,
      coalesce((v_item ->> 'line_iva')::numeric, 0),
      (v_item ->> 'line_total')::numeric
    );
  end loop;

  -- Recalc header totals from items. imp_trib (header-level) preserved.
  select
    coalesce(sum(line_neto),  0),
    coalesce(sum(line_iva),   0),
    coalesce(sum(line_total), 0)
    into v_sum_neto, v_sum_iva, v_sum_total
  from public.purchase_invoice_items
  where purchase_invoice_id = p_invoice_id;

  update public.purchase_invoices
     set imp_neto  = v_sum_neto,
         imp_iva   = v_sum_iva,
         imp_total = v_sum_total + coalesce(imp_trib, 0),
         updated_at = now()
   where id = p_invoice_id;

  -- Regenerate the journal from the final totals (replaces the broken
  -- statement-level trigger). Only received (posted) invoices carry an entry.
  select * into v_pi from public.purchase_invoices where id = p_invoice_id;
  if v_pi.id is not null and v_pi.status = 'received' then
    delete from public.journal_entries
     where source_table = 'purchase_invoices'
       and source_id    = p_invoice_id
       and is_reversal   = false;
    perform public.emit_journal_for_purchase_invoice(v_pi, false);
  end if;
end;
$$;

set row_security = on;
