# 2026-11-04 — Flota, pagos de sueldo y selectores de cuenta (auditoría w7)

**Viajes cancelados.** Un viaje en «Cancelado» no suma ni ingreso ni costo
en «Rentabilidad de flota» ni en el insight «Viajes con margen negativo»,
igual que en Gestión › Margen por camión, `ai_fleet_margin` y el tablero.
El combustible cargado sí sigue contando en el camión: se gastó igual.

**Ingreso de un viaje en el insight.** «Viajes con margen negativo» usa el
mismo ingreso que el reporte: `v_trip_revenue` (el flete de las cargas
facturadas; sin cargas, el ingreso manual del viaje). Antes tomaba solo el
ingreso manual, y un viaje con cargas facturadas parecía perder todo su
costo. Como el ingreso sale de las cargas, el insight pide `trips:read` y
`shipments:read`, como el reporte. Para los roles no cambia nada (operations
tiene los dos); solo lo deja de ver quien tenga `shipments:read` denegado.

**Mantenimiento con comprobante y sin costo.** Si un mantenimiento tiene una
factura de compra o un movimiento vinculado, el «Costo» es obligatorio
(«Cargá el costo del comprobante vinculado.»): en el alta, en la edición
(contra la fila guardada, porque el diálogo no manda un vínculo que el
usuario no puede ver) y en el formulario. `get_vehicle_margin` saca de las
líneas del centro de costo el comprobante vinculado porque lo cuenta el
registro; con el costo vacío el camión lo perdía como $0.

- **Descartado:** contar el total de la factura cuando el costo está vacío
  (`coalesce(cost, total)` en `get_vehicle_margin`). Arreglaba solo esa
  pantalla: el reporte de rentabilidad y `ai_fleet_margin` leen el costo
  del registro y seguían en $0, y una factura que incluye otras cosas
  hubiera cargado de más al camión.

**Pagos de un empleado.** Si las cuentas llegan después de abrir el diálogo
(cache frío, o «Reintentar» tras un error), «Cuenta» toma la primera cuenta
en pesos, como en el pago masivo. Si falla la lectura de los pagos, el
diálogo lo dice con «Reintentar» en vez de «Sin pagos todavía.».

**Cheques propios sin cuentas.** Se suma a la lista de
`2026-11-04-sin-permiso-de-cuentas-se-ocultan-los-selectores-de-cuenta.md`:
sin `accounts:read`, o si la lectura falla, se ocultan «Cargar cheque» y
«Editar», y la tabla dice por qué (con «Reintentar» si falló la lectura).
Cobrado, rechazado y anular siguen. La tabla lee las cuentas con
`useAccountOptions`; la página solo las precarga si el usuario tiene
`accounts:read`.

**Cotización desde el AI CFO.** La tarjeta de `proposeExchangeRate` muestra
el mismo aviso de salto de más de un 30% que la página de Cotizaciones
(`rateJumpWarningFor` en `features/exchange-rates/lib/rate-jump.ts`), contra
la cotización guardada más cercana (`getUsdReferenceRateAction`). La
referencia viaja en las etiquetas de la propuesta, así que «Modificar»
vuelve a comparar el número nuevo. Si no se pudo leer la referencia, la
tarjeta lo dice. Si en «Modificar» se cambia la fecha, se compara con la
referencia de la fecha original.

**Mensaje sin permiso de cuentas.** `ACCOUNTS_UNAVAILABLE_MESSAGE` vive en
`features/accounts/lib/accounts-unavailable.ts`: lo importan módulos puros
(`review-gates.ts`) que no tienen por qué cargar TanStack Query.
