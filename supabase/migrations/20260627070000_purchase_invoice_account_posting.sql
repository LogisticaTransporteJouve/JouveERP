-- Posteo de compras por cuenta resuelta (Port 02, Step 5).
--
-- Si la factura de compra tiene account_id (lo sugiere el clasificador IA y lo
-- confirma un humano), la línea del neto debita/acredita esa cuenta en vez del
-- rol genérico 'compras'. create_journal_entry ya prioriza account_id sobre
-- system_role, así que esto es backward-compatible: las facturas sin account_id
-- siguen posteando exactamente igual que antes.

set row_security = off;

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
begin
  v_desc_prefix := case when p_reverse then 'Anulación ' else '' end || case p_invoice.kind
    when 'factura' then 'Factura compra '
    when 'nc'      then 'NC compra '
    when 'nd'      then 'ND compra '
  end || coalesce(p_invoice.letter::text, 'X');

  if v_dir > 0 then
    -- Asiento directo: factura/ND emitida normal
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'proveedores',
      'credit', p_invoice.imp_total,
      'description', v_desc_prefix || ' — proveedor'
    );
    if p_invoice.imp_neto > 0 then
      v_lines := v_lines || (
        case
          when p_invoice.account_id is not null then
            jsonb_build_object(
              'account_id', p_invoice.account_id,
              'debit', p_invoice.imp_neto,
              'description', v_desc_prefix || ' — neto'
            )
          else
            jsonb_build_object(
              'system_role', 'compras',
              'debit', p_invoice.imp_neto,
              'description', v_desc_prefix || ' — neto'
            )
        end
      );
    end if;
    if p_invoice.imp_iva > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'iva_credito',
        'debit', p_invoice.imp_iva,
        'description', v_desc_prefix || ' — IVA crédito'
      );
    end if;
    if p_invoice.imp_trib > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'percepciones_iibb_pagadas',
        'debit', p_invoice.imp_trib,
        'description', v_desc_prefix || ' — percepciones'
      );
    end if;
  else
    -- Invertido: NC compra (compensa factura) o anulación
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'proveedores',
      'debit', p_invoice.imp_total,
      'description', v_desc_prefix || ' — proveedor'
    );
    if p_invoice.imp_neto > 0 then
      v_lines := v_lines || (
        case
          when p_invoice.account_id is not null then
            jsonb_build_object(
              'account_id', p_invoice.account_id,
              'credit', p_invoice.imp_neto,
              'description', v_desc_prefix || ' — neto'
            )
          else
            jsonb_build_object(
              'system_role', 'compras',
              'credit', p_invoice.imp_neto,
              'description', v_desc_prefix || ' — neto'
            )
        end
      );
    end if;
    if p_invoice.imp_iva > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'iva_credito',
        'credit', p_invoice.imp_iva,
        'description', v_desc_prefix || ' — IVA crédito'
      );
    end if;
    if p_invoice.imp_trib > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'percepciones_iibb_pagadas',
        'credit', p_invoice.imp_trib,
        'description', v_desc_prefix || ' — percepciones'
      );
    end if;
  end if;

  return v_lines;
end;
$function$;

set row_security = on;
