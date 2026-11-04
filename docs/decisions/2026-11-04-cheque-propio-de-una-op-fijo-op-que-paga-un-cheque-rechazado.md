# 2026-11-04 — Cheque propio de una OP fijo; OP que paga un cheque rechazado en Gestión

**Decisión.** Un cheque propio que emitió una OP queda fijo a esa OP: la base
(`guard_issued_check_edit`) rechaza cambiarle la OP, el monto, la moneda o la
cuenta; se cambian editando la OP, que borra y vuelve a crear sus cheques.

En Gestión (percibido), la parte de una OP imputada a un cheque rechazado
toma las proporciones de empleado, flota y neutro de la OP que entregó ese
cheque (`issued_checks.payment_order_id` para uno propio; la OP no anulada
cuya línea tiene el endosado). Las calcula `management_payment_order_shares`,
que sigue la cadena hasta 3 OP hacia atrás.

**Por qué.** Los triggers de cobro, rechazo y asiento leen las columnas del
cheque; sin la guarda, un PATCH por PostgREST hacía que la plata contara dos
veces. En Gestión, la OP nueva caía entera en Proveedores aunque pagara una
compra neutra, de flota o a cargo de un empleado.

**Descartado.** Leer el importe de la línea de la OP en cada trigger (más
cambios para el mismo efecto); seguir la cadena sin límite (una OP imputada a
su propio cheque rechazado no termina).
