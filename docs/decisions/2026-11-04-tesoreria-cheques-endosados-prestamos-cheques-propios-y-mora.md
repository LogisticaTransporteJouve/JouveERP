# 2026-11-04 — Tesorería: cheques endosados, préstamos, cheques propios y mora (auditoría)

**OP con un cheque endosado rechazado.** Anular o editar la OP se rechaza
(`jouve_guard`) mientras uno de sus cheques endosados ya no esté `endosado`;
al anular o editar solo vuelve a cartera un cheque que sigue `endosado`.
Descartado: devolverlo a cartera y revertir el rechazo, porque la deuda ya
volvió al cliente y el asiento del rechazo existe.

**Cuota sin desglose.** Si el pasivo está asentado (desembolso o importación),
la cuota paga primero capital: lo que le queda al capital después de las
cuotas anteriores, hasta lo pagado; el resto es interés. Coincide con el
`capital_outstanding` de la pantalla y con el resultado de gestión. Descartado:
rechazar el desembolso mientras haya cuotas sin desglose (el cronograma por
defecto no tiene desglose y sería bloquear el caso común).

**Anular un préstamo.** Se rechaza si tiene el desembolso registrado o alguna
cuota pagada (`guard_loan`), y el desembolso no cambia una vez cargado. Sin
camino de deshacer: un préstamo con plata se cierra pagándolo. Descartado: un
RPC que borre desembolso y cuotas, porque toca períodos y conciliaciones.

**Cheque propio cargado a mano.** Su cobro es el pago: Debe gasto del
proveedor (o `gastos`) / Haber banco, en pesos (USD a la cotización del día
del cobro). Fuera de `emitted` no cambia importe,
moneda ni cuenta, y una OP se le liga solo cargándolo desde la OP.

**Mora.** El prorrateo cuenta solo las NC emitidas, las mismas que resta
`v_aging_documents`.

**Listados de cheques.** Se listan completos los que se operan (en cartera y
depositados; propios emitidos) y los 500 más recientes del resto, con aviso
si quedaron afuera.
