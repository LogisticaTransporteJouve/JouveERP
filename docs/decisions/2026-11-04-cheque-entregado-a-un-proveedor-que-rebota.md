# 2026-11-04 — Cheque entregado a un proveedor que rebota

**Decisión.** Un cheque que una OP emitida le entregó al proveedor (de
terceros endosado o propio) y que el banco rechaza es deuda con el
proveedor otra vez, como lo es un cheque rechazado de un cliente del otro
lado: `v_supplier_rejected_check_open` lo lista, la cuenta corriente suma
una fila "Cheque rechazado" en la fecha del rechazo, y el aging lo trae
como documento (`document_type = 'rejected_check'`). La OP original no se
toca (sus facturas siguen pagadas; el asiento del rechazo ya devolvió
proveedores). Se paga con una OP nueva a cuenta e "Imputar" → "Cheques
rechazados", que imputa en `payment_order_rejected_check_allocations`
(FIFO por fecha de rechazo; la base revisa proveedor, canal, moneda y
saldo). Los cheques USD se asientan a la cotización de la OP que los
entregó.

**Por qué.** Desde #343 la OP con un cheque rechazado no se anula ni se
edita, y cargar una ND de compra acreditaba proveedores por segunda vez: la
deuda estaba en el mayor y en ningún otro lado. Imputar desde el saldo a
cuenta reutiliza el flujo que ya existía para las facturas.

**Descartado.** Permitir anular la OP (revierte su asiento sobre el del
rechazo y duplica la deuda); imputar el cheque al crear la OP (cambia la
firma de `create_payment_order` y el formulario; queda pendiente).

**También.** El crédito de las NC de compra sin origen se reparte en el
aging por documento por proveedor, canal y moneda, como en clientes
(#344), y los totales dejan de restarlo aparte: antes se compensaba entre
canales en los totales y no aparecía en el flujo de caja. Moneda, tipo y
saldo inicial de una cuenta con movimientos quedan fijos; el saldo se
corrige con el ajuste con fecha.
