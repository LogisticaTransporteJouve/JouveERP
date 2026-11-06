# Tesorería: guardas de documentos y cheques, auditoría w7 (2026-11-04)

Ver [la decisión](../decisions/2026-11-04-tesoreria-documentos-escritos-por-sus-rpc.md).

- [x] **Un cheque propio sale de «emitido» una sola vez** (`20261104140000`).
      Un PATCH de un cheque cobrado a «emitido», o de cobrado a rechazado,
      se rechaza. Antes, en un cheque cobrado de una OP, volverlo a
      «emitido» y cobrarlo otra vez duplicaba el asiento, y rechazarlo
      registraba un ingreso al banco. Pasarlo de cobrado a rechazado creaba
      deuda con el proveedor.
- [x] **La cabecera de un recibo o de una OP cambia solo por su RPC**
      (`20261104140001`). Un documento anulado no vuelve a emitido. El
      monto, el cliente o proveedor, el canal, la fecha y el número cambian
      solo al editar el documento. Antes, reemitir un recibo anulado volvía
      a acreditar al cliente sin ingreso en Caja.
- [x] **Las líneas de pago y las retenciones las escribe su documento**
      (`20261104140002`). Antes, una línea agregada a mano a una OP hacía
      que el proveedor debiera un cheque rechazado ajeno. Una línea movida
      a otra OP devolvía el cheque a la cartera al anularla.
- [x] **Depositar un cheque va solo a un banco activo de su moneda**
      (`20261104140003`). Antes se podía «depositar» en otra cartera o en la
      propia.
- [x] **Un cheque se carga solo en una cartera**: lo validan
      `createCheckAction` y la base.
- [x] **El movimiento «recibido» inicial** toma de la base su fecha de alta,
      su autor y la fecha de emisión del cheque. Un «recibido» fechado en el
      futuro ya no bloquea «Anular venta».
- [x] **Editar cuota** rechaza un total de $0, también con el desglose:
      todo vacío pide «Monto requerido.», y un desglose que suma 0 dice que
      el monto tiene que ser mayor a 0. El servidor rechaza el monto 0 y un
      desglose que suma 0.
- [x] No verificado contra una base real: las cuatro migraciones y sus
      pgTAP. Son `treasury_document_guards` y los fixtures adaptados de
      `checks_channel`, `fx_difference`, `journal_document_entry`,
      `journal_reverse`, `receipt_retentions`, `otras_ventas_sides` y
      `otras_ventas_settlement_freeze`. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
- [ ] Fuera de alcance: las asignaciones de recibos y OP
      (`receipt_allocations`, `payment_order_allocations`,
      `receipt_rejected_check_allocations`) siguen abiertas a escritura
      directa bajo RLS. Las escriben sus RPC (`create_*`, `update_*`,
      `allocate_payment_order`) y ya tienen guardas de tope y de canal.
