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

## Auditoría: IA, tareas y accesos (2026-11-04)

- [x] **Insights:** una lectura que falla conserva las tarjetas de su tipo
      (antes se borraban); flota y anomalías leen todas las filas (paginado;
      pasado el tope de drenado la corrida falla y las tarjetas quedan); las
      anomalías se comparan por moneda (ARS y USD por separado, con `US$`);
      la regeneración es una transacción (`regenerate_ai_insights`) con lock
      y un índice único por fingerprint vivo.
- [x] **Propuestas IA:** una aceptada sin resultado (el pedido murió) se
      cierra como fallida y se puede volver a preparar.
- [x] **Escaneo:** el control de duplicados compara también tipo y letra, y
      avisa si la búsqueda falló.
- [x] **Herramientas IA:** `limit` acotado en órdenes de pago, recibos y
      asientos; una página cortada avisa que hay más.
- [x] **Dashboard:** la agenda nombra las secciones cuya lectura falló en vez
      de decir "sin vencimientos". **Remitos:** el número escaneado se busca
      exacto en SQL antes del tope de 200.
- [x] **Tareas:** `tasks-daily` reclama vencidas y por vencer en pasos
      separados y asigna toda tarea automática abierta sin asignar; los
      comentarios e historial de una tarea restringida no se devuelven.
- [x] **Permisos:** `retentions:write` gatea cargar o cambiar retenciones de
      un recibo y `stock_movements:write` gatea entrar, despachar, borrar o
      mover un pallet. Salen de la matriz `channels:read`, `channels:write`,
      `files:admin`, `retentions:read`, `credit_debit_notes:read` y
      `stock_movements:read` (ningún gate los leía); un test exige que cada
      permiso se lea fuera de la matriz.
- [ ] Aprobar `20261104096000` (insights) y `20261104096100` (denegaciones de
      permisos quitados) con el deploy. Sin la primera, el analista falla
      (no existe el RPC) y las tarjetas quedan como estaban.
- [ ] No verificado contra una base real: las dos migraciones, el pgTAP de
      `regenerate_ai_insights` y el anti-join de tareas sin asignar.
- [ ] `CollectDialog` (Cobrar desde Movimientos de caja) sigue mostrando el
      editor de retenciones a quien no tiene `retentions:write`; el servidor
      rechaza el guardado con el mensaje de permiso.

## Follow-ups de operaciones (2026-11-04, roadmap 4.x)

- [x] **Rendiciones:** varios medios de pago por carga; PDF interno de la
      rendición; listado paginado; "Asentar diferencia al chofer" (faltante =
      cargo, sobrante = pago en su cuenta corriente, una vez, se va al
      cancelar la rendición); marca de recibos anulados o editados en Recibos.
- [x] **Liquidaciones:** "Liquidar período" (una por cliente, en borrador o
      confirmadas por `confirm_freight_settlement_document`); envío del
      remito R por email (el X de Otras ventas va como su comprobante);
      la reserva para facturar se libera en el acto si la factura ya falló.
- [x] **Cheques vendidos:** anular una venta cargada por error (sin cheques
      movidos y con el período abierto); rechazo sin débito como deuda con el
      comprador que se paga después; pasivo contingente y deuda en Tesorería.
- [x] **Mora:** prorrateo de pagos y NC en el período (saldo diario); varias
      ND de una vez (cada una idempotente).
- [x] **Depósito:** tarifa general por área (precedencia en
      `20261104080400`); lote y área en el export y la trazabilidad;
      historial de bloqueos y desbloqueos con motivo.
- [x] **Cargas y tarifas:** búsqueda por remito; el escaneo de un remito
      muestra su carga; el flete de una carga nueva sale de la tarifa de flete
      del cliente; las tarifas de cliente de `storage_tariffs` que facturan
      igual pasan al tarifario.
- [x] **IA:** `getFreightSettlements` y `getDriverSettlements` (lectura).
- [ ] Aprobar las migraciones `20261104080000`–`20261104080500` junto con el
      deploy (después de `20261104030000`): sin ellas fallan el listado de
      rendiciones (columna `driver_settlement_id`), `/aging/mora`
      (`balance_days`), las ventas de cheques (`status`), las tarifas de
      almacenaje (`area_id`, `migrated_to_client_tariffs_at`), el historial de
      bloqueos y el envío de liquidaciones por email.
- [ ] No verificado contra una base real: migraciones y pgTAP
      (`driver_settlement_differences`, `check_sale_followups`,
      `late_interest_proration`, `deposit_followups`,
      `storage_tariffs_to_client_tariffs`) y las pantallas.
- [ ] Rollback: el código anterior factura una tarifa general por área como
      general de todas las áreas (no cargarlas hasta que el deploy quede
      firme) y cobra la mora sobre el saldo de hoy.

## IA: propuestas e indicadores (2026-11-03, roadmap 6.3 + 6.4)

- [x] **Propuestas fuera del chat** (`ai_proposals`): preparar con los permisos de quien hace
      click, Aceptar / Descartar en un Dialog, aceptar idempotente (compare-and-set + guard),
      vencimiento a 24 h, auditoría de aceptar, fallar y descartar.
- [x] **Acciones proponibles nuevas:** tarea, tarifa de cliente, conciliar las sugerencias de un
      extracto y ND por mora (además de licencia, asiento, cotización, tarea IA y escaneo).
- [x] **Ocho indicadores** en el analyst (margen por cliente, costo por km, L/100 km, mora sin
      cobrar, extracto sin conciliar, rendiciones, cuotas de préstamos, caja contra
      financiamiento), con propuesta donde corresponde.
- [ ] Aprobar la migración `20261103180000_ai_proposals` junto con el deploy: sin ella falla el
      analyst (columna `ai_insights.proposal`) y las tarjetas nuevas no se ven para finance ni
      operations. No verificada contra una base real: correr `supabase test db`
      (`supabase/tests/ai_proposals_test.sql`) antes de aprobar.
- [x] **Recategorizar un gasto** (cuenta de gasto y/o centro de costo de un egreso manual o de
      una compra): `recategorize_expense` + `lib/commands/recategorize-expense.ts`, Dialog
      "Recategorizar" en Caja y Compras, y la propuesta `proposeRecategorizeExpense`.
- [x] **Crecimiento de la mora:** foto diaria del aging (`aging_snapshots`, cron
      `aging-snapshot`) y la tarjeta `receivables_overdue_growth` ("la mora creció X % vs hace
      30 días"). La tarjeta aparece recién cuando hay 30 días de fotos.
- [x] **Conciliación desde el insight de extracto:** si la cuenta con más líneas atrasadas tiene
      sugerencias, la tarjeta propone `proposeBankMatches`; si no, la tarea de siempre.
- [x] **"N conciliadas" en la tarjeta del chat** (`ai_chat_confirmations.result_note`).
- [ ] Aprobar las migraciones `20261104060000_recategorize_expense`,
      `20261104060100_aging_snapshots` y `20261104060200_ai_chat_confirmation_note` con el
      deploy. No verificadas contra una base real: correr `supabase test db`
      (`recategorize_expense_test.sql`, `aging_snapshots_test.sql`) antes de aprobar.
- [ ] Recategorizar una factura de compra no cambia sus NC/ND ya cargadas (heredan la cuenta solo
      al cargarse); recategorizarlas una por una.
- [ ] Una propuesta aceptada cuyo servidor cae entre el claim y la escritura queda `accepted` sin
      `result` (igual que en el chat).
- [ ] Los evals en vivo (`pnpm eval:ai`) de los casos nuevos no se corrieron (sin
      `ANTHROPIC_API_KEY` en el entorno del agente; los offline pasan).

## Guía del sidebar e impuestos como documento (2026-11-03, roadmap 6.5 + 6.6)

- [x] **Guía en el sidebar** (`features/guide`): ayuda corta de la pantalla
      actual (qué es, pasos y la sección del manual HTML que la cubre) y el
      checklist de **puesta en marcha** (cuentas, puntos de venta AFIP,
      importador, tarifas por cliente, saldos iniciales, ajuste inicial,
      usuarios, impuestos). Cada ítem se marca hecho desde los datos (hay al
      menos un registro) o a mano ("Ya está"); se ve solo con el permiso de
      su módulo, denegaciones por usuario incluidas. Plegable; el estado se
      guarda por usuario en `user_guide_states` (localStorage solo como
      pista del primer render).
- [x] **Impuestos** (Contabilidad › Impuestos, `/taxes`, `features/taxes`):
      `tax_documents` con tipo (IVA, IIBB, anticipo de Ganancias, SICORE,
      F931, monotributo, otro con nombre), período, vencimiento, importe
      (manual o estimado desde el libro IVA) y estado pendiente → liquidado
      → pagado / anulado; VEP o DDJJ como adjunto (`file_attachments.
    tax_document_id`); lista y calendario; "Preparar el mes" copia los del
      mes anterior. **Pagar** (`pay_tax_document`) registra el egreso en el
      canal fiscal como movimiento con dueño y su asiento Debe cuenta del
      impuesto / Haber caja o banco; rechaza un período cerrado. Tareas
      automáticas 7 días antes del vencimiento (`sync_automatic_tasks`,
      cron `tasks-daily`). `taxes:read` (owner, admin, finance,
      fiscal_reader) y `taxes:write` (owner, admin, finance).
- [ ] Aprobar las migraciones `20261103170000_tax_documents` y
      `20261103170100_user_guide_states` con el deploy (después de
      `20261103150000_ai_cross_queries`). Sin ellas falla `/taxes` y la guía
      del sidebar muestra solo la ayuda de la pantalla (la lectura del
      checklist falla). Rollback: el código anterior no lee las tablas
      nuevas; Caja (`v_transactions_tagged`) marca el pago de un impuesto con
      origen `tax_document` y la app vieja lo muestra como un movimiento con
      dueño (no editable), que es lo correcto.
- [ ] No verificado contra una base real: migraciones y pgTAP
      (`supabase/tests/tax_documents_test.sql`) sin stack local; correr
      `supabase test db`. La UI (guía, impuestos, calendario) no se probó en
      el navegador.
- [x] **Vincular movimiento existente** (`20261103190000`): un impuesto
      se paga con un egreso suelto ya cargado (pesos, canal fiscal, caja o
      banco activa, ±15 días del vencimiento, el importe más cercano
      primero) vía `link_tax_document_payment`, que le saca la cuenta de
      gasto y re-asienta contra la cuenta del impuesto; sirve también con un
      movimiento ya conciliado. En Conciliación › Crear movimiento, un
      débito en pesos puede ser "Pago de impuesto"
      (`create_bank_statement_line_tax_payment`: `pay_tax_document` con la
      fecha, cuenta e importe de la línea, y la concilia). Un importe
      distinto al del impuesto pide confirmación y queda en las notas.
- [ ] Aprobar la migración `20261103190000_tax_documents_link_movement` con
      el deploy. Rollback: el código anterior no llama a los RPC nuevos; un
      impuesto pagado así se ve como cualquier pagado.
- [ ] No verificado contra una base real:
      `supabase/tests/tax_documents_link_test.sql` sin stack local; los
      diálogos (vincular, "Pago de impuesto") no se probaron en el navegador.
- [ ] Vincular un egreso de un canal no fiscal se rechaza: cambiarle el
      canal rompería su conciliación. Si hace falta, cargarlo en el canal
      fiscal o pagar con "Pagar".
- [ ] Resultado de gestión percibido: el pago de un impuesto cae en el
      rubro de la cuenta `gastos` (como un egreso suelto sin cuenta de
      gasto), no en el de la cuenta del impuesto. En devengado, una cuenta
      de pasivo (IVA) no es resultado y no suma.
- [ ] Estimado de IVA: no descuenta las percepciones de IVA de las compras
      (el libro IVA Compras las suma con las de IIBB en `imp_trib`) ni el
      saldo a favor del mes anterior; lo dice en pantalla.
- [ ] El contador (`fiscal_reader`) ve los impuestos pero no sus adjuntos
      (no tiene `files:read`).
- [ ] Herramienta del asistente IA para impuestos (vencimientos y estado).
- [ ] El manual HTML no se sirve desde la app: la guía lo cita por nombre
      ("Manual: Contabilidad › Impuestos"), sin link.
- [x] **Deshacer un pago** (`20261104050100`, "Deshacer pago" en el
      impuesto pagado; `taxes:write` + `transactions:write`):
      `undo_tax_document_payment` deja el impuesto liquidado (o pendiente si
      el importe era estimado) y una línea en las notas. Si lo pagó "Pagar",
      borra el egreso con su asiento; si fue "Vincular", el movimiento queda
      en Caja suelto, con la cuenta de gasto que tenía
      (`tax_documents.payment_previous_expense_account_id`) y el asiento
      rehecho. Rechaza un período cerrado y un egreso de "Pagar" conciliado
      con el extracto (primero se desconcilia). Sin pago no hace nada.
- [x] **Gestión percibido** (`20261104050200`): el pago de un impuesto va
      al rubro de la cuenta del impuesto si está mapeada en
      `management_buckets`, si no a Costos operativos › Impuestos
      operativos. Devengado no cambia.
- [x] **Estimado de IVA**: descuenta el saldo a favor técnico del IVA del
      mes anterior (`tax_documents.credit_balance`, `20261104050300`, se
      carga en el impuesto de IVA desde la DDJJ) y muestra aparte los otros
      tributos de las compras.
- [ ] Estimado de IVA: las percepciones de IVA sufridas en compras no se
      descuentan. `purchase_invoices` tiene un solo `imp_trib` (IVA e IIBB
      juntas, y el asiento lo manda entero a percepciones IIBB); separarlas
      pide una columna nueva en compras (carga manual, importador AFIP y
      escaneo) y un asiento que las separe. Hoy el estimado muestra el total
      de `imp_trib` para restarlo a mano.
- [ ] Backfill de deshacer: los impuestos ya pagados toman su origen del
      log de auditoría (vinculado si está `tax_document.payment_linked`; si
      no, "Pagar"); la cuenta de gasto previa sale del último
      `transaction.created`/`transaction.updated` antes del vínculo, porque
      `repost_journal` borra el asiento reemplazado (no lo revierte). Sin
      rastro, deshacer deja el movimiento sin cuenta de gasto (va a
      `gastos`).
- [x] **Adjuntos para el contador** (`20261104050400`): quien tiene
      `taxes:read` ve los adjuntos de un impuesto (RLS de `file_attachments`
      y `files`, y las acciones de adjuntos) sin `files:read`; nada más del
      hub de archivos. En `/taxes`, el lector abre "Ver adjuntos".
- [x] **Herramienta IA** `getTaxDocuments` (`taxes:read`): vencidos, por
      vencer, pagados en un mes, estimados y, a pedido, el estimado de IVA.
- [ ] Aprobar las migraciones `20261104050100` a `20261104050400` con el
      deploy. Rollback: el código anterior no llama a `undo_tax_document_
      payment` ni lee las columnas nuevas; gestión percibido sigue en rubros
      que conoce; las policies nuevas solo agregan filas a un rol al que el
      código viejo no le pide adjuntos.
- [ ] No verificado contra una base real:
      `supabase/tests/tax_documents_undo_test.sql` sin stack local; "Deshacer
      pago", el saldo a favor y "Ver adjuntos" no se probaron en el
      navegador; los casos de ruteo nuevos no se corrieron en vivo.

## IA: consultas cruzadas y gráficos (2026-11-03, roadmap 6.1 + 6.2)

- [x] **Margen por cliente** (`getClientMargin`): ingreso neto facturado sin
      IVA menos costo de viajes y combustible imputado; costo directo sin
      cliente y flota no asignada aparte.
- [x] **Cobranza por cliente** (`getClientPaymentBehavior`): días promedio
      de cobro, deuda abierta y vencida, +90 días, cheques rechazados y a
      cuenta.
- [x] **Economía por vehículo** (`getVehicleEconomics`) y **actividad por
      chofer** (`getDriverActivity`): viajes, km (viajes y odómetro), litros,
      ingreso, costos, por km; extras, adelantos y saldo del empleado con
      RRHH. Viajes sin vehículo / sin chofer aparte.
- [x] **Ranking de costos** (`getTopCosts`) por rubro o centro de costo,
      desde el resultado de gestión.
- [x] **Gráficos:** barras apiladas, formato km, `dataset` para elegir la
      lista; `getManagementPnL` con `byMonth`.
- [ ] Aprobar la migración `20261103150000_ai_cross_queries` junto con el
      deploy: sin ella fallan `getClientMargin`, `getVehicleEconomics` y
      `getDriverActivity`.
- [ ] **Costos de camión sin vínculo:** seguros, patentes, cubiertas y
      compras cargadas solo con centro de costo no llegan a
      `getVehicleEconomics` (mismo faltante que "Margen por camión" de
      gestión v2).
- [ ] `ai_fleet_margin` cuenta viajes cancelados (su costo y su ingreso
      manual); las RPC nuevas de actividad los excluyen. Alinear.
- [ ] Rendiciones por chofer (diferencias de cobranza contra entrega) en
      `getDriverActivity`.
- [x] "Días de pago" va a `getClientPaymentBehavior`: `getClientSalesSummary` ya no
      ofrece días promedio de cobro en su descripción y deriva esas preguntas; casos de
      routing nuevos (días de pago, quién tarda más, facturado por cliente).
- [ ] Los evals en vivo (`pnpm eval:ai`) de esos casos no se corrieron (sin
      `ANTHROPIC_API_KEY` en el entorno del agente).
- [ ] Los evals en vivo (`pnpm eval:ai`) de los casos nuevos no se corrieron:
      `getClientSalesSummary` y `getClientPaymentBehavior` se pisan en "días
      de cobro".

## Importador, conciliación y manual: follow-ups (2026-11-04)

- [x] **Importador, más datos:** proveedores con categoría, cuenta de gasto
      y centro de costo por defecto (por nombre o código); choferes con
      número, categoría y vencimiento de licencia (el vencimiento es un
      documento `licencia` en Flota › Vencimientos); tarifas por área (columna
      Área, buscada por nombre dentro del Depósito). Una referencia que no
      existe o es ambigua deja la fila con error.
- [x] **Conciliación:** varias líneas contra un movimiento (el banco lo
      partió), con la suma exacta y nunca varias de cada lado; desconciliar
      una libera toda la conciliación. Caja marca los conciliados, filtra
      por conciliados o no, no ofrece borrarlos y bloquea monto y fechas en
      la edición con link a Conciliación; el mensaje de la base nombra
      Tesorería › Conciliación.
- [x] **IA:** el resumen de conciliación de un extracto escaneado lee las
      líneas ya importadas (`bank_statement_lines`) y su estado; solo el
      resto se compara contra Caja.
- [x] **Manual:** formato de cada planilla del importador y sección de
      Conciliación; servido en `/manual` con sesión iniciada; la guía del
      sidebar enlaza la sección de cada pantalla.
- [ ] Aprobar las migraciones `20261104070000_import_more_fields` y
      `20261104070100_bank_reconciliation_many_lines` con el deploy (después
      de las de 5.3/5.4; `promote-to-production.yml` las aplica antes del
      código). Sin la primera, la RPC vieja ignora las claves nuevas:
      proveedores y choferes entran sin sus datos nuevos y **una tarifa de
      área entraría como general**, así que no importar tarifas por área
      hasta aplicarla. Sin la segunda falla "Conciliar con varias líneas".
      Rollback del código: llama a las mismas RPC con su firma; una
      conciliación partida sigue bloqueando su movimiento y el código viejo
      la muestra contra una de sus líneas.
- [ ] No verificado contra una base real: las dos migraciones y sus pgTAP
      (`supabase/tests/import_more_fields_test.sql`,
      `bank_reconciliation_many_lines_test.sql`) sin stack local; correr
      `supabase test db`. Tampoco se probaron en el navegador `/manual`
      (CSP con nonce), el filtro de Caja (filtro de nulos sobre el embed de
      `bank_statement_matches` en `v_transactions_tagged`) ni el diálogo de
      varias líneas.
- [ ] El importador no actualiza un proveedor o empleado que ya existe: los
      datos nuevos de la planilla solo entran con el alta.
- [ ] Las sugerencias de Conciliación siguen siendo uno a uno; las líneas
      partidas se eligen a mano.
- [ ] El manual servido usa la fuente del sistema (la CSP bloquea Google
      Fonts) y Mermaid por CDN con el nonce.

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
- [x] Importar tarifas, préstamos, cheques en cartera, saldos iniciales de
      clientes y extractos (5.3, 5.4): ver la sección siguiente.
- [ ] Mostrar los históricos donde ayuden (ficha del empleado, del vehículo
      o del cliente) y sumarlos a Gestión como serie separada si hace falta;
      hoy solo se ven en el importador.

## Importes de arranque y conciliación bancaria (2026-11-03, roadmap 5.3 + 5.4)

- [x] **Importador, tanda 2**: tarifas por cliente (con vigencia, respeta la
      superposición), préstamos con sus cuotas pendientes, cheques de
      terceros en cartera, saldos iniciales de clientes (lo que debe cada
      uno al corte) y extractos bancarios. Cada corrida se deshace mientras
      nada la usó (cuota pagada, cheque movido, recibo nuevo del cliente,
      tarifa facturada, línea conciliada).
- [x] **Conciliación bancaria** (Tesorería › Conciliación,
      `/treasury/reconciliation`): por cuenta y mes, sugerencias por importe,
      fecha y referencia; conciliar una línea con uno o varios movimientos;
      desconciliar; "no corresponde" con motivo; crear el movimiento que
      falta (comisión, interés) con su cuenta de gasto. Saldo según extracto
      contra saldo según libros. Un movimiento conciliado no se edita ni se
      borra hasta desconciliarlo.
- [ ] Aprobar las migraciones `20261103140000_bank_reconciliation` y
      `20261103140100_import_opening_items` con el deploy (después de
      `20261103110000_import_runs`). Rollback: el código anterior no lee las
      tablas nuevas, saltea las corridas de tipos que no conoce y no las
      puede deshacer; el guard de conciliación sigue rechazando editar un
      movimiento conciliado.
- [ ] No verificado contra una base real: migraciones y pgTAP
      (`supabase/tests/bank_reconciliation_test.sql`) sin stack local; correr
      `supabase test db`. La UI no se probó en el navegador.
- [ ] Cobranzas históricas (recibos de antes del go-live) **no** se importan:
      moverían caja y asientos de períodos ya cerrados en papel. Va el saldo
      inicial por cliente; el detalle por factura queda para el ajuste
      inicial.
- [ ] Cheques importados: el ingreso a cartera se fecha hoy y acredita
      ajustes de caja (sin cliente). No cargar además el saldo inicial de la
      cuenta de cartera por esos cheques.

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
- [ ] Mora: tasa por comprobante o por condición de venta. Un comprobante
      que ya se pagó entero no aparece (sin saldo abierto): la mora de los
      días hasta ese pago no se puede cobrar desde `/aging/mora`.
- [ ] Deuda con el comprador de un cheque vendido rechazado: el libro mayor
      la asienta al pagarla (como el rechazo con débito inmediato); hasta
      entonces es pasivo operativo en Tesorería y Cheques, no una cuenta del
      plan. Una cuenta "Deudas por cheques vendidos" en el mayor necesita
      tocar `build_transaction_journal_lines`.
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
- [ ] Editar desde Recibos un recibo de una rendición no la actualiza: la
      rendición lo marca ("recibos cambiados en Recibos") y no deja asentar
      la diferencia; no se recalcula sola. Se detecta por el total del
      recibo: un cambio de cuenta con el mismo total no se marca.
- [ ] El faltante asentado al chofer y la factura del cliente: si el cliente
      pagó entero y el chofer se quedó con la plata, la factura sigue con
      saldo por el faltante. Hay que cancelarlo a mano (no hay un recibo
      "cobrado por el chofer").
- [ ] Liquidar período con "confirmar" deja las de Otras ventas confirmadas:
      el remito interno X se emite una por una (cada una es un comprobante).
- [x] **Remito R / remito interno X** (`20261104030000_freight_settlements_remito_r`):
      la liquidación sigue el lado del cliente. Ventas: confirmar emite el
      **Remito R** (`R9002-…`, correlativo propio) y después se factura la
      A/B. Otras ventas: "Emitir remito interno" confirma y emite el remito
      interno X (`X9001-…`), sin R. Las confirmadas antes conservan su `R-…`.
- [ ] El Remito R no imprime CAI ni su vencimiento (RG 1415, comprobante
      impreso): cargar el CAI del punto de venta 9002 cuando se tramite, y
      confirmar con el contador que 9002 es el punto de venta habilitado.
- [ ] Borrar `confirm_freight_settlement(uuid, uuid)` (numeración `R-…`) una
      vez que no quede código desplegable que la llame.

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
- [ ] Tarifas de cliente en `storage_tariffs` que no pasaron al tarifario
      (más de una fila activa, con fin de vigencia o un cliente que ya tenía
      tarifario): pasarlas a mano revisando cada una
      (`20261104080500`). Las que pasaron quedan como respaldo congelado.
- [ ] Crear la carga desde un remito escaneado (hoy el escaneo muestra las
      cargas con ese remito y lleva a Cargas).

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
- [ ] **Percibido a cuenta:** lo cobrado o pagado sin imputar va a servicios /
      pagos a proveedores aunque después se impute a un bien de uso o a una
      compra a cargo de un empleado.

## Margen por camión (2026-11-03)

- [ ] Aprobar la migración `20261104050000_vehicle_margin` junto con el
      deploy: sin ella fallan la sección "Margen por camión", el vínculo en
      Centros de costo y `getVehicleEconomics` con permiso de gestión. Rollback:
      el código anterior no lee `cost_centers.vehicle_id` ni llama a
      `get_vehicle_margin`.
- [ ] Vincular cada camión con su centro en Contabilidad › Centros de costo
      (dato, no código).
- [ ] Una carga de combustible que apunta solo al pago (OP) y no a la compra
      cuenta dos veces si la compra lleva el centro del camión; un
      `trips.cost` cargado también como compra con ese centro, igual.
- [ ] El margen por camión es siempre devengado y nominal (no sigue la base ni
      el ajuste por inflación de la pantalla).
- [ ] En devengado, un desembolso de préstamo en USD sin cotización aparece
      en "USD sin cotización" (`management_pnl_lines`, rama `pending_usd`, no
      excluye `loans.disbursement_transaction_id`), aunque con cotización no
      es resultado. Solo afecta el aviso, no suma a ninguna cifra.

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
- [ ] **Centro de costo del camión en combustible y mantenimiento.** El
      camión ya tiene centro (`cost_centers.vehicle_id`, margen por camión);
      falta que vincular una carga o un service a una compra sin centro le
      ponga el del camión.
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
