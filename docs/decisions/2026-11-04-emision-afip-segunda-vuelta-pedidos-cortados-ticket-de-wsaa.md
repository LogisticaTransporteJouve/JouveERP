# 2026-11-04 — Emisión AFIP, segunda vuelta: pedidos cortados, ticket de WSAA y CAEA

**Pedido cortado.** Con el límite de 20 s, un `FECAESolicitar` que se corta
de nuestro lado puede seguir procesándose en AFIP, que mientras tanto contesta
"no registrado". El `onFailure` de `issue-invoice` ya no marca fallido un
comprobante con un número enviado hace menos de 30 min (`STUCK_AFTER_MS`)
salvo que el último error sea no reintentable (un rechazo de AFIP): lo deja en
`emitting` y lo decide `issue-invoice-reconcile`. Descartado: leer `timedOut`
del error, porque el error que llega al `onFailure` es el del último intento
(puede ser un error de la base después de un intento cortado).

**Aviso al remito.** `recoverOnFailure` ya no manda el evento; devuelve si el
comprobante quedó emitido con remito y el que llama lo manda en un paso propio
(`step.sendEvent`), también cuando un intento anterior ya lo había emitido.

**Ticket de WSAA.** El ticket nuevo queda en memoria primero (AFIP no da otro)
y se guarda en `afip_ta_cache` con dos reintentos; si no se guarda, el paso
falla como reintentable y el próximo uso vuelve a intentar guardarlo antes de
usarlo. Un error al leer la tabla es reintentable, no "no hay ticket", y un
`alreadyAuthenticated` vuelve a leer la tabla (otra instancia pudo guardarlo).

**CAEA "sin movimiento".** `emit_caea_invoice` rechaza un CAEA ya informado
sin movimiento para el punto de venta, y `caea-inform` no lo informa mientras
haya un borrador de ese punto de venta con fecha dentro de la vigencia.
Descartado: rechazar toda emisión después del fin de la vigencia, porque no
está claro que AFIP rechace un comprobante generado fuera de la quincena con
fecha dentro de ella.

**Cotización y totales.** Un comprobante fiscal en dólares con cotización 1
se rechaza en la base (solo al insertar o al cambiar moneda o cotización: las
filas existentes no se tocan). El total del listado de Comprobantes suma solo
los emitidos; la cantidad sigue contando todas las filas, porque rotula el
grupo de filas listadas.
