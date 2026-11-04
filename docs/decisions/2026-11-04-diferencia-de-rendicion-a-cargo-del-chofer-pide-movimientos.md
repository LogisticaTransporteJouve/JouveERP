# 2026-11-04 — Diferencia de rendición a cargo del chofer: pide movimientos

**Decisión.** Cargar la diferencia de una rendición al chofer, quitarla o
cancelar la rendición que la tiene pide `hr:write` y `transactions:write`,
como el "Adelanto a empleado" manual: desde #345 ese camino saca la plata de
la caja. Los pagos de planilla y el borrado de un movimiento de la cuenta
corriente siguen con `hr:write` solo; queda como decisión abierta (la
decidió el owner después:
`docs/decisions/2026-11-04-lo-de-rrhh-y-cheques-que-mueve-plata-pide-movimientos.md`).

**Descartado.** Bajar el adelanto manual a `hr:write` solo.
