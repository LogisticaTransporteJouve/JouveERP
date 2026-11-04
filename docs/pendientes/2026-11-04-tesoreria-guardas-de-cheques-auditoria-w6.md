# Tesorería: guardas de cheques, auditoría w6 (2026-11-04)

- [x] **Un cheque de terceros entra solo como cargado a mano o desde su
      recibo** (`20261104130000`): `guard_check_edit` corre también en
      INSERT. Fuera de `create_receipt` / `update_receipt`, un cheque nuevo
      tiene que ser manual, en cartera y sin recibo: lo que cargan «Nuevo
      cheque», el escaneo IA y el importador, y lo que `checks_manual_inflow`
      registra en la cartera. Antes, un POST por PostgREST creaba un cheque
      «de recibo» o ya depositado sin ingreso a la cartera; depositarlo movía
      plata que nunca entró y rechazarlo reabría deuda en un recibo que no lo
      cobró. `createCheckAction` ya no acepta `source_kind = "receipt"` ni
      `source_receipt_id`.
- [x] **El origen de un cheque queda fijo**: la misma guarda rechaza cambiar
      `source_kind`, `source_client_id` y `source_payment_line_id` fuera de
      las RPC del cheque. La cuenta corriente del cliente acredita (y en un
      rebote debita) por esas columnas; un PATCH pasaba el pago a otro
      cliente o contaba dos veces el cheque de un recibo.
- [x] **El historial del cheque lo escriben sus acciones**
      (`guard_check_movement`): `check_movements` acepta escrituras solo de
      las RPC de cheques, recibos e importador y de las cascadas (anular una
      OP o una venta, borrar el cheque). Lo único directo es el movimiento
      «recibido» que «Nuevo cheque» agrega, y solo como primer movimiento del
      cheque, sin cuenta ni transacción. Antes, un movimiento «depositado»
      falso hacía que el rechazo saliera de otra cuenta.
- [x] **Cobrar o rechazar un cheque propio e importar cheques piden
      movimientos.** Ver
      [la decisión](../decisions/2026-11-04-cheques-propios-e-importacion-de-cheques-piden-movimientos.md).
- [x] **Editar cuota**: dejar el monto vacío ya no guarda una cuota de 0;
      pide «Monto requerido.».
- [ ] No verificado contra una base real: la migración y sus pgTAP
      (`check_insert_movements_guard` y los fixtures adaptados de
      `checks_channel`, `rejected_check_receivable` y `otras_ventas_sides`).
- [ ] Fuera de alcance: un INSERT directo de un cheque manual todavía puede
      traer `import_run_id` de otra corrida, y entonces deshacer esa
      importación lo borra junto con su ingreso. No mueve plata de más, pero
      la corrida no lo creó.
