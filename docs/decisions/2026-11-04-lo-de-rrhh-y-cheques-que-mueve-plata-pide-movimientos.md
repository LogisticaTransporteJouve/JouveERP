# 2026-11-04 — Lo de RRHH y cheques que mueve plata pide movimientos

**Decisión (owner).** Toda acción de RRHH o de cheques que mueve o borra
tesorería pide `transactions:write` además de su permiso: los pagos de
planilla (individual, masivo, editar, borrar), borrar un movimiento de la
cuenta corriente del empleado que tiene movimiento de caja y pagar la deuda
de un cheque vendido rechazado. Cada una comparte con su botón la lista
(`features/hr/lib/hr-cash.ts`, `features/checks/lib/check-sale-cash.ts`): el
botón se oculta o queda deshabilitado con el motivo.

**Matriz.** No cambia. Los roles con `hr:write` (owner, admin, finance) y con
`cheques:write` (los mismos) ya tienen `transactions:write`: ningún rol tiene
`hr:write` sin `transactions:write`. Lo que cambia es una denegación por
usuario de `transactions:write`, que antes no frenaba estas acciones.

**Descartado.** Pedirlo en la base (RLS o RPC): las denegaciones se aplican en
la app y la base aplica el techo del rol, que ya incluye los dos permisos.
