# Separación fiscal / interno — análisis y opciones

> Estado al **2026-10-31**, sobre `main` en `d5e7a8e`. Solo análisis: este documento
> no cambia código. Se verificó contra las migraciones aplicadas en la DB local
> (definiciones finales de funciones, vistas, triggers y policies) y contra el
> código de `features/`, `lib/` y `app/`. Las referencias son `archivo:línea` o el
> nombre de la función SQL vigente. Las marcadas **(inferido)** se razonaron a
> partir del código pero no se reprodujeron.

**Regla de negocio.** Nada de lo interno puede filtrarse a lo fiscal: comprobantes,
numeración, Libro IVA / Libro IVA Digital, asientos, saldos y cuentas corrientes,
reportes, exports AFIP, dashboards, IA, cobranzas, cheques ni tesorería. Vale para
Logística Jouve (`jouve_fiscal` / `jouve_internal`) y para DZ Instalaciones
(`dz_fiscal` / `dz_internal`).

**Resumen.**

- **Lo fiscal está bien cercado en el núcleo:** emisión AFIP, numeración, Libro IVA
  y asientos automáticos de comprobantes, recibos y OPs.
- **El cerco se rompe donde lo interno toca lo fiscal:** imputaciones (recibo → factura,
  OP → compra), cheques, saldos iniciales, asientos manuales y edición de compras.
  Ahí la DB no valida el canal, y varios defaults de la UI caen en un canal fiscal.
- **Lectura:** lo que sale hacia terceros o se presenta como "facturación" mezcla
  ambos canales sin etiqueta. Eso incluye la cuenta corriente que se le manda al
  cliente, el PDF del recibo y las herramientas de IA.
- **El selector global "Solo fiscal / Solo interno" no filtra nada.**
- **Recomendación:** mantener una sola app y una sola DB, y endurecer la separación
  con invariantes en la DB (opción A, §3), más un rol de solo-lectura fiscal.
  Dividir (schemas, DB o app) no saca el punto de contacto: la plata real (cuentas
  y cheques) es una sola, así que el cruce pasa a ser una sincronización entre
  sistemas.

---

## 1. Cómo se modela el canal hoy

### 1.1 Tablas

`invoicing_channels(id text, business_unit_id, division 'dz'|'jouve', is_fiscal, is_active)`
— 4 filas sembradas en `20260508204342_business_units_channels.sql`. Las cuatro
cuelgan de la misma `business_units` (`dz_sons`, un solo CUIT).

| Tiene `channel_id` (NOT NULL) | Tiene `channel_id` opcional | **No tiene canal** |
|---|---|---|
| `invoices`, `purchase_invoices`, `receipts`, `payment_orders`, `transactions`, `loans`, `payroll_payments` | `journal_entries`, `sales_points`, `shipments`, `trips`, `recurring_payments`, `suppliers.default_channel_id` | `accounts` (bancos/caja), `checks`, `issued_checks`, `clients`, `suppliers`, `client_/supplier_/account_opening_balances`, `*_allocations`, `chart_of_accounts` |

El modelo es **canal por documento**. La plata y los maestros no tienen canal: una
misma cuenta bancaria y un mismo cheque pueden recibir movimientos de los dos
canales. Por eso la frontera se cruza en las imputaciones y en los movimientos de
cheques y cuentas.

### 1.2 Puntos de venta y numeración

- **Puntos de venta:** `sales_points` tiene PK `numero` y un `channel_id`. Seed
  (`supabase/seed.sql:21-25`): 1 = `jouve_internal`, 2 = `dz_internal`,
  3 = `jouve_fiscal`, 4 = `dz_fiscal`. La DB local está recién reseteada y la tabla
  está vacía.
- **Comprobantes:** índice único
  `invoices_unique_numbering (channel_id, punto_venta, kind, letter, numero)`.
  - Fiscal: numera AFIP (CAE) o `emit_caea_invoice` por (pv, cbte_tipo).
  - Interno: `next_internal_invoice_numero_atomic` toma el máximo + 1 por
    (canal, pv, kind), con advisory lock.
  - `issueFiscalInvoiceAction` exige que el POS esté habilitado y pertenezca al canal
    (`loadEnabledPos`, `features/invoices/actions/invoices-actions.ts:98-112`).
- **Recibos y OPs:** únicos por `(channel_id, punto_venta, numero)`. El POS es el de
  número más bajo habilitado del canal
  (`features/receipts/actions/receipts-actions.ts:507-521`,
  `features/payment-orders/actions/payment-orders-actions.ts:366-380`).
- **Compras:** únicas por `(supplier_id, kind, letter, punto_venta, numero)`, sin
  canal. Las internas se numeran con `next_internal_purchase_numero`.

### 1.3 Triggers y RPCs que aplican la separación

| Garantía | Dónde |
|---|---|
| Canal fiscal exige letra, `cbte_tipo_afip` y condición IVA del receptor | trigger `check_invoice_fiscal_fields` |
| Un comprobante fiscal emitido no se anula: solo con NC | trigger `check_fiscal_cancel_requires_nc` |
| Cabecera inmutable post-emisión (incluye `channel_id`) | `check_invoice_immutability` |
| Movimiento de caja atado a comprobante = mismo canal | `check_transaction_channel_matches_invoice` |
| Asientos solo para canales fiscales | `is_channel_fiscal()`, usado por `emit_journal_for_invoice`, `emit_journal_for_purchase_invoice`, `emit_journal_for_receipt`, `emit_journal_for_payment_order` y `generate_journal_for_transaction` (`20260516250000`, `20260517860000`) |
| Libro IVA Ventas/Compras solo fiscal y emitido/recibido | `libro_iva_ventas` / `libro_iva_compras` (`where c.is_fiscal = true`, `20261016140000`). Los usan la pantalla, el XLSX/PDF y el TXT de Libro IVA Digital |
| Interno no pasa por AFIP; numera local; PDF "Documento no fiscal" | `lib/inngest/functions/issue-invoice.ts:283-328`, `lib/pdf/invoice-template.tsx` |
| Interno sin IVA | `computeTotals(items, channel.is_fiscal)` (`invoices-actions.ts:354`) |
| NC/ND de venta: mismo cliente y mismo canal que el origen | solo en la app (`invoices-actions.ts:189-238`). La DB no lo valida |
| Recibo y OP: canal fijo después de crearse | `update_receipt` / `update_payment_order` reusan el canal guardado |
| CAEA solo fiscal | `caea-inform.ts:58` filtra `emission_type='caea'` |

Lo que queda es contabilidad de **"dos cajas"** (`docs/accounting-patterns.md:25`):
el libro diario es solo fiscal y la caja real (cuentas) es consolidada.

### 1.4 RLS y permisos

No hay RLS por canal. `invoices`, `receipts`, `purchase_invoices`, `transactions` y
`journal_entries` se leen con `user_has_role(owner, admin, finance)`: quien ve
facturación ve los cuatro canales. `journal_entries` además tiene una policy `ALL`
para owner/admin. No existe un rol "solo fiscal" (por ejemplo, para un contador
externo). Los permisos `channels:read/write` gatean la configuración de canales,
no los datos.

### 1.5 UI: selector global y filtros

- **Selector global.** `components/scope-selector.tsx` + `lib/scope.ts` (cookie
  `jouve_scope`) ofrece división y "Todos / Solo fiscal / Solo interno". Ninguna
  pantalla lo aplica: `channelsForScope` solo se usa en `lib/scope.test.ts`, y los
  consumidores de `useScope()` leen únicamente la lista de canales.
- **Filtros locales.**
  - Comprobantes, movimientos y asientos tienen filtro de canal, por defecto
    "Todos los canales".
  - Compras filtra fiscal/interno, por defecto "all".
  - Recibos, OPs y cheques no tienen filtro de canal.
- **Default de canal.**
  - `DEFAULT_CHANNEL_ID = "jouve_fiscal"` (`lib/scope.ts:7`): recibos, OPs,
    movimientos, cheques, sueldos masivos y comprobantes.
  - `activeChannels[0]` / `channels[0]`, que es **`dz_fiscal`** por el orden del
    layout: diálogos de IA, pagos de sueldo y saldo inicial de cuenta.

### 1.6 Dónde conviven o se suman a propósito

Estas vistas suman todo por diseño. No se presentan como fiscales, pero tampoco
están etiquetadas como mixtas:

- Cuenta corriente de clientes y proveedores (`v_client_account_movements`,
  `v_supplier_account_movements`).
- Aging (`v_aging_documents`, `v_client_aging`, `v_supplier_aging`;
  `features/aging/actions/aging-actions.ts:17`) y el mail semanal
  (`lib/inngest/functions/aging-weekly-summary.ts:106`).
- Tesorería y saldos de cuentas (`features/treasury/actions/treasury-actions.ts:56-92`).
- Flujo de caja. Separa facturado/interno/otro
  (`transaction_monthly_flows`, `cash-flow-actions.ts`), pero el gráfico del
  dashboard (`features/dashboard/components/cash-flow-chart.tsx`) pierde el corte.
- KPIs del dashboard: Caja, Por cobrar, Por pagar
  (`features/dashboard/components/finance-kpis.tsx:31-68`).
- Insights proactivos de IA y resumen semanal (`features/ai/insights/gather.ts`,
  `features/ai/weekly/reads.ts`).

---

## 2. Fugas y riesgos, por gravedad

Gravedad:

- **Crítica:** contamina libros fiscales o documentos hacia terceros.
- **Alta:** presenta cifras mixtas como fiscales, o deja configurar una fuga.
- **Media:** integridad o confusión sin salida fiscal directa.
- **Baja:** cosmético.

### Críticas

**C1. Un recibo se imputa a facturas de otro canal, y por defecto lo hace solo.**

- **DB:** `guard_receipt_allocation` (`20260704230000_audit_t4_allocation_guards.sql:18-61`)
  valida cliente y saldo, no canal. `create_receipt` tampoco lo valida.
- **App:** si el usuario no elige facturas, el FIFO automático
  (`receipts-actions.ts:551-580`) toma `listPendingComprobantesForClientAction`
  (`:329-371`), que filtra solo por cliente y estado. El picker
  (`features/receipts/components/allocations-picker.tsx:50`) no muestra el canal.
- **Escenario:** un cliente tiene una factura A 00003 vieja impaga (fiscal) y una
  interna 00001 nueva. Se carga un recibo en `jouve_internal` sin elegir facturas y
  el FIFO lo aplica a la factura fiscal.
  - El aging y la cuenta corriente la muestran cobrada.
  - El recibo interno no genera asiento, así que en el mayor la cuenta Clientes la
    sigue mostrando abierta.
  - El caso inverso (recibo fiscal aplicado a factura interna) acredita Clientes en
    el libro por una deuda que nunca se debitó.
  - El PDF del recibo, que se entrega al cliente, lista "Factura 00001-…" interna
    junto a las fiscales (`lib/pdf/receipt-render.tsx:134-150`).

**C2. Mismo problema en compras.**

- `guard_payment_order_allocation` (misma migración, `:64-107`),
  `listPendingInvoicesForSupplierAction` (`payment-orders-actions.ts:257-300`) y el
  FIFO de `:409-432` no miran el canal.
- La NC de compra (`invoice_origin_id`) no valida canal ni proveedor
  (`purchase-invoices-actions.ts:401` alta, `:527` edición; FK simple en
  `20260514191144_purchase_invoices.sql:51`).
- **Escenario:** una NC fiscal de un proveedor se netea contra una compra interna en
  el aging de proveedores. Además, una OP interna cancela una compra fiscal: el
  libro sigue mostrando la deuda con Proveedores, y la app la muestra pagada.

**C3. Cheques: el canal se elige al depositar o rechazar, y no se hereda del recibo
que los trajo.**

- `deposit_check` / `reject_check` reciben `p_channel_id` libre y no lo comparan con
  el canal del `source_receipt_id`. El diálogo usa `jouve_fiscal` por defecto
  (`features/checks/components/check-action-dialogs.tsx:63,263`).
- **Escenario:** un cheque cobrado en un recibo interno se deposita con el default.
  Se crea un `transfer_in` fiscal y `generate_journal_for_transaction` asienta
  Debe Banco / Haber Cheques en cartera, por plata que nunca entró al libro. El
  rechazo en canal fiscal asienta un gasto.
- **Cheques propios y endosados.** Los triggers `emit_journal_for_issued_check_transition`
  (cobro, rechazo o anulación de un cheque propio) y
  `emit_journal_for_endorsed_check_rejected` asientan **sin mirar el canal de la OP
  de origen**, y dejan `channel_id` NULL.
  - Una OP interna que paga con cheque propio no genera asiento.
  - Cuando el banco debita ese cheque, el trigger asienta Debe Cheques diferidos
    emitidos / Haber Banco, por un pasivo que nunca se registró.
  - El libro queda descuadrado contra la realidad fiscal y el asiento no tiene canal.

**C4. Asientos manuales en canal interno, o sin canal, entran al libro fiscal.**

- **Manual:** `features/journal-entries/components/manual-entry-dialog.tsx:163-172`
  lista los canales internos.
- **IA:** `proposeJournalEntry` (`features/ai/registry/actions/proposals.ts:137-215`
  → `lib/commands/create-manual-journal-entry.ts:37`) los crea con canal NULL.
- **DB:** `create_journal_entry` no rechaza canales no fiscales, y `get_account_balances`,
  `get_ledger` y los agregados de IA (`ai_account_type_totals`, etc.) suman todo el
  diario sin filtrar canal.
- **Policy:** la policy `ALL` de `journal_entries` permite a owner/admin escribir
  directo por PostgREST.
- **Escenario:** un asiento manual marcado `jouve_internal` aparece en Libro Mayor,
  Balance, EERR y en la IA, rotulados como "solo canales fiscales"
  (`features/ai/registry/actions/statements.ts:39-40`,
  `accounting.ts:240`).
- `docs/accounting-patterns.md:30-32` sigue diciendo que no hay actions de alta;
  quedó desactualizado.

**C5. Compras: el canal y los importes se editan después de recibida, y el asiento
no se recalcula.**

- `updatePurchaseInvoiceAction` (`purchase-invoices-actions.ts:480-530`) acepta
  `channel_id`, importes, letra y CAE sobre una compra `received`.
  `purchase_invoices_after_update_journal` solo reacciona a `received → cancelled`.
- **Escenario fiscal → interno:** el asiento (IVA crédito) queda en el libro, pero la
  compra sale del Libro IVA Compras.
- **Escenario interno → fiscal:** entra al Libro IVA Compras sin asiento; si después
  se anula, se emite un reverso sin original.
- **Período cerrado:** `accounting_closed_periods` protege asientos, no el Libro IVA,
  así que un período ya presentado puede cambiar.

**C6. Compras: no se validan los campos fiscales según el canal.**

- No hay equivalente de `check_invoice_fiscal_fields` en `purchase_invoices`, y el
  schema (`features/purchase-invoices/schema.ts:141-204`) no condiciona letra ni
  CAE al canal.
- **Escenario:** un gasto sin factura cargado en canal fiscal (default del form:
  `activeChannels[0]` o el `default_channel_id` del proveedor,
  `purchase-invoice-form.tsx:188,351-358`) entra al Libro IVA Compras y genera
  crédito fiscal.
- Al revés, una factura A real cargada en un canal interno pierde el crédito.

**C7. Saldo inicial de una cuenta: el canal por defecto es fiscal.**

`apply_account_opening_balance` inserta un movimiento en el canal elegido. El
diálogo usa `channels[0]` = `dz_fiscal` por defecto
(`features/accounts/components/account-opening-balance-dialog.tsx:68`). Si el
canal es fiscal, el ajuste (incluida la plata no declarada) se asienta en el libro.

**C8. Documentos y exports hacia terceros mezclan canales.**

- **Cuenta corriente del cliente.** El PDF/XLSX
  (`app/api/export/resources/client-account.ts`, botón pensado para "mandar el
  resumen mensual", `components/export-button.tsx:42`) mezcla fiscal e interno en un
  solo saldo, sin columna de canal. El cliente ve los comprobantes internos.
  Proveedores: idem (`supplier-account.ts`).
- **PDF del recibo.** Es la misma plantilla para fiscal e interno: mismo CUIT, sin
  marca, y el número solo cambia por POS (`lib/pdf/receipt-template.tsx`).
- **PDF de factura interna.** Tiene marca de agua "NO FISCAL" y "Documento no
  fiscal", pero el título sigue siendo "Factura" / "Nota de Crédito" y lleva CUIT,
  condición IVA, IIBB e inicio de actividades reales
  (`lib/pdf/invoice-template.tsx:269-520`, `lib/pdf/generate-and-store.ts:163-165`).
  Recortada la marca, pasa por factura.
- **Export genérico.** `/api/export/[resource]` para comprobantes, recibos, OPs y
  movimientos ignora los filtros de pantalla (`_params`,
  `app/api/export/resources/invoices.ts:27`). Siempre exporta ambos canales, y el de
  comprobantes no tiene columna de canal.

### Altas

**A1. La IA presenta cifras mixtas como facturación o crédito fiscal.**

- **Crédito fiscal.** `getPurchaseInvoices`
  (`features/ai/registry/actions/purchases.ts:33-82`) se describe como apta para
  "VAT credit" e incluye el IVA cargado en compras internas. La action subyacente
  acepta `isFiscal` (`purchase-invoices-actions.ts:87`), pero la tool no lo expone.
- **Facturación.** `getInvoices` y `getClientSalesSummary`
  (`features/ai/registry/actions/sales.ts:22-196`, SQL `ai_client_sales_summary`),
  y con ellas el resumen semanal (`features/ai/weekly/reads.ts:28-32`), responden
  "facturado $X" sumando los cuatro canales.
- **Prompt y scope.** El system prompt (`features/ai/agent.ts:40`) no enuncia la
  regla, y el chat ignora el scope.
- **Filtro de canal.** Las tools describen `channelId` como "Channel UUID", pero los
  ids son slugs, y no hay una tool que liste canales: el filtro es casi inusable.
- Solo `getLibroIvaVentas` / `getLibroIvaCompras` son estrictamente fiscales.

**A2. El selector global "Solo fiscal" no filtra nada.** Da una sensación de
aislamiento que no existe, justo antes de exportar o de mirar un saldo.

**A3. Los defaults de canal caen en un canal fiscal, y no siempre en el correcto.**

- Los formularios usan `jouve_fiscal` por defecto.
- Los diálogos de IA (`create-sales-invoice-dialog.tsx:63`,
  `create-payment-doc-dialog.tsx:120`) y pagos de sueldo (`payroll-payments-dialog.tsx:162`)
  usan `dz_fiscal`.
- **Escenario:** una factura escaneada de Jouve se emite a AFIP bajo el POS de DZ si
  nadie cambia el select. Para el usuario, el error más probable es el silencioso:
  mandar a fiscal algo interno porque el campo ya venía lleno.

**A4. La configuración de canales y POS puede reclasificar el histórico.**

- **`is_fiscal` editable.** Owner/admin puede hacer `UPDATE` de
  `invoicing_channels.is_fiscal` (RLS de `20260508204342`). Como el Libro IVA y los
  asientos se resuelven por join al canal, el histórico cambia de lado: el libro ya
  presentado cambia y los asientos existentes no se revierten.
- **POS.** `ConfigurePosSchema` (`features/afip-admin/schema.ts:7`) acepta cualquier
  `channel_id`: un POS fiscal se puede mapear a un canal interno.
  `syncAfipPosAction` (`afip-admin-actions.ts:107-170`) hace upsert de los POS de
  AFIP por número sin tocar el canal **(inferido)**. Si AFIP tuviera un POS 1 o 2,
  el canal interno quedaría numerando con un POS fiscal real, y los internos
  00001-… serían indistinguibles de comprobantes AFIP.
- **Cambio de POS.** Habilitar un POS de número más bajo mueve en silencio la
  numeración de recibos y OPs de ese canal.

**A5. No hay aislamiento por rol.** Sin RLS por canal no se puede dar acceso de
lectura solo a lo fiscal (contador, auditor, export automatizado). Cualquier
`finance` ve y exporta lo interno.

### Medias

- **M1. Edición de movimientos sin re-asentar.** `updateTransactionAction`
  (`features/transactions/actions/transactions-actions.ts:360-368`) cambia importe y
  fecha de movimientos sueltos, pero el asiento solo se genera en INSERT
  (`generate_journal_for_transaction`). En sueldos, `payroll_payment_sync_transaction`
  re-etiqueta canal e importe del movimiento sin tocar el asiento: un pago de sueldo
  movido de fiscal a interno deja el gasto en el libro.
- **M2. Facturas de flete y storage.** El canal se elige libre (default del envío,
  `features/shipments/actions/shipments-actions.ts:352-470`) y no se valida contra
  el canal del envío o viaje; la lista incluye canales inactivos. En storage, el
  guard de solapamiento ignora el canal. Además, `features/storage-billing/schema.ts:13`
  valida `channel_id` como UUID, así que hoy **toda** facturación de storage falla
  con "Canal requerido." (bug aparte).
- **M3. Saldos iniciales de clientes y proveedores sin canal.** Sus imputaciones
  (`client_opening_balance_allocations`) cancelan facturas de cualquier canal: el
  mismo patrón que C1, con menor volumen.
- **M4. Vistas consolidadas sin etiqueta.** Aging, KPIs, insights y el mail semanal
  suman los dos canales. Es aceptable para gestión, pero no dice "incluye interno".
  `v_aging_documents` expone `channel_is_fiscal` y nadie lo usa.
- **M5. Anomalías de compras.** `features/ai/insights/anomalies/gather.ts:27-48`
  cruza canales e incluye anuladas.

### Bajas

- `app/api/accounting/libro-iva-request.ts:43` acepta un canal interno y devuelve un
  libro vacío con el nombre del canal interno en el encabezado.
- `lib/pdf/receipt-render.tsx:143-145` compara `credit_note` / `debit_note` cuando los
  kinds son `nc` / `nd`: las NC/ND imputadas salen sin etiqueta.
- `getChecks` / `getIssuedChecks` (`features/ai/registry/actions/cash.ts:99,130`)
  suman ARS y USD en un solo total.

---

## 3. Opciones de separación

Un punto aplica a todas las opciones. Los comprobantes se separan sin esfuerzo,
porque ya tienen canal. Lo que no se puede separar son **las cuentas bancarias, la
caja, los cheques y los clientes y proveedores**: son una sola realidad. Toda
opción tiene que decidir qué pasa en ese borde (imputación, cheque, depósito,
saldo inicial). Las fugas de §2 están todas ahí. Dividir la base no elimina el
borde: lo convierte en una sincronización entre sistemas.

### Opción A — Endurecer la separación lógica (una app, una DB) · **recomendada**

Convertir las reglas en **invariantes de base de datos**, más una capa de lectura
fiscal explícita.

**1. Invariantes de escritura** (migraciones con triggers; los nombres son
propuestas):

- **Imputaciones.** `receipt_allocations`, `payment_order_allocations`,
  `client_/supplier_opening_balance_allocations` y el `invoice_origin_id` de compras
  y ventas exigen el **mismo canal** entre los dos documentos. Hoy la NC/ND de venta
  ya lo valida en la app; falta en la DB.
- **Cheques con canal.** Agregar `channel_id` a `checks` (heredado del recibo) y a
  `issued_checks` (heredado de la OP). `deposit_check` y `reject_check` lo toman del
  cheque, no de un parámetro. Los triggers de asientos de cheques preguntan
  `is_channel_fiscal`.
- **`create_journal_entry`** rechaza canales no fiscales, y los asientos manuales
  quedan atados a un canal fiscal obligatorio. Se quita la policy `ALL` de
  `journal_entries`, porque solo los RPC escriben.
- **`purchase_invoices`:**
  - Trigger `check_purchase_fiscal_fields`: letra obligatoria en canal fiscal.
  - Canal inmutable desde `received`; editar importes re-asienta (reverso + nuevo) o
    se bloquea.
  - Guard de período cerrado también sobre el Libro IVA.
- **Configuración.** `invoicing_channels.is_fiscal` inmutable si el canal tiene
  documentos. `sales_points.channel_id` inmutable si el POS tiene numeración.
  `ConfigurePosSchema` valida que el canal y el POS sean del mismo tipo.
- **Saldo inicial de cuenta:** canal explícito, sin default.

**2. Capa de lectura fiscal.**

- Vistas o RPCs `fiscal_*` (o un filtro `is_fiscal` obligatorio) como **única**
  fuente de todo lo que se presenta como fiscal: libros, balance, IA, exports.
- Rol de DB `fiscal_reader` con RLS por `is_fiscal`. Sirve para un contador
  externo, para exports automatizados y para la IA cuando responde "fiscal".
- Esto da el aislamiento que se buscaría con una DB aparte, con mucho menos costo.

**3. App y UI.**

- Scope global real: aplicado en listas, exports y la IA. Si no se va a aplicar,
  sacarlo.
- Sin defaults de canal en documentos de plata: elegir el canal explícitamente.
- Columna "Canal" en todos los exports.
- Cuenta corriente y PDF de cuenta separables por canal; el que se manda al cliente,
  por canal.
- PDF interno con otro título ("Comprobante interno") y sin datos fiscales del
  emisor.
- IA:
  - Regla explícita en el prompt.
  - Tool `listChannels`.
  - Parámetro `scope` obligatorio en tools de montos.
  - `getPurchaseInvoices` con `isFiscal`.
  - Etiqueta "incluye internos" en los resúmenes mixtos.

**4. Verificación continua.**

- **pgTAP:** ningún `journal_entry` con fuente de canal no fiscal; ninguna
  imputación cruzada.
- **Cron Inngest de conciliación:** saldo de Clientes y Proveedores del mayor contra
  el aging fiscal, alertando ante diferencias.
- Cerca ESLint o test que impida leer las tablas de documentos sin pasar por un
  helper con scope.

**Datos existentes.** Antes de activar los triggers, una consulta de diagnóstico
lista las imputaciones cruzadas, los cheques depositados en un canal distinto al
de su recibo y los asientos manuales internos. Esos casos se corrigen a mano, y
recién después el constraint se activa.

| | |
|---|---|
| **Pros** | Mantiene la unificación (un login, maestros únicos, tesorería y aging consolidados). Arregla el problema donde está (el borde). Incremental, compatible con la ventana de deploy (constraints `NOT VALID` → `VALIDATE`). |
| **Contras** | La separación sigue dependiendo de que cada consulta nueva use la capa fiscal. Se mitiga con el rol `fiscal_reader`, los tests y la cerca. |
| **Costo** | Fase 1 (C1–C7, invariantes DB): ~1 semana. Fase 2 (lectura fiscal, RLS `fiscal_reader`, IA, exports, PDFs, scope): ~1–2 semanas. |
| **Riesgos** | Datos históricos que violan los nuevos invariantes (se diagnostican primero). Flujos reales que hoy dependen del cruce, por ejemplo un recibo interno que cancela una factura fiscal: hay que decidir si eso existe en el negocio, y si existe, modelarlo explícito (ver la nota al final). |

### Opción B — Schemas separados en la misma DB (`fiscal.*`, `interno.*`)

Duplicar las tablas de documentos por schema, con maestros y tesorería en `public`.

- **Pros:** aislamiento a nivel de grants (un rol sin `USAGE` sobre `interno` no
  puede leerlo). Es imposible un join accidental.
- **Contras:**
  - Duplica cada tabla, RPC, trigger, vista y migración de documentos (decenas).
  - Las features y la IA pasan a tener dos variantes.
  - El aging y la tesorería consolidados vuelven a juntar todo con `UNION`.
  - Las imputaciones y los cheques siguen cruzando `public`, que es el mismo borde
    de hoy.
  - Requiere exponer schemas extra en PostgREST y regenerar tipos.
- **Costo:** ~6–10 semanas, con migración de datos y riesgo de regresiones en toda
  la app.
- **Riesgos:** dos fuentes que divergen. Termina cubriendo, con más trabajo, lo
  mismo que el rol `fiscal_reader` de la opción A.

### Opción C — DB separada (otro proyecto Supabase para lo fiscal o lo interno)

- **Pros:** aislamiento físico. Se le puede dar al contador acceso total a una DB
  que no contiene nada interno. Backups y retención separados.
- **Contras:**
  - Clientes, proveedores, cuentas, cheques y plan de cuentas se duplican y se
    sincronizan. Un cheque recibido internamente y depositado en el banco fiscal
    tiene que cruzar entre DBs.
  - Los reportes consolidados (caja real, aging total, IA de gestión) pasan a ser
    federados.
  - Dos Supabase, dos cadenas de migraciones, dos `database.types.ts`, el doble de
    costo de infraestructura.
  - Las transacciones atómicas entre documento y plata se pierden: hacen falta
    sagas e idempotencia.
- **Costo:** ~2–3 meses.
- **Riesgos:** inconsistencias de sincronización. Además, el borde se vuelve más
  difícil de auditar, no más fácil.

### Opción D — App separada (dos productos)

- **Pros:** separación máxima, incluso operativa (usuarios, deploys, dominio).
- **Contras:**
  - Abandona el objetivo de unificar.
  - Duplica mantenimiento, UI e IA.
  - El usuario carga dos veces lo que es una sola operación (cobro con cheque).
  - La visión consolidada se pierde o se arma a mano.
- **Costo:** C más la duplicación del front, de forma indefinida.
- **Riesgos:** deriva entre las dos apps, y doble carga con errores de transcripción.

### Comparación

| | A. Lógica endurecida | B. Schemas | C. DB separada | D. App separada |
|---|---|---|---|---|
| Unificación | Total | Total (con `UNION`) | Parcial (sync) | No |
| Aislamiento de lectura | Alto (RLS `fiscal_reader`) | Alto (grants) | Total | Total |
| Fugas de escritura en el borde | Cerradas por invariantes | Siguen en `public` | Pasan a la sync | Pasan a la carga manual |
| Costo | ~2–3 semanas | ~6–10 semanas | ~2–3 meses | > C, recurrente |
| Riesgo de regresión | Bajo | Alto | Alto | Medio, recurrente |

### Recomendación

**Opción A, en dos fases, con el rol `fiscal_reader` como pieza central.**

1. **Fase 1, inmediata.** Cerrar las críticas C1–C7 con invariantes en la DB,
   previa consulta de diagnóstico de datos, y sacar los defaults de canal en
   documentos de plata.
2. **Fase 2.**
   - Capa de lectura fiscal + RLS `fiscal_reader`.
   - Exports, PDFs y cuenta corriente por canal.
   - IA con scope obligatorio y regla en el prompt.
   - Scope global aplicado.
   - pgTAP y el cron de conciliación.

Con eso, todo lo que es fiscal (libros, AFIP, balance, mayor, lo que se manda a
terceros y lo que responde la IA como "fiscal") sale de una capa que, por
construcción y por permisos, no puede leer lo interno. La app sigue siendo una
sola.

**Decisión de negocio pendiente.** ¿Existen hoy cobros o pagos que crucen canales a
propósito? Por ejemplo, un cliente que paga en un solo recibo facturas fiscales e
internas, o un cheque recibido internamente que se deposita en el banco. Si existen,
la opción A no debería prohibirlos a ciegas, sino modelarlos explícitamente: un
recibo por canal, y un movimiento "traspaso interno → fiscal" con su asiento
fiscal correcto. Así el cruce queda visible y auditable en lugar de implícito.
