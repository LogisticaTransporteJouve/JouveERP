# 2026-11-04 — Cheque propio de una OP que rebota: vuelve a Caja

**Decisión.** Cuando el banco rechaza un cheque propio que entregó una OP, el
mismo `update` escribe un ingreso en la cuenta bancaria del cheque, por su
importe y en la fecha del rechazo, con `issued_check_id`
(`issued_check_rejected_inflow`, `20261104110600`). No asienta: el asiento
del rechazo ya devuelve la deuda (Dr cheques diferidos / Cr proveedores) y el
banco nunca se acreditó en el diario. Es el espejo de
`issued_check_cashed_outflow`. La OP de un cheque anulado por fuera de ella
(filas previas a `20261102210000`) no se anula ni se edita.

**Por qué.** La OP saca la plata del banco en Caja al emitirse. Si el cheque
rebota, la plata no salió; pagar la deuda con una OP nueva (el camino de
#351) la sacaba otra vez.

**Descartado.** Borrar el egreso de la OP (la OP sigue emitida y sus otros
medios de pago sí salieron); cargar el ingreso a mano.
