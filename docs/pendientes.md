# Pendientes y faltantes — JouveERP

> Estado al **2026-07-04**. Surge de una auditoría docs vs código (roadmap,
> `docs/*`, `features/*`, migraciones, tests). Este doc es la lista de trabajo
> real; cuando se resuelve cada punto, se sincroniza el roadmap.

> **Update 2026-07-04** — tanda de cierre (PRs #195–#201): mappers
> crear-desde-escaneo para **todos** los tipos con destino (recibo, OP, factura
> de venta, NC/ND de compra), **asientos manuales** + cuenta RECPAM + aplicación
> RG 4667, **tarifas de storage versionadas** (aumento % + snapshot en cada
> facturación), **flujo de caja con USD** al TC oficial, **L.6 export Libro IVA
> Digital** (TXT posicional) y **L.7 CAEA** de contingencia. Con esto el
> backlog de código queda **vacío**.

---

## 1. Lo único pendiente (configuración, no código)

- [ ] **Email del aging semanal — env vars.** El cableado por Resend está
      shippeado (`lib/email/client.ts`); faltan `RESEND_API_KEY`, `EMAIL_FROM`
      y `FINANCE_EMAIL` en el entorno de producción. Sin ellas el cron loguea y
      saltea el envío (graceful).
- [ ] **CAEA — alta del punto de venta de contingencia.** Todo el flujo (código
      por quincena, emisión offline, régimen informativo) está shippeado, pero
      requiere crear una única vez el PV **"CAEA — Contingencias"** en
      _Administración de Puntos de Venta y Domicilios_ de ARCA. Hasta entonces
      `FECAEASolicitar` responde 15003 y el panel de `/admin/afip` lo muestra.
- [ ] **Tarifas de storage — cargar los valores reales.** El CRUD + versionado
      está; los importes vigentes son estimados hasta que se confirmen con el
      cliente. Se actualizan con "Aumentar %" o editando desde
      `/storage-tariffs`.

## 2. Cerrado en la tanda 2026-07-04

- [x] **Document Intelligence — crear desde escaneo** para recibo, orden de
      pago, factura de venta (emite por el flujo normal, con guard de
      duplicados) y NC/ND de compra (#195). Remitos quedan como archivo (no hay
      entidad remito en el ERP); extractos van por conciliación.
- [x] **Asientos manuales** (`source_table = null`) + cuenta **RECPAM 4.2.2** + aplicación **RG 4667** (generar/vincular/desvincular asiento desde la
      página de inflación) (#196). Decisión: el ajuste se calcula afuera y se
      carga manual — no hay RPC de reexpresión automática.
- [x] **H.5 tarifas** — snapshot de tarifas aplicadas en `storage_billing_runs` + aumento masivo por % con historial (#197). La emisión AFIP de storage ya
      estaba cableada vía `issueFiscalInvoiceAction` (el doc estaba desactualizado).
- [x] **Flujo de caja USD** — cuentas, cheques, aging, recurrentes y cuotas en
      USD convertidos al último TC oficial; las vistas de aging ahora exponen
      `moneda` (#198). Antes los USD del aging se sumaban como si fueran ARS.
- [x] **L.6 — export Libro IVA Digital** (TXT posicional, diseño RG 3685;
      importable en Portal IVA / IVA Simple RG 5705) (#199).
- [x] **L.7 — CAEA contingencia** (RG 5782/2025): solicitud por quincena,
      emisión offline en PV de contingencia, régimen informativo automático,
      QR con `tipoCodAut A`, panel admin (#200).

## 3. Descartados (decisiones)

- [x] ~~**M.5** — aprobaciones de montos altos~~ (decisión #20, 2026-06-22).
- [x] ~~**M.6** — portal cliente~~ (decisión #19, 2026-06-22).
- [x] ~~**RAG / embeddings (pgvector)**~~ (decisión 2026-07-04): infra paga
      nueva sin caso de uso; la FTS `search_global` cubre free-text.
- [x] ~~**Write-tools IA + NL→SQL**~~ (decisión 2026-07-04): el agente queda
      read-only; las escrituras pasan por los flujos normales con confirmación
      humana (Document Intelligence incluida).

## 4. Hecho anteriormente (referencia)

- [x] **AI.0–AI.8** completo (chat + 25 tools + persistencia + artifacts +
      medidor/tope + Document Intelligence + insights proactivos) + anomalías,
      conciliación de extractos y skills de chat.
- [x] **Fase K** (compras/pagos), **Fase L** (contabilidad, ahora completa),
      **Fase N** (RRHH), **Fase G** (flota), **Fase H** (pallets/depósito),
      **Fase R** (pagos recurrentes), **Treasury**, **M.2 multimoneda**
      (exchange_rates + cron BCRA + asientos multimoneda).
- [x] Tests: 47/47 dominios con `schema.test.ts`; matriz de permisos con
      cobertura 100%.

---

## Importador y sueldos y viajes históricos (2026-11-03, roadmap 5.1 + 5.2)

- [x] **Importador** (Admin › Importador, `/admin/imports`, owner y admin):
      .xlsx o .csv → tipo → columnas → vista previa con errores y avisos por
      fila → importar en una transacción. Clientes, proveedores, empleados
      (con su ficha de chofer si el puesto es chofer) y vehículos. Cada
      corrida queda registrada (archivo, hash, quién, filas importadas,
      salteadas y con error) y se puede **deshacer** si nadie editó ni usa
      sus filas. Reimportar el mismo archivo no duplica.
- [x] **Sueldos y viajes históricos**: tablas propias, solo de referencia, en
      las pestañas del importador. No generan asientos, pagos, cuenta
      corriente, extras de chofer ni facturas, y no entran en Gestión, libros
      fiscales, reportes ni IA.
- [ ] Aprobar la migración `20261103110000_import_runs` junto con el deploy
      (después de las de 4.4–4.6): sin ella falla la página del importador.
      Rollback: el código anterior ignora `import_run_id` y las tablas
      nuevas; lo importado queda como un alta normal.
- [ ] No verificado contra una base real: la migración y su pgTAP
      (`supabase/tests/import_runs_test.sql`) se escribieron sin un stack
      local; correr `supabase test db` antes de aprobar.
- [ ] Importar saldos iniciales, cobranzas, tarifas, préstamos, cheques y
      extractos (5.3, 5.4); categoría y cuenta de gasto por defecto de un
      proveedor y datos del chofer (licencia) desde la planilla.
- [ ] Mostrar los históricos donde ayuden (ficha del empleado, del vehículo
      o del cliente) y sumarlos a Gestión como serie separada si hace falta;
      hoy solo se ven en el importador.
- [ ] Manual de usuario: sección del importador con el formato de cada
      planilla.

## Depósito por área, lote y bloqueo; mora y venta de cheques (2026-11-03, roadmap 4.4 + 4.6)

- [x] **Áreas del depósito** (Depósitos › Áreas): zonas por depósito; el
      pallet puede estar en un área de su depósito. **Tarifa por área** en el
      tarifario del cliente: pisa a la de todas las áreas para los pallets de
      esa área; sin área todo factura igual que antes.
- [x] **Lote y vencimiento** del pallet (alta, carga masiva y edición).
- [x] **Bloqueo** de un pallet en depósito con motivo y quién lo bloqueó: no
      se despacha ni se borra hasta desbloquearlo (guard en la base); el
      despacho masivo saltea los bloqueados y lo avisa.
- [x] **Intereses por mora** (`/aging/mora`): comprobantes vencidos con saldo,
      interés simple a la tasa mensual del cliente o la general; "Generar ND"
      emite una nota de débito por comprobante con el período cobrado. Un
      período no se cobra dos veces; una ND fallida o anulada lo libera.
- [x] **Venta de cheques** (Cheques › seleccionar › Vender): los cheques
      quedan vendidos, el neto entra en la cuenta y los intereses y comisiones
      van a Intereses pagados. Un vendido rechazado sale de la cuenta de la
      venta (o la elegida) y queda como deuda del firmante.
- [ ] Aprobar las migraciones `20261103100000_storage_areas_lots_blocks`,
      `20261103100100_late_interest` y `20261103100200_check_sales` junto con
      el deploy (después de las de 4.1–4.5): sin ellas fallan el listado de
      pallets (columnas nuevas), el tarifario, la facturación de almacenaje
      (`area_id`), `/aging/mora` y la venta de cheques.
- [ ] Rollback: el código anterior factura mal a un cliente con tarifas por
      área (las toma como si fueran de todas las áreas y se superponen), no
      lista los cheques vendidos (los descarta con un log) y no puede
      rechazar uno vendido. No cargar tarifas por área hasta que el deploy
      quede firme.
- [ ] Deuda con una financiera que no debita la cuenta al rechazar un cheque
      vendido: hoy la devolución sale de una cuenta en el momento del rechazo;
      falta registrarla como pasivo a pagar después.
- [ ] Anular una venta de cheques cargada por error (hoy no hay reverso) y
      ver los cheques vendidos no vencidos como pasivo contingente (endoso con
      recurso) en Tesorería.
- [ ] Mora: el interés usa el saldo abierto al generar la ND para todo el
      período (un pago parcial en el medio no se prorratea); tasa por
      comprobante o por condición de venta; generar varias ND de una vez;
      herramienta de IA.
- [ ] Tarifa por área general (sin cliente) en `storage_tariffs`; lote y área
      en el export de pallets y en la trazabilidad; historial de bloqueos
      (hoy queda el último motivo en el pallet y cada cambio en Auditoría).
- [ ] "Percibido" del resultado de gestión: los intereses de la venta de
      cheques entran por su cuenta de gasto; el nominal transferido es neutro
      (como un depósito).

## Liquidación R y rendiciones (2026-11-03, roadmap 4.3 + 4.5)

- [x] **Liquidaciones** (`/liquidaciones`, `invoices:read`, edición con
      `invoices:issue`): cliente + período + cargas entregadas, a su flete o a
      la tarifa de **flete** del cliente (concepto nuevo del tarifario, por
      carga, en pesos). Borrador → confirmada (número `R-…`) → facturada con
      **una** factura por `issueFiscalInvoiceAction`. PDF del documento R. Una
      carga en una sola liquidación viva; mientras tanto no se factura sola.
      Factura fallida o anulada → vuelve a confirmada; cancelar una facturada
      pide la factura anulada o acreditada por NC por el total.
- [x] **Cobranza contra entrega** en la carga (`cod_amount`, en el diálogo
      de la carga) y **Rendiciones** (`/rendiciones`, `receipts:read`, edición
      con `receipts:write`): pendientes por chofer, rendición con lo entregado
      por carga (cuenta, importe, cheque) y diferencias; confirmar emite un
      recibo por cliente y canal (caja, bancos o cartera) imputado a la
      factura de cada carga. Idempotente; cancelar pide los recibos anulados.
- [ ] Aprobar las migraciones `20261103090000_freight_settlements` y
      `20261103090100_cod_driver_settlements` junto con el deploy (dependen de
      `20261103080000`/`20261103080100`, PR #318): sin ellas fallan el listado
      de cargas (`cod_amount`), `/liquidaciones` y `/rendiciones`.
- [ ] Un rollback a código anterior con tarifas de flete cargadas hace fallar
      la facturación de almacenaje de ese cliente (el código viejo rechaza un
      concepto que no conoce).
- [ ] Diferencia de la rendición contra la cuenta corriente del chofer
      (faltante como deuda del empleado): hoy se registra y se muestra, no se
      asienta.
- [ ] Varios medios de pago por carga en el diálogo de la rendición (la base
      ya los admite; la pantalla carga uno por carga).
- [ ] PDF de la rendición (los recibos ya tienen el suyo) y herramientas de
      IA para liquidaciones y rendiciones.
- [ ] Editar o anular desde Recibos un recibo de una rendición no actualiza
      la rendición: sigue confirmada hasta cancelarla.
- [ ] Liquidaciones por lotes (todos los clientes de un período) y envío del
      R por email.

## Remitos únicos y tarifarios por cliente (2026-11-03, roadmap 4.1 + 4.2)

- [x] **Remito del cliente en la carga** (`shipments.remito_number`): único
      por cliente entre las cargas no canceladas, sin distinguir mayúsculas ni
      espacios (índice `shipments_client_remito_unique`). El diálogo de carga
      avisa mientras se escribe (`shipment_remito_conflict`) y no deja guardar
      un repetido; el índice lo rechaza igual. Una carga cancelada libera su
      número.
- [x] **Tarifario por cliente** (`client_tariffs`): concepto (almacenaje,
      carga, descarga), unidad, precio, ARS/USD y vigencia, sin superposición
      por cliente y concepto (guard `guard_client_tariff_overlap`); RPC
      `client_tariff_at(cliente, concepto, fecha)`. Pestaña **Tarifario** en el
      detalle del cliente (`storage_billing:read`, edición con
      `storage_billing:issue`).
- [x] **Facturación de almacenaje** usa el tarifario del cliente día por día
      (carga el día de ingreso, descarga el de egreso) y cae a
      `storage_tariffs` (la del cliente, después la general) en lo que no
      cubre. USD al oficial del último día del período (o el anterior); sin
      cotización la preview lo marca y la factura no se emite.
- [ ] Aprobar las migraciones `20261103080000_shipment_remito_number` y
      `20261103080100_client_tariffs` junto con el deploy: sin ellas fallan
      el listado de cargas (columna `remito_number`), la pestaña Tarifario y la
      facturación de almacenaje (lee `client_tariffs`).
- [ ] Unificar tarifas: las filas de `storage_tariffs` con cliente conviven
      con el tarifario; pasarlas a `client_tariffs` y dejar `storage_tariffs`
      solo para la general.
- [ ] Concepto **flete** en el tarifario (sugerir `freight_amount` al crear la
      carga): quedó fuera, el flete se sigue cargando a mano.
- [ ] Remito en el escaneo (Document Intelligence → carga) y búsqueda de
      cargas por remito.
## Resultado de gestión v2 (2026-11-03, roadmap 3.7)

- [x] **Detalle de cada cifra:** cada número de la tabla mes a mes abre los
      documentos que lo forman (`get_management_pnl_documents`), con link a
      cada uno si el usuario lee su módulo; suma lo mismo que la cifra.
- [x] **Percibido:** cobros de bienes de uso, pagos de compras de flota,
      pagos de compras a cargo de empleados y adelantos fuera del margen
      operativo, según lo que imputó cada recibo / OP; cuotas con desglose
      en capital e intereses.
- [x] **Compras a cargo de empleados y adelantos** fuera del costo operativo
      en las dos bases (el costo entra con el descuento de planilla).
- [x] **Indicadores:** margen operativo %, resultado operativo (EBITDA
      aprox.), generación de caja y variación contra el mismo período del
      año anterior.
- [x] **Exportar CSV / Excel** de la tabla mes a mes (uso interno, auditado).
- [x] IA: `getManagementPnL` con indicadores y `getManagementPnLDocuments`.
- [ ] **Margen por camión:** falta vincular camión ↔ centro de costo (o la
      carga de combustible / el service con el camión en la compra). Los
      ingresos ya podrían atribuirse por `shipments.trip_id → trips.vehicle_id`.
- [ ] **Percibido a cuenta:** lo cobrado o pagado sin imputar va a servicios /
      pagos a proveedores aunque después se impute a un bien de uso o a una
      compra a cargo de un empleado.
- [ ] **Desembolso de préstamos:** es neutro en las dos bases; decidir si
      suma en "Capital de préstamos" en percibido.
- [ ] `getManagementReportAction` lee `get_management_pnl` sin paginar: con
      más de 1000 filas (mes × caja × cuenta × centro) PostgREST la cortaría.

---

## Contador, "Hoy y esta semana" y auditoría (2026-11-02, roadmap 1.9–1.11)

- [x] **Paquete del mes** (`/accounting/package`, `accounting:read`, también
      para `fiscal_reader`): checklist del período (cerrado, asientos
      pendientes y faltantes, comprobantes fiscales sin autorizar, CAEA sin
      informar, compras fiscales sin letra) y las descargas juntas: Libro IVA
      Ventas/Compras (PDF, Excel y TXT), libro diario, libro mayor y balance de
      sumas y saldos (PDF y Excel por `/api/export`). Tool
      `getMonthlyPackageStatus`.
- [x] **Dashboard "Hoy y esta semana"** (D12): vencimientos de Tareas, viajes
      de hoy y papeles por vencer, cada tile con su permiso. Tool
      `getTodayOverview`.
- [x] **Admin › Auditoría** (D13): lista, filtros, CSV, detalle con datos
      sensibles enmascarados, "Historial" en el detalle del comprobante,
      retención de 400 días (`audit-retention`), tool `getAuditEvents` y test
      de cobertura de `logAudit`.
- [ ] Aprobar la migración `20261103030000_audit_log` junto con el deploy: sin
      ella fallan el filtro de acciones, el "Historial" no tiene índice y el
      cron de retención falla.
- [ ] Tile de km mensual pendiente cuando `vehicle_km_readings` llegue a
      `main`.
- [ ] Un ZIP con todo el paquete (hoy son botones separados: no hay librería
      de zip en las dependencias de runtime).
- [ ] "Historial" en el resto de las páginas de detalle (recibos, OP,
      compras, clientes, proveedores): el componente `RecordHistory` ya está.

---

## Tareas (2026-11-02)

- [x] `/tasks`: manuales, recurrentes y automáticas desde compras, ventas
      vencidas, préstamos, cheques propios y documentos de flota y empleados;
      comentarios, historial, reasignar, marcar hecha; cron `tasks-daily` con
      avisos; tool `getTasks` para el asistente.
- [ ] Aprobar la migración `20261103000000_tasks` junto con el deploy: sin
      ella `/tasks` y el cron fallan (las tablas no existen).
- [ ] Push del aviso `task_due` (hoy solo in-app) y preferencia por tipo en
      `/profile`.
- [ ] Borrar una tarea manual creada por error (hoy solo se cierra).

---

## Compras y contabilidad — correcciones (2026-11-02)

- [x] **Número de compras internas.** El autonumerado del formulario llamaba a
      `next_internal_purchase_numero` desde el navegador (revocado para
      `authenticated` desde la auditoría T1a) y el error se tragaba. Ahora va
      por `nextInternalPurchaseNumeroAction` (service client, rechaza canales
      fiscales) y el RPC numera por proveedor + tipo + PV sobre todos los
      estados, como la clave única. Si falla, el formulario lo avisa.
- [x] **NC/ND de compra manual a la cuenta del origen.** Sin cuenta propia
      hereda la cuenta de gasto (y el centro de costo) de su comprobante de
      origen, en vez de revertir `compras`.
- [x] **Libro mayor con saldo anterior.** Con "Desde", el saldo acumulado
      arranca del saldo previo (fila "Saldo anterior") y el corte de PostgREST
      se detecta y se avisa como datos parciales.
- [x] **Fecha "hoy" en hora argentina.** Defaults y filtros de formularios y
      acciones usan `todayInAR()`: después de las 21 h ya no proponen el día
      siguiente (UTC).
- [x] **Contador (`fiscal_reader`) y asientos sin canal.** Ve los asientos
      manuales "fiscal general" (sin canal) y sus líneas; los internos siguen
      ocultos. El alcance "Solo fiscal" del libro diario también los incluye.
- [ ] Las NC/ND de compra cargadas antes de esta corrección siguen asentadas
      contra `compras` (no hay backfill). Desde 1.1/1.2 el formulario de
      edición cambia la cuenta de gasto (re-asienta en un período abierto):
      decidir si se corrigen una por una o con un backfill.

---

## Bases contables: costo con rubro y centro (roadmap 1.1 + 1.2 + 1.8, 2026-11-02)

- [x] **Compras con cuenta de gasto y centro de costo** (fiscal e interno, alta
      y edición). Default: el del proveedor; si no tiene, la sugerencia de la
      IA del escaneo. La base rechaza una cuenta que no sea hoja activa de
      resultado negativo.
- [x] **Proveedor con cuenta de gasto y centro de costo por defecto**, en su
      ficha.
- [x] **Egreso manual de caja con cuenta de gasto y centro** (alta y edición):
      asienta contra esa cuenta en vez de `gastos`; sin cuenta, igual que
      antes. Los movimientos de documentos no la llevan.
- [x] **Resultado de gestión por centro de costo:** filtro y tabla "Por
      centro de costo"; la herramienta de IA `getManagementPnL` también.
- [ ] **Centro de costo del camión en combustible y mantenimiento.** `vehicles`
      no tiene centro y la carga de combustible / el service solo referencian
      la compra (`purchase_invoice_id`): falta `vehicles.cost_center_id` y que
      vincular una carga a una compra sin centro le ponga el del camión.
- [ ] **Percibido por centro para pagos con OP:** el movimiento de la OP no
      lleva el centro de las compras que paga (podría repartirse por
      imputación).
- [ ] **Compras y egresos cargados antes** quedan sin cuenta ni centro (van a
      `compras`/`gastos` y a "Sin centro"): no hay backfill; se corrigen
      editándolos en un período abierto.
- [ ] Cuenta de gasto por ítem de compra (hoy la compra entera va a una
      cuenta): solo si aparece un caso real.

---

## Accesos por usuario — follow-ups (2026-10-28)

- [ ] **Aprobar la migración `20261028140000_user_permission_denies`** apenas
      mergea el PR; después quitar las tolerancias de ventana de deploy en
      `lib/auth/denies.ts` (tabla faltante) y `features/search/actions/search-actions.ts`
      (firma vieja de `search_global`).
- [ ] **Denegaciones en la DB** (overlays RESTRICTIVE por tabla + storage + RPC
      DEFINER). Hoy la DB aplica solo el techo del rol; ver `docs/decisions.md`.
- [ ] Suite pgTAP rol × tabla contra `ROLE_PERMISSIONS` (y auditar el desvío
      `['owner','finance']` en RLS vs admin en TS).
- [x] `issue-invoice.ts`: "sin CAEA vigente" y "sin `cbte_tipo_afip`" fallan sin
      reintentos.
- [x] `issueFiscalInvoiceAction`: la `idempotency_key` la manda el formulario;
      un doble submit devuelve el mismo borrador.
- [ ] Datos de un módulo oculto que otro módulo muestra (facturas/recibos en la
      cuenta del cliente y el aging, saldos de cuentas en tesorería, libro IVA):
      decidir si se filtran por el permiso del recurso.
- [ ] Document Intelligence: el matching (`features/ai/document/store.ts`,
      `features/ai/reconciliation/gather.ts`) lee con service client sin filtrar
      por el acceso de quien subió el documento.
