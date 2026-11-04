# 2026-11-04 — Sueldos, préstamos y almacenaje: los vínculos que faltaban (w10)

**Decisión.** Auditoría w10 (S2 F1–F3, S4 F1–F2, S5 F1, S8 F1). Sigue la
[decisión w9](2026-11-04-tesoreria-sueldos-prestamos-y-almacenaje-auditoria-w9.md):
un vínculo lo pone solo el camino que lo valida, y ninguna escritura directa
lo cambia después.

- **Pago de sueldo** (`20261104170000`). Además del movimiento, la
  liquidación (`entry_id`) queda fija desde el alta. Antes, un PATCH pasaba
  el pago a la liquidación de otro empleado o de otro mes: la primera volvía
  a figurar impaga y «Pagar» la pagaba de nuevo, mientras el egreso en Caja
  seguía con el nombre y el mes del primero.
- **Préstamo importado** (`20261104170001`). `import_run_id` lo pone solo
  `commit_import_run` al cargar el préstamo, y ningún UPDATE lo cambia. De
  esa marca dependen el bloqueo de las condiciones y el asiento de cada
  cuota: con la marca, la cuota sin desglose baja el pasivo `prestamos`;
  sin ella, va entera a gasto. Borrarla liberaba las condiciones, y
  ponérsela a un préstamo manual bajaba un pasivo que nunca se acreditó.
- **Cuota** (`20261104170001`). Una cuota no pasa a otro préstamo, y una
  cuota pagada no cambia de número. Antes, mover la cuota pagada a otro
  préstamo la escondía de `guard_loan`: el préstamo se podía anular, borrar
  o cambiar de capital, y después la cuota volvía. El número fija qué cuotas
  son «anteriores» al calcular el capital de una cuota sin desglose.
- **Período de almacenaje** (`20261104170002`). Un período con una factura
  vigente no se borra. Vale tanto para la factura vinculada como para la
  emitida bajo el id de su reserva y nunca vinculada, que es la que la
  próxima reserva vincularía. Antes, borrar la fila liberaba los días y
  «Facturar» emitía un segundo CAE. Lo siguen borrando sus caminos: la
  reserva vencida sin factura viva, la acción cuando la emisión falla, y
  `release_invoice_billing_links` cuando la factura falla o se anula.
- **Diálogo «Facturar almacenaje»**. Sigue la regla del servidor:
  - Una reserva pendiente (sin factura vinculada) no cuenta como facturada,
    y la superposición se mira por canal. Así se llega a «Facturar» el
    mismo período pasados 15 minutos, como pide el mensaje de vínculo
    perdido. La reserva vincula la factura huérfana o, si esa factura falló
    o se anuló, libera el período y lo factura de nuevo.
  - Si hay una reserva pendiente, el diálogo lo avisa sin bloquear el botón.
  - «Facturado hasta» cuenta solo los períodos con factura.
- **Auditoría del re-vínculo**. Cuando la reserva vincula una factura que
  había quedado huérfana, la acción registra el `storage.invoiced` que el
  vínculo perdido no llegó a escribir, con `relinked: true`. Si el evento ya
  existe, no lo repite.

**Por qué un período pendiente no se bloquea en el diálogo.** Solo el
servidor sabe si la reserva sigue fresca, si su factura salió o si falló. El
diálogo deja decidir a la reserva. Una reserva fresca se rechaza con el
mensaje de período ya facturado, que ya está en castellano.

**Por qué la auditoría busca el evento que falta.** La reserva devuelve null
sin decir qué período vinculó, y cambiar su firma rompería el rollback. Un
período vinculado se reconoce porque su factura tiene como clave el id de la
reserva y todavía no tiene su `storage.invoiced`.

**Rollback.** El código anterior no actualiza `entry_id` ni
`import_run_id`, no mueve ni renumera cuotas, y borra solo reservas sin
factura viva. El diálogo anterior ignora `channel_id` y `pending_since`, y
sigue bloqueando un período pendiente, como antes.
