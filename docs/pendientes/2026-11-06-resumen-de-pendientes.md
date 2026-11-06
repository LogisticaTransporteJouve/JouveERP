# 2026-11-06 — Resumen de pendientes abiertos

Barrido de los `- [ ]` de todos los archivos de `docs/pendientes/` (salvo
`antes-de-promover.md` y `limites-de-rollback.md`) contra el código de `main`
en `e239ee7` y `production-latest` en `bbe08b38` (tiene todas las
migraciones hasta `20261105231001`). De 268 ítems abiertos, 60 se marcaron
hechos y 27 «ya no aplica», cada uno con su evidencia en su archivo. Quedan
181, que acá se listan sin duplicados, por área y, dentro de cada área, de
mayor a menor impacto: primero plata y fiscal, después integridad de datos,
después UX y documentación. Cada línea enlaza a su archivo de origen, que es
donde se marca cuando se resuelve; este resumen no se mantiene.

## Ventas y fiscal

- Re-leer de ARCA las ventas importadas sin ítems: el libro IVA las infiere y un comprobante con dos alícuotas queda en «Sin alícuota» (necesita aprobación del owner) ([w8](2026-11-04-fiscal-ventas-auditoria-w8.md), [w9](2026-11-04-fiscal-ventas-auditoria-w9.md)).
- Decidir con el contador qué hacer con las NC vinculadas de más en producción (dos NC del mismo total a una factura, NC en pesos a factura en dólares) ([w11](2026-11-04-fiscal-nc-por-total-y-liquidaciones-auditoria-w11.md)).
- Comprobantes en dólares viejos con cotización 1: el asiento y el libro IVA la toman como válida; revisar con la consulta del ítem ([emisión AFIP](2026-11-04-emision-afip-auditoria.md)).
- Confirmar con el contador: bloque de transparencia en toda B, exenta con alícuota 0003 en cero, ubicación del bloque (RG 5614) y leyenda «A CONSUMIDOR FINAL» (RG 1415) ([w8](2026-11-04-fiscal-ventas-auditoria-w8.md)).
- «Otros impuestos nacionales indirectos» sale de `imp_trib`: en una B importada puede ser una percepción provincial ([w8](2026-11-04-fiscal-ventas-auditoria-w8.md)).
- Percepciones de ventas por tipo y retenciones por comprobante en el libro de ventas; revisar con el contador un período impreso contra el sistema anterior ([libro IVA híbrido](2026-11-04-libro-iva-hibrido.md)).
- Remito R sin CAI ni vencimiento (RG 1415): cargar el CAI del punto de venta 9002 y confirmar que es el habilitado ([liquidación R](2026-11-03-liquidacion-r-y-rendiciones.md)).
- Alta del punto de venta «CAEA — Contingencias» en ARCA (hasta entonces `FECAEASolicitar` responde 15003) ([historial](historial-2026-07-04.md)).
- Emisión: dos comprobantes iguales que intentaron el mismo número durante una caída quedan en `emitting`; una emisión en `emitting` sin número enviado frena la importación de ARCA de su par; un borrador CAEA trabado frena el «sin movimiento» ([emisión AFIP](2026-11-04-emision-afip-auditoria.md)).
- Clave de facturación por fuente: facturas viejas con clave al azar no se detectan, tope de 20 tentativas, y una carga facturada sola puede volver a facturarse en una liquidación (falta una marca en la base) ([liquidaciones y flete](2026-11-04-auditoria-liquidaciones-y-flete.md)).
- Liquidación con su remito interno facturado en Ventas: si la factura se acredita por el total, el remito sigue congelado y la liquidación no se cancela; `link_freight_settlement_invoice` no rechaza una factura acreditada; una carga sigue apuntando a su factura acreditada hasta el próximo «Facturar flete» ([cargas w12](2026-11-04-cargas-y-liquidaciones-vinculo-de-factura-w12.md)).
- Escribir cabecera e ítems de `issueFiscalInvoiceAction` en un solo RPC (hoy el reconciliador falla el borrador sin ítems a los 15 minutos) ([w14](2026-11-05-facturacion-y-flota-auditoria-w14.md)).
- Mora: tasa por comprobante o condición de venta; un comprobante pagado entero no deja cobrar la mora; una NC sin origen baja la base de todo el período ([depósito y mora](2026-11-03-deposito-por-area-lote-y-bloqueo-mora-y-venta-de-cheques.md), [saldos de apertura](2026-11-04-saldos-de-apertura-aging-y-diferencia-de-cambio.md)).
- Aging: el crédito de una NC sin origen que supera lo abierto no se muestra; los saldos de apertura ya cargados no se recalculan ([saldos de apertura](2026-11-04-saldos-de-apertura-aging-y-diferencia-de-cambio.md)).
- Mensajes de las guardas y de «Cancelar» con una ND de flete viva no dicen que hay que acreditar también la ND; `fiscal_reader` lee una ND de intereses como de flete en `billing_invoice_is_void` ([w15 flota](2026-11-05-flota-nd-acreditadas-auditoria-w15.md)).
- NC total de una venta importada con ítems puede quedar un centavo arriba del saldo; el detalle de una B muestra el unitario neto ([w8](2026-11-04-fiscal-ventas-auditoria-w8.md)).
- Notas sobre notas desde la app, cadenas de más de 10 notas ([w16](2026-11-05-facturacion-y-flota-auditoria-w16.md)); la búsqueda de origen por total mira solo las 100 facturas más recientes ([w11](2026-11-04-fiscal-nc-por-total-y-liquidaciones-auditoria-w11.md)).
- Confirmar las monedas guardadas antes de agregar `check (moneda in ('PES','DOL'))` a `invoices` ([w11](2026-11-04-fiscal-nc-por-total-y-liquidaciones-auditoria-w11.md)).
- `arca-issued-sync` hace hasta 100 consultas por paso (puede pasar los 300 s); mail manual de comprobante, recibo o liquidación sin clave de idempotencia ([emisión AFIP](2026-11-04-emision-afip-auditoria.md)).
- Liquidar período con «confirmar»: el remito interno X se emite uno por uno; borrar `confirm_freight_settlement(uuid, uuid)` ([liquidación R](2026-11-03-liquidacion-r-y-rendiciones.md)).
- Plazo de pago por cliente ([vencimiento de ventas](2026-11-05-vencimiento-de-ventas-y-tareas.md)).
- Smoke AFIP e2e (`invoices-emit.spec.ts`) sin correr: necesita homologación ([w11](2026-11-04-lecturas-fallidas-y-notas-de-rollback-w11.md)).
- Variables de Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `FINANCE_EMAIL`) en producción para el aging semanal ([historial](historial-2026-07-04.md)).

## Compras

- Comprobante de ARCA en dólares: al aceptarlo no se compara la cotización, y el libro IVA, el TXT y el asiento convierten a la que tipeó el usuario ([w15](2026-11-05-avisos-de-lectura-y-escaneo-w15.md)).
- El lector de ARCA acepta partes que superan el total en un centavo; las compras internas no tienen el guard de total en la base ([total = suma de las partes](2026-11-04-compras-total-igual-a-la-suma-de-las-partes.md)).
- Robot de ARCA: probarlo de punta a punta desde producción, confirmar una corrida real de 12 meses, ver el CSV del servidor, una B y un comprobante en dólares; FCE MiPyME y tipo M se cargan a mano ([recibidos de ARCA](2026-11-04-recibidos-de-arca.md)); la columna de «otros impuestos nacionales» se toma por nombre sin un archivo real ([decisiones tanda 1](2026-11-04-decisiones-del-owner-tanda-1.md)).
- NC/ND de compra cargadas antes de la corrección siguen asentadas contra `compras`; NC/ND guardadas sin cuenta o sin centro se completan solo al volver a guardarlas en un período abierto ([correcciones](2026-11-02-compras-y-contabilidad-correcciones.md), [w9](2026-11-04-gestion-nc-nd-edicion-insights-y-flota-ia-w9.md)).
- El cambio de una factura no audita las NC/ND que movió ([w11](2026-11-04-gestion-margen-por-camion-nc-nd-y-escaneo-w11.md)); una NC/ND recategorizada a vacío y editada después toma el valor del origen ([w10](2026-11-04-gestion-recategorizar-nc-nd-y-flota-pendiente-por-cargas-w10.md)); una factura pasada a NC/ND sin leer el proveedor guarda su cuenta y centro ([w9](2026-11-04-gestion-nc-nd-edicion-insights-y-flota-ia-w9.md)).
- Avisar a owner y admin cuando ARCA rechaza la clave ([recibidos de ARCA](2026-11-04-recibidos-de-arca.md)).
- El selector de factura origen muestra todo en pesos ([w17](2026-11-05-compras-nc-nd-auditoria-w17.md)).
- La categoría desactivada de un proveedor se ve vacía al editar; candidatos al «Nuevo …» en línea ([proveedores](2026-11-04-proveedores-categoria-en-linea-y-defaults-de-compra.md)).
- Con la lectura de canales fallida, la columna «Comprobante» sigue diciendo «Factura» en una compra interna ([w14 listas](2026-11-05-listas-y-lecturas-de-canales-w14.md)).

## Tesorería

- Cheques propios USD de OP: el banco se acredita a la cotización de la OP y no a la del cobro; un cheque rechazado USD pagado a otra cotización deja la diferencia en proveedores; los asientos ya hechos quedan con el importe viejo (lo decide el owner) ([w2](2026-11-04-tesoreria-auditoria-w2.md)).
- Filas viejas sin re-asentar: cuotas sin desglose, cheques propios sin OP, cuota pagada antes del desembolso; `journal_missing_entries` no lista los cheques propios ([cheques, OP y préstamos](2026-11-04-tesoreria-auditoria-de-cheques-op-y-prestamos.md)).
- Deuda con el comprador de un cheque vendido rechazado: no tiene cuenta en el mayor hasta pagarla; percibido de la venta de cheques ([depósito y venta de cheques](2026-11-03-deposito-por-area-lote-y-bloqueo-mora-y-venta-de-cheques.md)).
- Saldo de apertura de proveedor sin los cheques entregados rechazados; la OP nueva no imputa el cheque rechazado y las tareas no crean «Pagar» para él; `create_transfer` sin clave de idempotencia ([w2](2026-11-04-tesoreria-auditoria-w2.md)).
- Asignaciones de recibos y OP abiertas a escritura directa bajo RLS ([w7](2026-11-04-tesoreria-guardas-auditoria-w7.md), [w8](2026-11-04-tesoreria-y-prestamos-auditoria-w8.md)); `apply_account_opening_balance` acepta una cartera de cheques ([w8](2026-11-04-tesoreria-y-prestamos-auditoria-w8.md)); un cheque manual puede traer el `import_run_id` de otra corrida ([w6](2026-11-04-tesoreria-guardas-de-cheques-auditoria-w6.md)).
- Diferencias de rendición asentadas al chofer antes de `20261104095300` cuentan dos veces ([RRHH y rendiciones](2026-11-04-auditoria-rrhh-y-rendiciones.md)); editar desde Recibos un recibo de una rendición no la actualiza ([liquidación R](2026-11-03-liquidacion-r-y-rendiciones.md)).
- Revisar en producción cheques propios con `payment_order_id` que no figuran en `payment_order_payment_lines` (se espera ninguno) ([w5](2026-11-04-tesoreria-guardas-de-cheques-auditoria-w5.md)).
- Impuestos: vincular un egreso de un canal no fiscal se rechaza; el backfill de «Deshacer pago» deja sin cuenta de gasto lo que no tiene rastro ([impuestos](2026-11-03-guia-del-sidebar-e-impuestos-como-documento.md)).
- Arranque: las cobranzas históricas no se importan; los cheques importados ingresan con fecha de hoy ([importes de arranque](2026-11-03-importes-de-arranque-y-conciliacion-bancaria.md)).
- Conciliación: las sugerencias siguen siendo uno a uno ([importador y conciliación](2026-11-04-importador-conciliacion-y-manual-follow-ups.md)).
- El guard de borrado nombra igual el cobro y la devolución de un cheque propio rechazado ([w3](2026-11-04-tesoreria-auditoria-w3.md)).

## Flota

- Una carga de combustible que apunta solo a la OP, o un `trips.cost` cargado también como compra con el centro del camión, cuentan dos veces; «USD sin cotización» suma ingresos y costos ([margen por camión](2026-11-03-margen-por-camion.md)).
- Vincular una carga o un service a una compra sin centro no le pone el centro del camión ([bases contables](2026-11-02-bases-contables-costo-con-rubro-y-centro.md)); vincular cada camión con su centro (dato) ([margen por camión](2026-11-03-margen-por-camion.md)).
- Mantenimientos guardados con comprobante y sin costo cuentan $0 ([w7](2026-11-04-flota-y-sueldos-auditoria-w7.md)).
- `getClientMargin` no trae el flete sin facturar ([w9](2026-11-04-gestion-nc-nd-edicion-insights-y-flota-ia-w9.md)) y puede mostrar «Flota no asignada» negativa ([w16](2026-11-05-facturacion-y-flota-auditoria-w16.md)).
- Remito interno facturado en Ventas: una NC fiscal no baja el ingreso de flota; redondeo por viaje vs. por cliente difiere en centavos; borrar `shipment_invoice_is_void` y, si hace falta, materializar `shipment_invoice_billed_ratio` ([w14](2026-11-05-facturacion-y-flota-auditoria-w14.md)).
- Una carga que nunca se va a facturar deja su viaje pendiente para siempre; `get_vehicle_margin` con 500 camiones y viajes sin vehículo rechaza el rango ([w10](2026-11-04-gestion-recategorizar-nc-nd-y-flota-pendiente-por-cargas-w10.md)).
- El margen por camión es siempre devengado y nominal ([margen por camión](2026-11-03-margen-por-camion.md)).
- Importación de combustible: dos lecturas distintas confirmadas a la vez dependen del chequeo en TypeScript ([escrituras](2026-11-06-escrituras-cheques-archivos.md)); el combustible importado no se liga a la factura del proveedor ([w2](2026-11-04-auditoria-w2-rrhh-gestion-y-rendiciones.md)).
- Crear la carga desde un remito escaneado ([remitos y tarifarios](2026-11-03-remitos-unicos-y-tarifarios-por-cliente.md)).
- Cargas y Pallets traen todas las filas: paginar en el servidor ([w14 listas](2026-11-05-listas-y-lecturas-de-canales-w14.md)); vehículos y choferes de Combustible, Mantenimiento, Vencimientos y Viajes caen a una lista vacía si su lectura falla ([w16](2026-11-05-lecturas-y-reclamos-de-escaneo-w16.md)).
- Tile de km mensual en «Hoy y esta semana» ([contador](2026-11-02-contador-hoy-y-esta-semana-y-auditoria.md)).

## Depósito

- Tarifas de `storage_tariffs` que no pasaron al tarifario: pasarlas a mano ([remitos y tarifarios](2026-11-03-remitos-unicos-y-tarifarios-por-cliente.md)); cargar los importes reales ([historial](historial-2026-07-04.md)).
- `storage_billing_runs` acepta PATCH de período y totales e INSERT directo de una reserva; la marca de importación de varias tablas sigue abierta a PATCH ([w9](2026-11-04-tesoreria-sueldos-prestamos-y-almacenaje-auditoria-w9.md), [w10](2026-11-04-tesoreria-prestamos-y-almacenaje-auditoria-w10.md), [w11](2026-11-04-tesoreria-vinculos-de-facturacion-auditoria-w11.md)).
- `storage_billing_void_run_ids` devuelve hasta 1000 filas sin paginar ([w11](2026-11-04-tesoreria-vinculos-de-facturacion-auditoria-w11.md), [notas w12](2026-11-04-notas-de-rollback-w11-y-controles-por-permiso-w12.md)).
- Depósitos, productos y áreas caen a una lista vacía si su lectura falla ([w16](2026-11-05-lecturas-y-reclamos-de-escaneo-w16.md)); el selector de cliente de Productos y Tarifas trae todos los clientes ([w15](2026-11-05-avisos-de-lectura-y-escaneo-w15.md)).

## RRHH

- Gestión percibido: la OP de una compra a cargo de empleado va entera a anticipos aunque se le cargue el neto; ajustar `f_employee` ([RRHH y rendiciones](2026-11-04-auditoria-rrhh-y-rendiciones.md), [w2](2026-11-04-auditoria-w2-rrhh-gestion-y-rendiciones.md)).
- Una ND contra una compra a cargo de empleado no suma al cargo; el embargo no entra en ninguna cifra de sueldos ([w2](2026-11-04-auditoria-w2-rrhh-gestion-y-rendiciones.md)).
- `payroll_periods` deja cambiar `kind` y `notes` a finance, también con el período cerrado (`posts_employee_accounts` ya está fijo) ([w11](2026-11-04-fiscal-nc-por-total-y-liquidaciones-auditoria-w11.md)).
- Descuento de planilla sin plan ni cargo deja saldo a favor del empleado ([RRHH y rendiciones](2026-11-04-auditoria-rrhh-y-rendiciones.md)); liquidación final sin sueldo base sugiere $0 ([w3](2026-11-04-auditoria-w3-montos-de-rrhh-y-liquidacion-final.md)).
- Documentos de flota y RRHH no guardan quién cambió su archivo (solo la auditoría) ([w15 vínculos](2026-11-05-vinculos-de-archivos-auditoria-w15.md)).
- Con `accounts:read` denegado, el diálogo de pagos de un empleado no muestra los pagos hechos ([montos y cuentas](2026-11-04-montos-de-ventas-y-cuentas-sin-permiso.md)).
- Mostrar los históricos importados en las fichas de empleado, vehículo y cliente ([importador](2026-11-03-importador-y-sueldos-y-viajes-historicos.md)); el importador no actualiza un proveedor o empleado existente ([importador y conciliación](2026-11-04-importador-conciliacion-y-manual-follow-ups.md)).

## Contabilidad y gestión

- Percibido: un cheque endosado rechazado cuenta dos veces; lo cobrado o pagado a cuenta va a servicios/proveedores; re-asentar los `sin_cotizacion` al cargar la cotización ([gestión v2](2026-11-03-resultado-de-gestion-v2.md)).
- Percibido: un cheque propio USD de OP que rebota deja la diferencia entre dos cotizaciones ([w3](2026-11-04-tesoreria-auditoria-w3.md)); la cadena de rebotes se sigue hasta 3 OP ([w4](2026-11-04-tesoreria-y-gestion-auditoria-w4.md)); el movimiento de una OP no lleva el centro de las compras que paga ([bases contables](2026-11-02-bases-contables-costo-con-rubro-y-centro.md)).
- Diferencia de cambio pendiente (NC de compra USD a otra cotización, NC de venta sin origen, documentos USD sin cotización); cambiar `invoice_origin_id` de una NC no la re-asienta ([saldos de apertura](2026-11-04-saldos-de-apertura-aging-y-diferencia-de-cambio.md)).
- Compras y egresos cargados antes sin cuenta ni centro (sin backfill); cuenta de gasto por ítem solo si aparece un caso ([bases contables](2026-11-02-bases-contables-costo-con-rubro-y-centro.md)).
- «Diferencias de cambio» sin rubro de Gestión hasta que el owner la clasifique, también si el rol pasa a otra cuenta ([saldos de apertura](2026-11-04-saldos-de-apertura-aging-y-diferencia-de-cambio.md), [w2](2026-11-04-auditoria-w2-rrhh-gestion-y-rendiciones.md)).
- Paquete del contador en un ZIP; «Historial» en recibos, OP, compras, clientes y proveedores ([contador](2026-11-02-contador-hoy-y-esta-semana-y-auditoria.md)).

## IA

- Escaneo: una denegación agregada después no borra los matches guardados; la sugerencia de cuenta de gasto lee el plan sin mirar `accounting:read` ([w11](2026-11-04-gestion-margen-por-camion-nc-nd-y-escaneo-w11.md)).
- Una propuesta aceptada cuyo servidor cae entre el claim y la escritura queda `accepted` sin `result` ([propuestas](2026-11-03-ia-propuestas-e-indicadores.md)).
- Escaneo: la toma vieja de un recibo, OP o factura no se puede reintentar ([w16 reclamos](2026-11-05-lecturas-y-reclamos-de-escaneo-w16.md)); el borrador se borra si falla el envío del evento ([w15](2026-11-05-avisos-de-lectura-y-escaneo-w15.md)); quien escaneó ya no existe y se lee como «sin permiso» ([w13](2026-11-05-archivos-y-escaneo-auditoria-w13.md)); los escaneos viejos con búsqueda fallida siguen diciendo «No se encontró» ([w12](2026-11-04-rrhh-archivos-y-escaneo-auditoria-w12.md), [w13](2026-11-05-archivos-y-escaneo-auditoria-w13.md)).
- «Posible factura duplicada» marca abonos (dos facturas a 30 días, o 3–4 en días seguidos) ([w9](2026-11-04-gestion-nc-nd-edicion-insights-y-flota-ia-w9.md), [w10](2026-11-04-gestion-recategorizar-nc-nd-y-flota-pendiente-por-cargas-w10.md)).
- Editar una tarea de IA no existe (cuando exista, llamar a `announceWorkflowChange`); el scheduler no se verificó contra Inngest real ([tareas IA por eventos](2026-11-04-tareas-ia-por-eventos.md)).
- La propuesta de gasto muestra «Centro actual (inactivo)» sin el nombre ([proveedores](2026-11-04-proveedores-categoria-en-linea-y-defaults-de-compra.md)).
- Evals en vivo (`pnpm eval:ai`) sin correr ([consultas cruzadas](2026-11-03-ia-consultas-cruzadas-y-graficos.md), [propuestas](2026-11-03-ia-propuestas-e-indicadores.md)).
- Los diálogos de importaciones y de documentos escaneados leen las cuentas con suspense y fallan al abrirlos sin permiso ([montos y cuentas](2026-11-04-montos-de-ventas-y-cuentas-sin-permiso.md)).

## Plataforma

- Denegaciones por usuario en la DB (overlays RESTRICTIVE) y suite pgTAP rol × tabla contra `ROLE_PERMISSIONS`; decidir si los datos de un módulo oculto que muestra otro se filtran; quitar la tolerancia de tabla faltante en `lib/auth/denies.ts` ([accesos por usuario](2026-10-28-accesos-por-usuario-follow-ups.md)).
- Barrido de huérfanos: `delete_orphan_files` no mira si otra fila nombra la misma key ([w12](2026-11-04-rrhh-archivos-y-escaneo-auditoria-w12.md)); `is_linked_file` sigue ejecutable por `authenticated` ([w16](2026-11-05-archivo-propio-de-documentos-auditoria-w16.md)).
- Migraciones de contrato: borrar `search_index`/`search_global` ([búsqueda global](2026-11-04-busqueda-global-retirada.md)) y `supplier_categories.slug` ([slug](2026-11-05-supplier-category-slug-drop.md)).
- Regla real de puntos de venta habilitados por canal; auditoría repetida en RPC idempotentes; invitación que queda sin roles si falla la asignación ([escrituras](2026-11-06-escrituras-cheques-archivos.md)).
- Tareas: push de `task_due` y preferencia por tipo; borrar una tarea manual ([tareas](2026-11-02-tareas.md)); cerrar la tarea de cobranza al cobrar ([vencimiento de ventas](2026-11-05-vencimiento-de-ventas-y-tareas.md)).
- Lecturas: fichas de cliente, proveedor, viaje y empleado redirigen a la lista ante un error; Documentos con más de 100 en un estado; id mal formado; endosante sin `clients:read` ([w17](2026-11-05-buscadores-y-lecturas-auditoria-w17.md)); `PosSelect` sin «Reintentar» ([w16](2026-11-05-lecturas-y-reclamos-de-escaneo-w16.md)); selectores de canal vacíos con la lectura fallida ([w14 listas](2026-11-05-listas-y-lecturas-de-canales-w14.md)).
- «Eliminar» visible en adjuntos que otro creó ([w14](2026-11-05-archivos-por-registro-auditoria-w14.md)).
- Guía: «Cargar cheque» y «Editar» de cheques propios piden `accounts:read` ([w7](2026-11-04-flota-y-sueldos-auditoria-w7.md)); el manual servido usa la fuente del sistema y Mermaid por CDN ([importador y conciliación](2026-11-04-importador-conciliacion-y-manual-follow-ups.md)).
- Sin probar en el navegador: guía del sidebar, impuestos y sus diálogos ([impuestos](2026-11-03-guia-del-sidebar-e-impuestos-como-documento.md)), conciliación ([importes de arranque](2026-11-03-importes-de-arranque-y-conciliacion-bancaria.md), [importador y conciliación](2026-11-04-importador-conciliacion-y-manual-follow-ups.md)), follow-ups de operaciones ([operaciones](2026-11-04-follow-ups-de-operaciones.md)), diálogos de IA y tareas ([auditoría IA](2026-11-04-auditoria-ia-tareas-y-accesos.md)), pantallas con `accounts:read` denegado ([montos y cuentas](2026-11-04-montos-de-ventas-y-cuentas-sin-permiso.md)).
