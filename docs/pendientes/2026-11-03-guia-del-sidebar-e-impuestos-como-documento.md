# Guía del sidebar e impuestos como documento (2026-11-03, roadmap 6.5 + 6.6)

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
- [x] Aprobar las migraciones `20261103170000_tax_documents` y
      `20261103170100_user_guide_states` con el deploy (después de
      `20261103150000_ai_cross_queries`). Sin ellas falla `/taxes` y la guía
      del sidebar muestra solo la ayuda de la pantalla (la lectura del
      checklist falla). Rollback: el código anterior no lee las tablas
      nuevas; Caja (`v_transactions_tagged`) marca el pago de un impuesto con
      origen `tax_document` y la app vieja lo muestra como un movimiento con
      dueño (no editable), que es lo correcto. — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [ ] pgTAP verde en CI (stack fresco: `tax_documents_test.sql`); sin verificar contra datos
      de producción. La UI (guía, impuestos, calendario) no se probó en el
      navegador.
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
- [x] Aprobar la migración `20261103190000_tax_documents_link_movement` con
      el deploy. Rollback: el código anterior no llama a los RPC nuevos; un
      impuesto pagado así se ve como cualquier pagado. — hecho: aplicada en producción (está en `production-latest`, `bbe08b38`).
- [ ] pgTAP verde en CI (stack fresco: `tax_documents_link_test.sql`); sin verificar contra
      datos de producción. Los diálogos (vincular, "Pago de impuesto") no se
      probaron en el navegador.
- [ ] Vincular un egreso de un canal no fiscal se rechaza: cambiarle el
      canal rompería su conciliación. Si hace falta, cargarlo en el canal
      fiscal o pagar con "Pagar".
- [x] Resultado de gestión percibido: el pago de un impuesto cae en el
      rubro de la cuenta `gastos` (como un egreso suelto sin cuenta de
      gasto), no en el de la cuenta del impuesto. En devengado, una cuenta
      de pasivo (IVA) no es resultado y no suma.
- [x] Estimado de IVA: descuenta las percepciones de IVA de las compras
      que las tienen repartidas (`imp_perc_iva`, `20261104096400`; las
      compras anteriores quedan como IIBB) y el saldo a favor del mes
      anterior.
- [x] El contador (`fiscal_reader`) ve los impuestos pero no sus adjuntos
      (no tiene `files:read`).
- [x] Herramienta del asistente IA para impuestos (vencimientos y estado).
- [x] El manual HTML no se sirve desde la app: la guía lo cita por nombre
      ("Manual: Contabilidad › Impuestos"), sin link.
- [x] **Deshacer un pago** (`20261104050100`, "Deshacer pago" en el
      impuesto pagado; `taxes:write` + `transactions:write`):
      `undo_tax_document_payment` devuelve el impuesto al importe y estado
      que tenía antes del pago (`payment_previous_amount`,
      `payment_previous_status`, `20261104092200`; un pago anterior a esa
      migración vuelve liquidado, o pendiente si el importe era estimado) y
      deja una línea en las notas. Si lo pagó "Pagar",
      borra el egreso con su asiento; si fue "Vincular", el movimiento queda
      en Caja suelto, con la cuenta de gasto que tenía
      (`tax_documents.payment_previous_expense_account_id`) y el asiento
      rehecho. Rechaza un período cerrado y un egreso de "Pagar" conciliado
      con el extracto (primero se desconcilia). Sin pago no hace nada.
- [x] **Gestión percibido** (`20261104050200`): el pago de un impuesto va
      al rubro de la cuenta del impuesto si está mapeada en
      `management_buckets`, si no a Costos operativos › Impuestos
      operativos. Devengado no cambia.
- [x] **Estimado de IVA**: las retenciones de IVA salen de los recibos
      emitidos (`issued`; antes filtraba un estado inexistente y daban 0),
      en pesos a la cotización del recibo; un recibo en dólares sin
      cotización frena el estimado. Una respuesta de "Estimar" que llega
      después de cambiar el documento, el período o cerrar el diálogo se
      descarta.
- [x] **IA, libros IVA**: `getLibroIvaVentas`/`getLibroIvaCompras` devuelven
      `totals` con signo (NC restadas, cada comprobante una vez) además de
      las filas.
- [x] **Estimado de IVA**: descuenta el saldo a favor técnico del IVA del
      mes anterior (`tax_documents.credit_balance`, `20261104050300`, se
      carga en el impuesto de IVA desde la DDJJ) y muestra aparte los otros
      tributos de las compras.
- [x] Estimado de IVA: las percepciones de IVA sufridas en compras se
      descuentan cuando la compra las reparte. `imp_trib` se reparte en percepción IVA, percepción IIBB,
      municipales e impuestos internos (`20261104096400`); cada parte va a
      su cuenta en el asiento y a su campo en el libro IVA y el TXT.
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
- [x] Aprobar las migraciones `20261104050100` a `20261104050400` con el
      deploy. Rollback: el código anterior no llama a `undo_tax_document_
  payment` ni lee las columnas nuevas; gestión percibido sigue en rubros
      que conoce; las policies nuevas solo agregan filas a un rol al que el
      código viejo no le pide adjuntos. — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [ ] pgTAP verde en CI (stack fresco: `tax_documents_undo_test.sql`); sin verificar contra
      datos de producción. "Deshacer pago", el saldo a favor y "Ver adjuntos"
      no se probaron en el navegador; los casos de ruteo nuevos no se
      corrieron en vivo.
