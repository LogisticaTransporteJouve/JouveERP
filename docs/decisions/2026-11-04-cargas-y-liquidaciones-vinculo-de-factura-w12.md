# 2026-11-04 — Una sola regla de factura anulada para cargas, liquidaciones y almacenaje (w12)

**Decisión.** Auditoría w12, frente S1 (w12-s5 F1–F3, w12-s2 F1–F2, w12-s1
F1, w12-s4 F2). Sigue la
[decisión w11](2026-11-04-tesoreria-vinculos-de-facturacion-auditoria-w11.md):
una factura deja de facturar lo que facturaba cuando falló, se anuló, o es
fiscal y sus NC emitidas suman su total. Ahora esa regla es una sola
(`billing_invoice_is_void`) y vale igual para una carga, una liquidación de
fletes y un período de almacenaje.

- **Una regla** (`20261104194000`). `billing_invoice_is_void` tiene la regla
  que `storage_invoice_is_void` introdujo en w11. `storage_invoice_is_void`
  queda como envoltorio, para no tocar a quienes lo llaman. En la app,
  `lib/source-invoice-key.ts` usa la misma regla para elegir la clave de la
  próxima factura y para decidir si libera una reserva.
- **Carga facturada sola, con su factura fiscal acreditada por el total**
  (`20261104194000`). Antes la carga quedaba facturada para siempre: no se
  podía volver a facturar, editar ni borrar, y la guarda le decía al usuario
  que la NC la liberaba. Ahora:
  - la reserva de «Facturar flete» (`claim_shipment_for_invoicing`)
    desvincula esa factura antes de reservar, como la reserva de almacenaje
    borra sus períodos anulados. El desvínculo queda en la auditoría
    (`shipment.invoice_unlinked`);
  - la carga se puede corregir o borrar antes de volver a facturarla. El
    mensaje de la guarda dice qué la libera: anular la factura si es
    interna, o emitir una NC por el total si es fiscal;
  - una factura acreditada por el total no se vuelve a vincular, y la
    próxima factura sale con la clave siguiente;
  - la lista de cargas deja de mostrar «Facturado» y vuelve a ofrecer
    «Facturar flete».
- **Por qué en la reserva y no al emitir la NC.** Es el mismo mecanismo que
  almacenaje, y no agrega un escritor más sobre `shipments.invoice_id`.
  Hasta la próxima «Facturar flete», la carga sigue apuntando a la factura
  acreditada (ver pendientes).
- **Una carga facturada no suelta su factura** (`20261104194000`). Como un
  período de almacenaje: `invoice_id` cambia solo si la factura anterior ya
  no existe o ya no factura la carga. Solo owner, admin, finance o el
  service role vinculan una factura. Operaciones edita cargas, pero no
  cambia su facturación por PATCH.
- **Una NC interna no libera una liquidación** (`20261104194000`). Un remito
  interno se libera anulándolo; su NC se puede anular después, y el remito
  volvería a facturar cargas ya liberadas. Es la regla que almacenaje ya
  seguía.
- **La auditoría de re-vínculos de almacenaje** (`20261104194001`). La
  reserva devuelve los períodos que re-vinculó
  (`claim_storage_billing_period_with_relinks`), y solo esos llevan
  `storage.invoiced` con `relinked`. Un período vinculado por el camino
  normal en otra pestaña ya no se marca como re-vinculado.
  `claim_storage_billing_period` queda como envoltorio con la misma firma.
