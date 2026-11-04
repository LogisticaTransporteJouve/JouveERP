# 2026-11-04 — Liquidaciones: alcance fiscal y una factura por fuente

**`fiscal_reader` en liquidaciones.** Ve las del lado fiscal
(`settlementSide` = canal confirmado, o el del cliente) y no las de Otras
ventas; el ítem del menú queda, porque el Remito R y su factura son fiscales.
Se filtra en cada lectura del service client (`settlementInScope`); no lee
las candidatas (cargas). Descartado: negarle el módulo entero o leer con el
cliente RLS (la política de la tabla no lo incluye, así que no vería ninguna,
y las liquidaciones fiscales son parte de sus libros). Las otras lecturas
nuevas no le llegan: rendiciones (`receipts:read`), cheques vendidos
(`cheques:read`) e importaciones (`imports:read`) no son de su rol; la mora
fija el lado fiscal (`scopeIsFiscalFor`) y los impuestos leen con el cliente
RLS.

**Factura idempotente por liquidación o carga.** La clave de
`issueFiscalInvoiceAction` es un UUIDv5 de (fuente, id, tentativa); la
tentativa avanza solo cuando la anterior está fallida o anulada. Antes de
emitir se buscan las facturas de esas claves (de cualquier usuario): una viva
se vincula en vez de emitir. Sin migración: el código anterior tolera el
esquema y un rollback vuelve a la clave al azar. Descartado: una columna de
clave por fuente (migración, tipos y otra transición que mantener) y un
guard en SQL (la clave se deriva en la app). La reserva se mantiene como
estaba: se libera si la factura falló, si no se emitió o si la búsqueda
falló; un vínculo perdido con la factura viva la deja hasta que vence.
