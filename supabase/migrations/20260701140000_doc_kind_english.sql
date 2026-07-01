-- Rename Document Intelligence detected_type values from Spanish to English.
-- `detected_type` is a plain text column (no enum, no CHECK), so this is a
-- data-only UPDATE. Values map 1:1 to the DOCUMENT_KINDS enum in
-- features/ai/document/types.ts.
update public.ai_document_extractions
set detected_type = case detected_type
  when 'factura_compra' then 'purchase_invoice'
  when 'factura_venta'  then 'sales_invoice'
  when 'recibo'         then 'receipt'
  when 'orden_pago'     then 'payment_order'
  when 'remito'         then 'delivery_note'
  when 'cheque'         then 'check'
  when 'extracto'       then 'bank_statement'
  when 'nc_nd'          then 'credit_debit_note'
  when 'otro'           then 'other'
  else detected_type
end
where detected_type in (
  'factura_compra', 'factura_venta', 'recibo', 'orden_pago',
  'remito', 'cheque', 'extracto', 'nc_nd', 'otro'
);
