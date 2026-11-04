# 2026-11-03 — IA: consultas cruzadas y gráficos (6.1 + 6.2)

**Decisión (6.1).** Cinco tools de lectura del AI CFO
(`features/ai/registry/actions/cross.ts`) que cruzan dominios componiendo las
lecturas de cada feature: `getClientMargin`, `getClientPaymentBehavior`,
`getVehicleEconomics`, `getDriverActivity` y `getTopCosts`. Cada parte pasa
por el server action de su módulo (su `userCan` y RLS); si el usuario no lee
un módulo, esa parte vuelve `null` (no `0`) y la nota dice qué se omitió y
por qué permiso. Lo que faltaba en SQL va en tres RPC nuevas
(`20261103150000_ai_cross_queries`): `ai_client_net_revenue` (ingreso neto
sin IVA por cliente), `ai_vehicle_activity` y `ai_driver_activity` (viajes,
km, litros, odómetro, extras y adelantos), con flags `p_include_*` que el
server action prende según `userCan`. El margen por cliente es **de
contribución** (ingreso neto − costo de viajes y combustible imputado), y lo
dice: no descuenta sueldos, mantenimiento ni gastos generales, y separa el
costo directo sin cliente y el de flota que no se asigna. Cada tool pagina
(`limit`/`offset`), lee como máximo 500 filas por fuente y marca `partial`
si una fuente llegó a su tope.

**Decisión (6.2).** Los gráficos ya existían (Fase 3, `renderChart`); se
amplió el mismo artefacto: tipo `stacked` (barras apiladas, hasta 6 series,
positivos arriba y negativos abajo), formato `km`, `dataset` para elegir qué
lista del resultado graficar (ej. `byMonth` de `getManagementPnL`) y el anillo
de foco en `primary`. `getManagementPnL` suma `byMonth` y `getTopCosts`
trae `byMonth` + `seriesFields` listos para un apilado. Los nombres de campo
`*_ars` y `*_per_km_ars` se leen como pesos; `*_km` como km.

**Por qué.** Las preguntas de dueño ("¿qué cliente me deja más?", "¿cuánto me
cuesta el km de cada camión?") cruzan ventas, flota, combustible y RRHH; el
modelo no debe sumar cifras de varias tools, y cada parte tiene que respetar
el permiso de su pantalla.

**Descartado.** RPC `SECURITY DEFINER` solo para service role: saltean RLS
(un chofer vería todos los viajes, `fiscal_reader` vería canales internos) y
obligan a replicar el techo de rol en la app; se usó `SECURITY INVOKER` con
`search_path = ''` y `authenticated` como las demás `ai_*`. Un tool nuevo de
"comportamiento de pago" desde cero (se compone `ai_client_sales_summary` +
aging). Una librería de charts (sigue el SVG propio). Repartir mantenimiento
o gastos generales entre clientes (sería una regla de prorrateo inventada).
