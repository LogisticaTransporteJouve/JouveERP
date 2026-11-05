# 2026-11-05 — Controles de escritura en el resto de los maestros y lectura de canales (w13)

**Decisión.** Auditoría w13 (S8 F1–F2, S4 F1, S6 F2). La regla de
[`2026-11-04-controles-de-escritura-por-permiso-w12.md`](2026-11-04-controles-de-escritura-por-permiso-w12.md)
se aplica a las pantallas que faltaban: cada página pasa `ctx.access`
(`actorAccess`) y la tabla muestra crear, editar, borrar y el interruptor
«Activo» solo con el permiso que pide su server action. Sin ese permiso,
«Activo» se ve deshabilitado y los diálogos no se montan.

| Pantalla                                     | Permiso                                                             | Queda para quien solo lee                                 |
| -------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| Proveedores › Categorías                     | `suppliers:write`                                                   | la lista                                                  |
| Depósito › Productos                         | `products:write`                                                    | la lista                                                  |
| Flota › Viajes                               | `trips:write`                                                       | «Ver cargas», solo con `shipments:read` (el chofer no)    |
| Tarifas de almacenaje (incluye «Aumentar %») | `storage_billing:issue`                                             | la lista                                                  |
| Vehículos                                    | `vehicles:write`                                                    | la lista                                                  |
| Choferes                                     | `drivers:write`                                                     | «Vincular usuario» (pide `users:assign_role`, como antes) |
| Combustible (incluye «Importar resumen»)     | `fuel:write`                                                        | «Ticket o remito» (con `files:read`, como antes)          |
| Mantenimientos                               | `maintenance:write`                                                 | la lista                                                  |
| Documentación de flota                       | `fleet_documents:write`; subir el archivo pide además `files:write` | «Ver» el archivo                                          |
| Depósitos (incluye el editor de «Áreas»)     | `warehouses:write`                                                  | la lista                                                  |
| Pagos recurrentes                            | `recurring_payments:write`                                          | la lista                                                  |

Así, un chofer ve Viajes sin «Nuevo viaje», «Editar», «Borrar» ni «Ver
cargas» (corregido en w14: la página del viaje lee las cargas con
`shipments:read`, que el chofer no tiene;
[`2026-11-05-listas-y-lecturas-de-canales-w14.md`](2026-11-05-listas-y-lecturas-de-canales-w14.md)), y un
usuario de depósito ve Productos sin controles; una denegación por usuario
(`/admin/users`) oculta lo mismo en las otras.

**Canales de facturación.** `readInvoicingChannels()` (`lib/channels.ts`)
devuelve la lectura o `ok: false`. «Flujo de caja» falla entero si no se
pudo leer (muestra «No se pudo cargar el flujo de caja.» con «Reintentar»),
en vez de pasar todo a «otros» y descartar pagos recurrentes de
«Préstamo». (w14 cambió lo que sigue de este párrafo: ver
[`2026-11-05-listas-y-lecturas-de-canales-w14.md`](2026-11-05-listas-y-lecturas-de-canales-w14.md).)
Las opciones de cargas también fallan: «Facturar flete» dice
«No se pudieron cargar los canales.» y el viaje de «Editar carga» dice «No
se pudieron cargar los viajes.», los dos con «Reintentar». Los selectores y
etiquetas de canal del resto (layout, Cheques, Cheques emitidos, Movimientos,
Recibos, Órdenes de pago, Cuentas, ficha de cliente y de proveedor) siguen
con `getInvoicingChannels()`, que ante un error da una lista vacía.

**Rollback.** Solo código de la app, sin migración: volver atrás vuelve a
mostrar los controles (las actions los siguen rechazando) y a tratar una
lectura de canales fallida como lista vacía.
