# 2026-11-03 — Margen por camión: el centro de costo apunta al camión

**Decisión.** `cost_centers.vehicle_id` (opcional, único: un centro por
camión) vincula un centro con un camión; se edita en Contabilidad › Centros
de costo (`accounting:write`). Todo lo cargado con ese centro (compras,
egresos manuales, asientos: el etiquetado de 20261103010000) es costo de ese
camión. `get_vehicle_margin` (SECURITY DEFINER, service role; la acción
`getVehicleMarginAction` exige `management:read`) da por camión, en meses
completos y devengado nominal: ingreso, costo de viajes, combustible y
mantenimiento de `ai_fleet_margin` más el costo operativo del centro, sacado
de `management_pnl_lines` (no lo reemplaza). Una compra o movimiento al que
apunta una carga de combustible o un service (y la NC/ND de esa compra) no
entra en la parte del centro: ya la cuenta la flota. Lo que no es de un
camión va aparte y nunca se reparte: viajes sin vehículo, cada centro sin
camión y lo cargado sin centro. Más de 500 vehículos con movimientos se
rechaza (`jouve_guard`) en vez de cortar filas. Gestión lo muestra en
"Margen por camión"; `getVehicleEconomics` suma el costo del centro con
`management:read` (si el rango no son meses completos, el centro va por
meses completos y se avisa) y trae el costo sin camión. `ai_fleet_margin`
deja de contar viajes cancelados (su ingreso y costo); el combustible y el
mantenimiento siguen contando por vehículo por su fecha.

**Por qué.** La tabla de vínculo en el centro no toca los formularios de
compra ni de caja: con vincular el centro del camión una vez, lo ya
cargado con ese centro pasa al camión. Un centro por camión evita repartir
en silencio.

**Descartado.** `vehicle_id` por línea de costo (compra, movimiento): cambia
todos los formularios y no sirve para lo ya cargado. `vehicles.cost_center_id`:
el mismo vínculo, pero lo edita flota (`vehicles:write`, operaciones), que no
debería decidir qué entra en gestión. Repartir lo cargado sin centro entre
los camiones por km o viajes.

**Límites conocidos.** Si la carga de combustible apunta solo al pago (OP)
y no a la compra, la compra con el centro del camión cuenta además de la
carga. Un costo de viaje (`trips.cost`) cargado también como compra con el
centro del camión cuenta dos veces. Ingresos cargados con el centro del
camión no se suman (el ingreso es el de los viajes).
