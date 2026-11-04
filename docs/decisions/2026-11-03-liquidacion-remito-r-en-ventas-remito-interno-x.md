# 2026-11-03 — Liquidación: Remito R en Ventas, remito interno X en Otras ventas

**Decisión.** Reemplaza el documento "R" interno de la 4.3. **R es el remito
fiscal y X el remito interno.** La liquidación sigue el lado de su cliente
(`freight_settlements.channel`, fijado al confirmar):

- **Ventas:** confirmar (`confirm_freight_settlement_document`) emite el
  **Remito R** `R9002-00000001` (`remito_pos` + `remito_number`, correlativo
  propio bajo lock, único por punto de venta), con PDF con recuadro "R",
  "REMITO" y "Documento no válido como factura". "Facturar" emite después la
  Factura A/B agrupada, vinculada a la liquidación.
- **Otras ventas:** no hay R. "Emitir remito interno" confirma el borrador y
  emite en el mismo paso el **remito interno X** (`X9001-…`) por el mismo
  camino de siempre (`issueFiscalInvoiceAction` en el canal interno); es el
  documento final. Pasarlo a fiscal es "Facturar un remito interno".
- **Las ya confirmadas** conservan su `R-00000012` (`numero`, `channel` null)
  y su PDF. `confirm_freight_settlement(uuid, uuid)` sigue numerando así para
  el código anterior (rollback); la app nueva no la llama.

**Punto de venta 9002.** AFIP ata cada punto de venta a un sistema de
emisión: el Remito R (comprobante impreso, con CAI) no puede compartir el de
WSFE de las facturas (0003, y AFIP da los siguientes números bajos). 9001 es
el punto de venta local de Otras ventas; 9002 queda al lado, fuera del rango
de AFIP, y se define en un solo lugar (`freight_remito_pos()`). No va a
`sales_points`, para que no aparezca al facturar ni al cobrar. Los recibos
pasan a letra X (PR #330), así que `R` queda solo para el remito.

**Por qué.** En Argentina la letra R es la del remito (cód. 91) y X la de los
documentos no fiscales; un cliente de Otras ventas no debe recibir un
documento con letra fiscal.

**Descartado.** Usar el punto de venta de las facturas (otro sistema de
emisión); un R también en Otras ventas (dos documentos para lo mismo);
renumerar las liquidaciones viejas (se reescribiría historia ya impresa);
cambiar la firma de `confirm_freight_settlement` (el código anterior la llama
con dos argumentos y espera un número).
