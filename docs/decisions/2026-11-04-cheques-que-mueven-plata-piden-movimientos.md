# 2026-11-04 — Los cheques que mueven plata piden movimientos

**Decisión.** Aplica a todo cheques la decisión del owner
[«Lo de RRHH y cheques que mueve plata pide movimientos»](2026-11-04-lo-de-rrhh-y-cheques-que-mueve-plata-pide-movimientos.md),
que antes solo cubría pagar la deuda de un cheque vendido rechazado. Piden
`transactions:write` además de `cheques:write`:

- cargar un cheque a mano y crearlos desde el escaneo IA (entran a la cartera);
- depositar, acreditar, rechazar y vender;
- anular una venta (borra sus movimientos);
- pagar la deuda de un cheque vendido rechazado.

La acción y su botón comparten la lista `CHECK_CASH_PERMISSIONS`
(`features/checks/lib/check-cash.ts`, antes `check-sale-cash.ts`). En la
tabla de cheques los botones se ocultan y una línea dice por qué; «Pagar»
queda deshabilitado con el motivo.

**Fuera.** Rechazar un cheque vendido como deuda del comprador no mueve plata
y sigue con `cheques:write`. En la pantalla solo se ofrece dentro de
«Rechazar», que pide los dos.

**Acreditar** no escribe un movimiento (solo cambia el estado), pero confirma
la plata en el banco. Se pide igual, para que las acciones de la fila sigan
una sola regla.

**Matriz.** No cambia: todo rol con `cheques:write` tiene `transactions:write`.
Cambia lo que frena una denegación por usuario de `transactions:write`.
