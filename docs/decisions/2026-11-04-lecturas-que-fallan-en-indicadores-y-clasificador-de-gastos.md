# 2026-11-04 — Lecturas que fallan en indicadores y clasificador de gastos

**Decisión.** El margen por cliente o camión pasado el tope del RPC
(`ai_fleet_margin`, 500 grupos, sin offset) falla el indicador, que conserva
sus tarjetas, en vez de leer costo 0. El catálogo de cuentas de gasto y
centros de costo que lee el clasificador tira el error y el paso de Inngest
reintenta. Si se agotan los reintentos, la extracción queda fallida (antes
se guardaba con "sin sugerencia" como si no hubiera catálogo).

**Descartado.** Paginar `ai_fleet_margin`: pide una migración, y pasar de
500 clientes o camiones con viajes en 90 días no es el caso de una sola
empresa de logística; si pasa, el log `ai.insights.indicator_failed` lo
muestra.
