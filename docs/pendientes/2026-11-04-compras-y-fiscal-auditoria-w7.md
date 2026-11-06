# Compras y fiscal, auditoría w7 (2026-11-04)

- [x] **Una edición en período cerrado no guarda la mitad**
      (`20261104140100`): `updatePurchaseInvoiceAction` pregunta a
      `purchase_items_change_refused`, la misma regla que aplica
      `replace_purchase_invoice_items`, **antes** de guardar el encabezado. Si
      los ítems no se pueden cambiar, no se guarda nada y el mensaje lo dice
      («No se guardó ningún cambio.»). Si aun así los ítems fallan después del
      encabezado (por ejemplo, alguien cerró el período en el medio), el
      mensaje dice que se guardó la factura pero no los ítems y la edición
      queda en `audit_events` con `items_saved: false`.
- [x] **Editar sin haber leído los ítems no los borra**: mientras los ítems
      cargan, o si su lectura falló, «Cargar con detalle por ítem» queda
      deshabilitado, el formulario lo avisa (con «Reintentar» si falló) y el
      guardado no manda `items`, así el servidor no los toca; un cambio de
      importes se frena hasta que carguen, para que el encabezado no deje de
      coincidir con ellos. Manda `[]` solo si la compra tenía ítems leídos y
      el usuario apagó el detalle.
- [x] **Los ítems que no se tocan conservan su neto e IVA guardados**: una
      compra aceptada de ARCA guarda el IVA de ARCA, que no siempre es
      neto × alícuota. El formulario de edición recalcula solo la línea a la
      que se le cambia cantidad, precio o alícuota; las demás (y el total del
      encabezado) quedan como estaban. Una edición de notas en un período
      abierto ya no cambia el IVA ni el total, ni devuelve el comprobante de
      ARCA a Pendientes; en un período cerrado ya no se rechaza.
- [x] **Una NC/ND cargada desde «Nueva compra» hereda la cuenta y el centro
      de su factura de origen**: al pasar el tipo a NC o ND se limpian la
      cuenta y el centro que había puesto el proveedor (si el usuario no los
      cambió), así el trigger copia los del origen.
- [x] **IA, Libro IVA Compras**: `totals.neto` es solo el neto discriminado
      (alícuotas de las A). Las B/C, con su IVA adentro, van aparte en
      `totals.sin_discriminar`, y la descripción de la herramienta lo dice.
- [x] **El CUIT de un proveedor con compras en un período cerrado no cambia**
      (`20261104140101`): el Libro IVA Compras lee el CUIT del proveedor, así
      que cambiarlo reescribía un libro «Definitivo». Se rechaza con un
      mensaje en español; reabrir el período lo permite. Desvincular los
      comprobantes de ARCA ya confirmados cuando cambia el CUIT queda para la
      sesión de ARCA.
- [x] **El comentario de `20261104132100` quedó viejo** (ya mergeada, no se
      edita): dice que volver a guardar los mismos ítems pasa porque «el
      formulario de edición siempre los manda». Hasta esta auditoría el
      formulario recalculaba el IVA de cada ítem y una compra aceptada de ARCA
      no pasaba. Lo vigente está en este archivo y en
      [la decisión](../decisions/2026-11-04-compras-edicion-en-periodo-cerrado-auditoria-w7.md). — ya no aplica: nota sobre el comentario de una migración mergeada, que no se edita; lo vigente está en la decisión enlazada.
- [x] No verificado contra una base real: las migraciones y sus pgTAP
      (`purchase_items_change_check_test.sql`,
      `supplier_cuit_closed_period_test.sql`) no se corrieron acá. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
