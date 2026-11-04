# 2026-11-03 — Liquidación R y rendición de cobranza contra entrega (4.3 + 4.5)

**Decisión (4.3).** La liquidación de fletes es una entidad propia
(`freight_settlements` + `freight_settlement_items`): un cliente, un período
y sus cargas **entregadas** en ese período (por fecha de entrega, o la
programada si no tiene). Borrador → confirmada → facturada; cancelada libera
las cargas. Cada carga va a su flete o, si no tiene, a la tarifa de **flete**
del cliente vigente el día de entrega (concepto nuevo `freight` en
`client_tariffs`, unidad "por carga", solo en pesos). El precio se recalcula
al confirmar; confirmada queda congelada (cargas, total y flete de sus
cargas). ~~La "R" es el documento interno de la liquidación~~ (reemplazado
el mismo día: R = remito fiscal, X = remito interno; ver la entrada
"Liquidación: Remito R en Ventas…"): número `R-00000012`
(correlativo propio, se asigna al confirmar), PDF con recuadro "R" y la
leyenda "Documento no válido como factura" (`/api/freight-settlements/[id]/pdf`).
Se factura con **una** factura (una línea por carga, IVA 21% en Ventas;
remito interno en Otras ventas) por `issueFiscalInvoiceAction`, con el mismo
reclamo/liberación que "Facturar flete", y `link_freight_settlement_invoice`
deja cada carga apuntando a esa factura y le pone como flete el precio
facturado (así cuenta en la rentabilidad del viaje). Una carga está en una
sola liquidación viva (índice único parcial + guard) y mientras tanto no se
factura sola. Una factura fallida o anulada devuelve la liquidación a
confirmada (`invoices_release_freight_settlement`, como
`release_invoice_billing_links` con las cargas); una facturada solo se
cancela con la factura anulada o acreditada por NC emitida por el total.
Permisos: los de facturación (`invoices:read` / `invoices:issue`), sin
permiso nuevo; RLS de lectura owner/admin/finance, escrituras por RPC con
service role.

**Decisión (4.5).** `shipments.cod_amount` marca la carga contra entrega con
lo que el chofer cobra. La rendición (`driver_settlements` + items por carga

- líneas de lo entregado: cuenta, importe y cheque) es de un chofer (el del
  viaje de la carga) y guarda esperado, entregado y diferencia por carga.
  Confirmar (`confirm_driver_settlement`, bajo lock, idempotente) emite **un
  recibo por cliente y canal** con `create_receipt`: el recibo es dueño de sus
  movimientos de caja y de los cheques que entran a cartera (patrón de
  movimientos con dueño), y se imputa a la factura de cada carga hasta su
  saldo; el resto queda a cuenta. Un segundo confirm devuelve los mismos
  recibos. Confirmada queda congelada; se cancela solo con sus recibos ya
  anulados (en Recibos, con sus guardas). La diferencia se registra, no se
  asienta. Permisos: `receipts:read` / `receipts:write`.

**Descartado.** Liquidación con precio manual por carga (se corrige el flete
o la tarifa); tarifa de flete en USD; asentar la diferencia de la rendición
contra la cuenta corriente del chofer (queda pendiente); un recibo por
carga (muchos recibos para un mismo cliente); permisos nuevos por módulo.
