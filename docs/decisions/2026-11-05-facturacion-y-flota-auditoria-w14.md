# 2026-11-05 — La flota cuenta la parte del flete que su factura todavía factura, y un borrador sin ítems se marca fallido (w14)

**Decisión.** Auditoría w14, frente U1 (w14-s5 F1, w14-s3 F1 y F2,
w14-s1 F1). Sigue la
[decisión w13](2026-11-05-facturacion-y-flota-auditoria-w13.md).

- **Borrador sin ítems** (`20261105100000`). `issue-invoice-reconcile`
  marca fallido, cada 15 minutos, todo borrador con más de 15 minutos y sin
  ítems, tenga la edad que tenga (`fail_itemless_invoice_drafts`, una sola
  sentencia que vuelve a mirar que siga en borrador y sin ítems).
  - Ese borrador queda cuando el alta muere entre la cabecera y los ítems.
    No es un comprobante, pero retenía lo que facturaba: un remito interno
    facturado en Ventas, un período de intereses por mora, una carga, un
    período de almacenaje. Fallido, lo libera en un solo lugar, para todas
    las fuentes:
    - el índice único y la guarda del remito facturado ignoran un fallido;
    - `late_interest_charge_is_live` también;
    - `release_invoice_billing_links` limpia la carga y borra el período de
      almacenaje.
  - El comprobante fallido dice «quedó sin ítems (su carga se interrumpió)
    y se marcó fallido: volvé a emitirlo».
  - El reenvío de borradores filtra en la consulta los que no tienen ítems,
    así no ocupan el lote de 50.
- **Ingreso de flota** (`20261105100001`). Una carga cuenta en el ingreso
  por la parte de su flete que su factura todavía factura:
  `flete × (total − NC emitidas + ND emitidas) / total`, con mínimo 0
  (`shipment_invoice_billed_ratio`). Vale en `v_trip_revenue`,
  `ai_fleet_margin` (por viaje, chofer, vehículo y cliente) y
  `ai_shipments_summary`. Por lo tanto también en «Rentabilidad de flota»,
  «Margen por camión», las herramientas de flota de la IA y sus insights.
  - Ejemplo: una carga de $100.000 en una factura de $121.000 con una NC de
    $36.300 cuenta $70.000; con una ND de $12.100, $110.000.
  - Una NC por el total da 0. Es la misma regla de anulación de w12
    (`billing_invoice_is_void`), así que la carga cuenta como por facturar y
    el viaje se lee no definitivo, igual que en la lista de cargas. La parte
    es 0 exactamente cuando esa regla dice anulada, así que «facturada» y
    los conteos de pendientes no cambian.
  - Solo cuentan las NC y ND de una factura **fiscal**, como en la regla de
    anulación. Una NC interna no libera la carga (w12):
    `settle_billed_remito` acredita con una NC interna el remito que se
    facturó en Ventas, y ese flete sigue facturado, por la factura.
  - Las ND de intereses por mora (vinculadas a su cargo o con la clave del
    cargo) no son flete y no cuentan.
  - Se comparan totales con IVA, como la regla de anulación. Si una NC o
    una ND lleva otra mezcla de IVA que la factura, la parte que da difiere
    un poco de la del neto.
  - La parte acreditada del flete no queda ni facturada ni por facturar: la
    NC la sacó.
  - En la factura de una liquidación, todas sus cargas toman la misma
    parte, así que una NC se reparte entre ellas según su flete.
  - Por cliente, el reparto del costo del viaje sigue siendo según el flete
    cargado, no según la parte facturada.
- **Resumen de cargas de la IA** (w14-s3 F2). El total de la respuesta de
  `getShipmentsSummary` deja afuera las cargas canceladas y las nombra
  aparte («N canceladas, fuera del total»), como el resto de las cifras de
  flota. Cuando hay cargas sin flete (por tarifa), lo dice: «el flete total
  no es definitivo». `ai_shipments_summary` suma las columnas
  `invoiced_freight` (flete por su parte facturada) y `unpriced`.
- **Totales de Comprobantes y Recibos** (`20261105100002`, w14-s1 F1).
  `invoice_list_totals` y `receipt_list_totals` buscan el nombre del
  cliente con la misma regla que su listado (`containsPattern`): `%`, `_` y
  `\` literales y `*` como un carácter cualquiera. La regla vive en
  `like_contains_pattern`. Los RPC siguen recibiendo el término tal como se
  escribió, así que el código anterior, después de un rollback, también
  obtiene la regla nueva.

**Alternativas descartadas.**

- Escribir la cabecera y los ítems en un solo RPC, como
  `import_arca_issued_invoice`. Es el arreglo de fondo, pero reescribe el
  alta de `issueFiscalInvoiceAction` y su manejo de errores (clave
  duplicada, guardas). Queda como pendiente. El reconciliador converge
  cualquier borrador que quede así, venga de donde venga.
- Liberar cada fuente por separado (remito, mora). Son cuatro reglas para
  el mismo estado. Fallido ya libera todas.
- Mantener el ingreso de flota sobre el flete cargado y solo marcar «no
  definitivo» la carga con una NC parcial. Así el camión y `getClientMargin`
  seguirían dando cifras distintas para la misma carga.
- Contar el neto (sin IVA), como `ai_client_net_revenue`. La regla de
  anulación compara totales. Con el neto, una NC por el total podría dejar
  una parte de unos centavos en lugar de 0.
