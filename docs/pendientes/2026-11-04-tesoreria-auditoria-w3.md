# Tesorería: auditoría w3 (2026-11-04)

- [x] **Cheque propio de una OP que rebota** (`20261104110600`): el rechazo
      devuelve en Caja el egreso de la OP (ingreso en el banco del cheque, en
      la fecha del rechazo, sin asiento propio). Antes, pagar la deuda con
      una OP nueva sacaba la plata del banco dos veces.
- [x] Una OP con un cheque propio anulado por fuera de ella no se anula ni
      se edita (la deuda volvería dos veces). Anular solo el cheque de una OP
      viva ya lo rechaza la base desde `20261102210000`.
- [x] El PDF, el detalle y la edición de una OP cuentan lo que imputó a
      cheques rechazados ("Cheque rechazado …"), y "A cuenta" lo excluye.
      Editar por debajo de eso se rechaza con un mensaje en castellano.
- [x] Pagar una cuota, registrar el desembolso y vincular un egreso a una
      cuota piden también `transactions:write`; sin él, el detalle del
      préstamo no muestra esos botones.
- [x] El dashboard muestra los cheques en cartera en USD aparte de los de
      pesos.
- [x] Conciliación: la explicación de la diferencia cuenta solo los
      movimientos de libros hasta la fecha del último saldo del extracto, y
      lo dice cuando esa fecha no es el fin del período.
- [x] El aviso de "Imputar" una OP o un recibo en USD dice US$.
- [ ] El movimiento que devuelve el egreso de un cheque propio rechazado,
      si se intenta borrar desde Caja, dice que es "el cobro de un cheque
      propio" (el guard de borrado nombra igual a los dos).
- [ ] Un cheque propio USD de una OP que rebota vuelve en Caja en dólares;
      Gestión en percibido valúa la OP a su cotización y el ingreso a la del
      día del rechazo, así que queda la diferencia entre las dos.
- [x] No verificado contra una base real: la migración y su pgTAP
      (`issued_check_rejection`, `supplier_rejected_checks`). — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
