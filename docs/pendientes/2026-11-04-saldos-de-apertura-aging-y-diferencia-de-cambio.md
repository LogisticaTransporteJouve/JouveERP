# Saldos de apertura, aging y diferencia de cambio (2026-11-04, auditoría w1)

- [x] **Saldo de apertura de proveedor** (`20261104094100`): salda el saldo
      real al corte (facturas y ND − NC − OP emitidas, en pesos) menos el
      objetivo; el FIFO va sobre lo que dejan OP y NC. Antes ignoraba OP y NC.
- [x] **Saldo de apertura de cliente** (mismo archivo): el FIFO salta lo que ya
      acreditó una NC y los comprobantes USD no entran en un saldo en pesos.
- [ ] Los saldos de apertura ya cargados no se recalculan: el owner los vuelve
      a aplicar para corregirlos.
- [x] **NC sin origen en el aging** (`20261104094200`): su crédito se reparte
      sobre los comprobantes abiertos del cliente (mismo canal y moneda, del más
      vencido al más nuevo), así aging, saldo por ámbito, fotos del aging, mora,
      tareas y herramientas de IA coinciden con la cuenta corriente. El tope de
      una NC con origen lee `invoice_open_amount` (lo que debe ese comprobante).
- [ ] Mora: el crédito de una NC sin origen baja la base de todo el período
      (no desde su fecha). Cobra de menos, nunca de más.
- [ ] El crédito de NC sin origen que supera lo abierto no se muestra en el
      aging (la cuenta corriente sí lo muestra).
- [x] **Diferencia de cambio** (`20261104094000` + `094300`): recibo USD contra
      factura/ND USD, NC USD contra su origen y OP USD contra compra USD a otra
      cotización van a la cuenta con rol `diferencia_cambio` (4.2.x
      "Diferencias de cambio"); clientes y proveedores quedan en 0 en pesos.
      Sin cuenta activa con ese rol se asienta como antes.
- [ ] Diferencia de cambio pendiente: NC de compra USD a otra cotización que
      su factura, NC de venta sin origen, y documentos USD cuya cotización no se
      conoce (asentados 1:1). Los asientos en períodos cerrados conservan el
      asiento viejo (el backfill los cuenta en un NOTICE).
- [ ] Cambiar `invoice_origin_id` de una NC emitida no re-asienta su diferencia
      de cambio (hoy ningún flujo lo cambia).
- [ ] Resultado de gestión: la cuenta "Diferencias de cambio" no tiene caja
      asignada, así que aparece en "Sin clasificar" hasta que el owner la
      clasifique.
- Aprobación de `20261104094000`–`20261104094300` y vista previa del
  backfill de `094300`: en **Antes de promover**.
