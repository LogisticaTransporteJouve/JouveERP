# 2026-11-04 — Errores de sueldos y lecturas que fallan (auditoría w10)

**Un error al grabar un pago de sueldo o un embargo dice lo que pasó.**
`payrollDbErrorMessage` (`features/hr/lib/payroll-payments.ts`):

- Si la base rechaza con una regla propia (hint `jouve_guard`), se muestra
  el mensaje de esa regla. Ejemplo: editar o borrar un pago cuyo movimiento
  está conciliado avisa que hay que desconciliar la línea en Tesorería ›
  Conciliación. Antes, todo rechazo `55006` decía «el período contable está
  cerrado», aunque estuviera abierto.
- El período cerrado (`guard_journal_period_closed`) sigue con el texto que
  dice qué hacer: «Reabrilo en Contabilidad o usá otra fecha.».
- Las reglas de sueldos sin hint (`23514`, por ejemplo «Los sueldos se pagan
  desde una cuenta en pesos») siguen pasando su mensaje.
- Cualquier otro error (un CHECK nativo, un timeout, una FK) muestra el
  mensaje genérico de la acción («No se pudo editar el pago.»), no el texto
  de Postgres en inglés.

**Una lectura que falla muestra el error con «Reintentar».** Antes se
quedaba cargando para siempre:

- «Facturación de almacenaje». Si no se pueden leer las facturas de
  almacenaje anteriores, «Facturar» queda deshabilitado: el diálogo
  necesita saber hasta cuándo se facturó para avisar huecos y
  superposiciones.
- «Rentabilidad de flota».
- «Flujo de caja».
- Los diálogos para eliminar un cliente o un proveedor.

En «Facturar almacenaje», si falla el cálculo del total, el diálogo lo dice
en vez de mostrar $0, y «Emitir factura» queda deshabilitado hasta
recalcular.
