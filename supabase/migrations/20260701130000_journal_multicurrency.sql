-- Multicurrency into the ledger (M.2): foreign-currency invoices post ARS.
--
-- Sales/purchase invoices store amounts in their `moneda` (PES/DOL) with an AFIP
-- `cotizacion` (ARS per unit; 1 for PES). The journal emitters posted the raw
-- amounts, so a DOL invoice put USD magnitudes into the ARS ledger. Fix: convert
-- each amount by the rate before posting.
--
-- Balance safety: `imp_total` = Σ of its component amounts, so the counterparty
-- line (clientes/proveedores) is set to the SUM of the rounded, converted detail
-- lines — the entry balances exactly regardless of 2-decimal rounding. For PES
-- (rate 1) the output is identical to before (backward-compatible).

set row_security = off;

-- Rate lookup fallback: latest exchange_rates entry for a currency on/before a
-- date. Only used when an invoice has no stored cotizacion.
create or replace function public.get_exchange_rate(p_currency text, p_date date)
returns numeric
language sql
stable
set search_path = public
as $$
  select rate
  from public.exchange_rates
  where currency = p_currency and rate_date <= p_date
  order by rate_date desc
  limit 1;
$$;

-- ── Sales invoices ──────────────────────────────────────────────────────────
create or replace function public.build_invoice_journal_lines(
  p_invoice public.invoices,
  p_is_fiscal boolean,
  p_reverse boolean default false
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_lines       jsonb := '[]'::jsonb;
  v_kind_factor numeric := case when p_invoice.kind = 'nc' then -1 else 1 end;
  v_sign        numeric := case when p_reverse then -1 else 1 end;
  v_dir         numeric := v_kind_factor * v_sign;
  v_desc_prefix text;
  v_rate        numeric := case
    when p_invoice.moneda is null or p_invoice.moneda = 'PES' then 1
    else coalesce(
      nullif(p_invoice.cotizacion, 0),
      public.get_exchange_rate('USD', p_invoice.fecha),
      1
    )
  end;
  v_revenue numeric := round(
    (p_invoice.imp_neto + p_invoice.imp_op_ex + p_invoice.imp_tot_conc) * v_rate, 2);
  v_iva     numeric := round(p_invoice.imp_iva * v_rate, 2);
  v_trib    numeric := round(p_invoice.imp_trib * v_rate, 2);
  v_total   numeric := round(p_invoice.imp_total * v_rate, 2);
  v_client  numeric;
  v_debit_client boolean := v_dir > 0;  -- true = client debited (invoice), else credited
begin
  v_desc_prefix := case when p_reverse then 'Anulación ' else '' end
    || case p_invoice.kind
      when 'factura' then 'Factura '
      when 'nc'      then 'Nota de crédito '
      when 'nd'      then 'Nota de débito '
    end || coalesce(p_invoice.letter::text, 'X');

  if p_is_fiscal then
    -- Counterparty = sum of the posted detail lines → exact balance.
    v_client := (case when v_revenue > 0 then v_revenue else 0 end)
      + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
      + (case when p_invoice.imp_trib > 0 then v_trib else 0 end);
  else
    v_client := v_total;
  end if;

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'clientes',
    case when v_debit_client then 'debit' else 'credit' end, v_client,
    'description', v_desc_prefix || ' — cliente'
  );

  if p_is_fiscal then
    if v_revenue > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'ventas',
        case when v_debit_client then 'credit' else 'debit' end, v_revenue,
        'description', v_desc_prefix || ' — neto'
      );
    end if;
    if p_invoice.imp_iva > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'iva_debito',
        case when v_debit_client then 'credit' else 'debit' end, v_iva,
        'description', v_desc_prefix || ' — IVA débito'
      );
    end if;
    if p_invoice.imp_trib > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'percepciones_iibb_cobradas',
        case when v_debit_client then 'credit' else 'debit' end, v_trib,
        'description', v_desc_prefix || ' — percepciones'
      );
    end if;
  else
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'ventas',
      case when v_debit_client then 'credit' else 'debit' end, v_client,
      'description', v_desc_prefix || ' — ingreso interno'
    );
  end if;

  return v_lines;
end;
$function$;

-- ── Purchase invoices ───────────────────────────────────────────────────────
create or replace function public.build_purchase_invoice_journal_lines(
  p_invoice public.purchase_invoices,
  p_reverse boolean default false
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_lines       jsonb := '[]'::jsonb;
  v_kind_factor numeric := case when p_invoice.kind = 'nc' then -1 else 1 end;
  v_sign        numeric := case when p_reverse then -1 else 1 end;
  v_dir         numeric := v_kind_factor * v_sign;
  v_desc_prefix text;
  v_rate        numeric := case
    when p_invoice.moneda is null or p_invoice.moneda = 'PES' then 1
    else coalesce(
      nullif(p_invoice.cotizacion, 0),
      public.get_exchange_rate('USD', p_invoice.fecha),
      1
    )
  end;
  v_neto  numeric := round(p_invoice.imp_neto * v_rate, 2);
  v_iva   numeric := round(p_invoice.imp_iva * v_rate, 2);
  v_trib  numeric := round(p_invoice.imp_trib * v_rate, 2);
  v_prov  numeric;
  v_debit_detail boolean := v_dir > 0;  -- true = expense debited (invoice), else credited
begin
  v_desc_prefix := case when p_reverse then 'Anulación ' else '' end
    || case p_invoice.kind
      when 'factura' then 'Factura compra '
      when 'nc'      then 'NC compra '
      when 'nd'      then 'ND compra '
    end || coalesce(p_invoice.letter::text, 'X');

  -- Counterparty = sum of the posted detail lines → exact balance.
  v_prov := (case when p_invoice.imp_neto > 0 then v_neto else 0 end)
    + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
    + (case when p_invoice.imp_trib > 0 then v_trib else 0 end);

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'proveedores',
    case when v_debit_detail then 'credit' else 'debit' end, v_prov,
    'description', v_desc_prefix || ' — proveedor'
  );

  if p_invoice.imp_neto > 0 then
    v_lines := v_lines || (
      case
        when p_invoice.account_id is not null then
          jsonb_build_object(
            'account_id', p_invoice.account_id,
            case when v_debit_detail then 'debit' else 'credit' end, v_neto,
            'description', v_desc_prefix || ' — neto'
          )
        else
          jsonb_build_object(
            'system_role', 'compras',
            case when v_debit_detail then 'debit' else 'credit' end, v_neto,
            'description', v_desc_prefix || ' — neto'
          )
      end
    );
  end if;
  if p_invoice.imp_iva > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'iva_credito',
      case when v_debit_detail then 'debit' else 'credit' end, v_iva,
      'description', v_desc_prefix || ' — IVA crédito'
    );
  end if;
  if p_invoice.imp_trib > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'percepciones_iibb_pagadas',
      case when v_debit_detail then 'debit' else 'credit' end, v_trib,
      'description', v_desc_prefix || ' — percepciones'
    );
  end if;

  return v_lines;
end;
$function$;

set row_security = on;
