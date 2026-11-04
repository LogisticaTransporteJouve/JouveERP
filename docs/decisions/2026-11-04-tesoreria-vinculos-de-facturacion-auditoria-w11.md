# 2026-11-04 — Vínculos de facturación de fletes y almacenaje, y marca de importación de cheques (w11)

**Decisión.** Auditoría w11 (S5 F1–F2, S2 F1, S7 F4, S4 F3–F4, S8 F4). Sigue
la [decisión w10](2026-11-04-tesoreria-prestamos-y-almacenaje-auditoria-w10.md):
un vínculo lo pone solo el camino que lo valida, y ninguna escritura directa
lo cambia después.

- **Carga y su factura** (`20261104190000`). Una carga se vincula solo a una
  factura de su cliente que no falló ni se anuló. El trigger bloquea la
  factura (`for share`), como el de almacenaje. Antes, si la factura fallaba
  entre la emisión y el vínculo, `release_invoice_billing_links` ya había
  corrido sin encontrar la carga, y la carga quedaba facturada para siempre:
  no se podía facturar, editar ni borrar. Ahora el vínculo se rechaza y
  «Facturar flete» libera la reserva de la carga y lo avisa.
- **Factura fiscal de almacenaje anulada con NC** (`20261104190001`). Una
  factura fiscal se deshace con una nota de crédito, nunca se anula. Si sus
  NC emitidas suman su total (con 0,01 de tolerancia), su período de
  almacenaje queda libre. Es la misma prueba que usa una liquidación de
  fletes. La regla vive en `storage_invoice_is_void` y la usan:
  - la reserva: no re-vincula una factura huérfana anulada así, y borra los
    períodos del cliente cuya factura ya no los factura antes de mirar la
    superposición;
  - la guarda de borrado: deja borrar ese período. El mensaje ahora dice
    qué lo libera: anular la factura si es interna, o emitir una NC por el
    total si es fiscal;
  - el historial (`storage_billing_void_run_ids`): esos períodos no cuentan
    como facturados en el diálogo ni en «Facturado hasta».
- **Por qué solo las fiscales.** Una factura interna se libera anulándola.
  Una NC interna se puede anular después, y la factura volvería a estar
  vigente con su período ya borrado. Por eso las NC de una factura interna no
  liberan el período.
- **Un período facturado no suelta su factura** (`20261104190001`). Una vez
  puesto, `invoice_id` no se borra ni se cambia por PATCH. Solo pasa a null
  cuando se borra la factura (el `set null` de la FK). Antes, desvincular
  primero y borrar después liberaba un período facturado por código anterior
  a `160002`, que emitía con una clave al azar.
- **Marca de importación de un cheque** (`20261104190002`). La pone solo
  `commit_import_run` al cargar el cheque, y ningún UPDATE la cambia. De esa
  marca depende Resultado de gestión (caja): el ingreso y el rechazo de un
  cheque importado son neutros. Un PATCH de finance podía volver neutro el
  rechazo de un cheque de un cliente, o sacar de ingresos un cheque cargado a
  mano. La regla es la de préstamos (`guard_loan`), pero en un trigger
  propio: así un pgTAP que carga a mano un cheque importado apaga solo esta
  regla.
- **Auditoría del re-vínculo**. La acción registra el `storage.invoiced` que
  faltaba después de toda reserva, no solo cuando la reserva devuelve null.
  La reserva re-vincula cualquier período del cliente, de cualquier canal,
  así que facturar febrero podía re-vincular enero sin dejar evento. La
  búsqueda saltea las facturas que ya tienen el suyo.
- **Diálogo «Facturar almacenaje»**. Muestra solo los canales del lado del
  cliente (fiscal para Ventas, interno para Otras ventas) y preselecciona el
  único que queda, como el de liquidaciones de flete. Antes, el canal del
  otro lado fallaba siempre, y se enteraba recién después de la reserva.

**Rollback.** El código anterior llama a la reserva con la misma firma, nunca
cambia la factura de un período ya vinculado, y escribe la marca de cheques
solo desde el importador. Si el vínculo de una carga se rechaza, el código
anterior lo informa como «no se vinculó» y conserva la reserva 15 minutos.
Después, «Facturar flete» emite con la clave siguiente, porque la de la
factura fallida queda salteada. El diálogo anterior no lee
`storage_billing_void_run_ids`: muestra como facturado un período con NC
total hasta que la próxima reserva del cliente lo borre.
