# Resultado de gestión v2 (2026-11-03, roadmap 3.7)

- [x] **Detalle de cada cifra:** cada número de la tabla mes a mes abre los
      documentos que lo forman (`get_management_pnl_documents`), con link a
      cada uno si el usuario lee su módulo; suma lo mismo que la cifra.
- [x] **Percibido:** cobros de bienes de uso, pagos de compras de flota,
      pagos de compras a cargo de empleados y adelantos fuera del margen
      operativo, según lo que imputó cada recibo / OP; cuotas con desglose
      en capital e intereses.
- [x] **Compras a cargo de empleados y adelantos** fuera del costo operativo
      en las dos bases (el costo entra con el descuento de planilla).
- [x] **Indicadores:** margen operativo %, resultado operativo (EBITDA
      aprox.), generación de caja y variación contra el mismo período del
      año anterior.
- [x] **Exportar CSV / Excel** de la tabla mes a mes (uso interno, auditado).
- [x] IA: `getManagementPnL` con indicadores y `getManagementPnLDocuments`.
- [x] **Cheques en percibido** (`20261104092000`): un cheque de terceros
      importado al arranque (`checks.import_run_id`) es una partida de
      apertura (su ingreso a cartera y su rechazo no cuentan); el egreso de
      un cheque rechazado (débito del banco, devolución al comprador) resta
      de Servicios lo que el cheque había sumado.
- [ ] **Cheque endosado rechazado, en percibido:** el rechazo no mueve caja, así que el cobro
      original sigue en Servicios y el pago con ese cheque en proveedores; cuando el cliente
      vuelve a pagar y se le vuelve a pagar al proveedor, los dos cuentan dos veces.
- [x] **Pendiente en USD, devengado:** un movimiento fiscal en dólares queda
      pendiente mientras no tiene asiento, aunque después se cargue una
      cotización con fecha anterior (antes no estaba ni en pesos ni en
      pendiente hasta re-asentarlo).
- [ ] Re-asentar solo los movimientos `sin_cotizacion` al cargar una
      cotización: hoy esperan al re-asiento del paquete mensual
      (`journal_missing_entries`), y mientras tanto Gestión los muestra
      pendientes.
- [ ] **Percibido a cuenta:** lo cobrado o pagado sin imputar va a servicios /
      pagos a proveedores aunque después se impute a un bien de uso o a una
      compra a cargo de un empleado.
