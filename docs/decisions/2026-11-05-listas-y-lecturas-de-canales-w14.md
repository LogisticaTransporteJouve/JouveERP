# 2026-11-05 — Listas completas, pantallas del chofer y lecturas de canales (w14)

**Decisión.** Auditoría w14 (S6 F1, F4, F5; S8 F1, F2). Solo código de la
app, sin migración.

**Cargas y Pallets leen todo.** `listShipmentsAction` y `listPalletsAction`
leen por páginas con `paginateRange` y desempatan por `id`, como Viajes,
Combustible, Mantenimientos y Vencimientos. Antes PostgREST cortaba en 1000
filas sin error: con más cargas o pallets se perdían los más viejos (cargas
sin facturar de hace meses, pallets guardados hace más tiempo), también en
el despacho y en «Trazabilidad».

**Lo que ve el chofer.** Cada control usa el mismo permiso que su lectura:

| Control                         | Permiso                         | Por qué                                                                        |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| Flota › «Rentabilidad» (y ruta) | `trips:read` + `shipments:read` | `getFleetProfitabilityAction` pide los dos (`FLEET_PROFITABILITY_PERMISSIONS`) |
| Viajes › «Ver cargas»           | `shipments:read`                | la página del viaje solo muestra sus cargas (`listShipmentsByTripAction`)      |
| Ruta `/trips/[id]`              | `trips:read` + `shipments:read` | ídem                                                                           |

El chofer (`trips:read` sin `shipments:read`) ya no ve «Rentabilidad» ni
«Ver cargas», que lo llevaban a una pantalla con error. Si no tiene
`trips:write` tampoco ve el menú de acciones de la fila. En el inicio,
«Viajes de hoy» lo lleva a la lista de Viajes en vez de a la página del
viaje.

**Opciones de cargas.** `listShipmentOptionsAction` devuelve `trips` y
`channels` por separado, cada uno `null` si su lectura falló. «Nueva carga» /
«Editar carga» solo mira los viajes; «Facturar flete» solo los canales y
muestra «No se pudieron cargar los canales.» con «Reintentar». Así un error
en los canales ya no vacía el selector de viaje (cambia lo que decía
[`2026-11-05-controles-de-escritura-por-permiso-w13.md`](2026-11-05-controles-de-escritura-por-permiso-w13.md)).

**Canales del layout.** El layout lee los canales con
`readInvoicingChannels()` y le pasa al `ScopeProvider` si la lectura falló
(`channelsFailed`). Con la lectura fallida:

- arriba de cada página: «No se pudieron cargar los canales de facturación…»
  con «Reintentar» (refresca el layout);
- debajo del selector de canal de Ventas, Compras, Recibos, Órdenes de pago y
  los diálogos del escaneo: «No se pudieron cargar los canales.»;
- la columna «Tipo» de Compras muestra «—» en vez de «Fiscal»;
- guardar una compra dice «No se pudieron cargar los canales. Reintentá.»
  en vez de «El canal elegido no existe.».

Los demás lectores de `getInvoicingChannels()` (cheques, movimientos,
cuentas, fichas) siguen tratando el error como lista vacía: son selectores
propios de su página.

**Rollback.** Solo código: volver atrás devuelve las listas cortadas en 1000,
los accesos del chofer a pantallas con error y la lectura de canales fallida
como lista vacía. Un cliente viejo con el servidor nuevo lee `trips ?? []` y
`channels ?? []`, así que un `null` se ve como lista vacía, igual que antes.
