# Liquidación R y rendiciones (2026-11-03, roadmap 4.3 + 4.5)

- [x] **Liquidaciones** (`/liquidaciones`, `invoices:read`, edición con
      `invoices:issue`): cliente + período + cargas entregadas, a su flete o a
      la tarifa de **flete** del cliente (concepto nuevo del tarifario, por
      carga, en pesos). Borrador → confirmada (número `R-…`) → facturada con
      **una** factura por `issueFiscalInvoiceAction`. PDF del documento R. Una
      carga en una sola liquidación viva; mientras tanto no se factura sola.
      Factura fallida o anulada → vuelve a confirmada; cancelar una facturada
      pide la factura anulada o acreditada por NC por el total.
- [x] **Cobranza contra entrega** en la carga (`cod_amount`, en el diálogo
      de la carga) y **Rendiciones** (`/rendiciones`, `receipts:read`, edición
      con `receipts:write`): pendientes por chofer, rendición con lo entregado
      por carga (cuenta, importe, cheque) y diferencias; confirmar emite un
      recibo por cliente y canal (caja, bancos o cartera) imputado a la
      factura de cada carga. Idempotente; cancelar pide los recibos anulados.
- [x] Aprobar las migraciones `20261103090000_freight_settlements` y
      `20261103090100_cod_driver_settlements` junto con el deploy (dependen de
      `20261103080000`/`20261103080100`, PR #318): sin ellas fallan el listado
      de cargas (`cod_amount`), `/liquidaciones` y `/rendiciones`. — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [x] Un rollback a código anterior con tarifas de flete cargadas hace fallar
      la facturación de almacenaje de ese cliente (el código viejo rechaza un
      concepto que no conoce). — ya no aplica: la migración está en `production-latest` (`bbe08b38`): un rollback vuelve a un SHA que ya tiene ese código.
- [ ] Editar desde Recibos un recibo de una rendición no la actualiza: la
      rendición lo marca ("recibos cambiados en Recibos") y no deja asentar
      la diferencia; no se recalcula sola. Se detecta por el total del
      recibo: un cambio de cuenta con el mismo total no se marca.
- [x] El faltante asentado al chofer y la factura del cliente: desde
      `20261104095300` "a cargo del chofer" salda al cliente con un recibo
      (#345). Las diferencias asentadas antes quedan para reparar a mano: ver
      "Diferencias asentadas al chofer antes de `20261104095300`" en
      Auditoría RRHH y rendiciones.
- [ ] Liquidar período con "confirmar" deja las de Otras ventas confirmadas:
      el remito interno X se emite una por una (cada una es un comprobante).
- [x] **Remito R / remito interno X** (`20261104030000_freight_settlements_remito_r`):
      la liquidación sigue el lado del cliente. Ventas: confirmar emite el
      **Remito R** (`R9002-…`, correlativo propio) y después se factura la
      A/B. Otras ventas: "Emitir remito interno" confirma y emite el remito
      interno X (`X9001-…`), sin R. Las confirmadas antes conservan su `R-…`.
- [ ] El Remito R no imprime CAI ni su vencimiento (RG 1415, comprobante
      impreso): cargar el CAI del punto de venta 9002 cuando se tramite, y
      confirmar con el contador que 9002 es el punto de venta habilitado.
- [ ] Borrar `confirm_freight_settlement(uuid, uuid)` (numeración `R-…`) una
      vez que no quede código desplegable que la llame.
