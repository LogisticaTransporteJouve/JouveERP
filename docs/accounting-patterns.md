# Contabilidad — Patrones de arquitectura (Fase L + D)

> Spec del subsistema contable de JouveERP: plan de cuentas, asientos automáticos,
> caja/transactions, libros (diario, mayor, IVA), balances, centros de costo y
> ajuste por inflación. Generado de una auditoría del código (migraciones
> `20260516200000`–`20260517200000` + hotfixes/round-audits, `features/{chart-of-accounts,
> journal-entries,libro-mayor,libro-iva,balance,transactions,cost-centers,inflation}/`).
> Ver también `docs/roadmap.md` §4.2 (Fase L) y §3.1 (Fase D).

---

## 0. El flujo contable de punta a punta

```
  Fase D                Fase L.2 (triggers)         Fase L.3/L.4/L.5 (reads)
  ────────              ───────────────────         ───────────────────────
  transactions ─┐
  invoices      ├─►  asientos automáticos  ─►  journal_entries  ─►  libro diario  (/accounting/journal)
  purchase_inv. │    (SECURITY DEFINER)         + journal_entry_lines  libro mayor  (get_ledger)
  receipts      │    create_journal_entry                              balances     (get_account_balances)
  payment_orders┘    resuelve cuenta por                               libro IVA    (libro_iva_ventas/compras)
  issued/recv checks  system_role del plan
```

**Dos cajas, no una.** Solo los **canales fiscales** (`invoicing_channels.is_fiscal
= true`) generan asientos. Los canales internos son operativos y **nunca** llegan
al libro. Consecuencia intencional: la "caja real" (todas las cuentas) diverge de
la "caja contable" (solo fiscal).

**El motor son triggers, no la UI.** `journal_entries` es de **solo lectura** desde
la app — no hay actions de alta/edición. Los asientos los generan triggers
`SECURITY DEFINER` sobre las tablas de origen, vía el RPC `create_journal_entry`.

---

## 1. Modelo de permisos (RBAC)

`accounting:read` y `accounting:write` (Fase L) → **owner, admin, finance**.
`transactions:read` (Fase D) → owner/admin/finance; `transactions:write` →
**owner, finance**. `operations`/`warehouse`/`driver` no tienen `accounting:*` ni
`transactions:*`. Todas las páginas `/accounting/*` y `/transactions` gatean con
`userCan(ctx.roles, …)` y redirigen a `/dashboard` si falta.

> ✅ **Asimetría action vs RLS en DELETE — corregido** (`deleteChartAccountAction`
> y `deleteTransactionAction`). Antes chequeaban solo el permiso de escritura y la
> policy de DELETE de RLS, más estricta, bloqueaba después en la DB:
> - `deleteChartAccountAction` ahora exige **owner/admin** (= RLS de `chart_of_accounts`).
> - `deleteTransactionAction` ahora exige **owner** (= RLS de `transactions`).
> - RPCs de apertura: `apply_account_opening_balance` / `apply_supplier_opening_balance`
>   = **owner** only (los de cliente, owner/admin/finance) — sin cambios.
>
> No rompe seguridad (RLS es la última palabra), pero el usuario ve un error de DB
> en vez de un gate limpio. Considerar alinear el gate del action a la RLS.

---

## 2. Plan de cuentas — `chart_of_accounts` (L.1)

Árbol jerárquico, fundamento de todo. Migración `20260516200000_chart_of_accounts`
(seed completado en `…205000_chart_of_accounts_seed_fix`).

**Columnas clave:** `id`, `parent_id` (self-FK `ON DELETE RESTRICT`), `code text
UNIQUE` (regex `^[0-9]+(\.[0-9]+)*$`, ej. `1.1.2.3`), `name`, `level int` (CHECK
1..8), `account_type` (enum), `eerr_category text` (agrupa el EERR), `system_role`
(enum, **partial UNIQUE** `WHERE system_role IS NOT NULL AND is_active=true`),
`is_active`.

- **`account_type`** (enum `coa_account_type`, 6): `activo, pasivo, patrimonio,
  resultado_positivo, resultado_negativo, orden` (`orden` = cuentas de orden, sin
  impacto patrimonial).
- **`system_role`** (enum `coa_system_role`, **19**): `caja, banco, clientes,
  proveedores, iva_debito, iva_credito, iva_percibido, iva_retenido,
  percepciones_iibb_pagadas, percepciones_iibb_cobradas, retenciones_pagadas,
  retenciones_cobradas, ventas, compras, gastos, cheques_cartera,
  cheques_diferidos_emitidos, caja_apertura, ajustes_caja`.

**`system_role` es el puente a los asientos automáticos (§3).** El RPC
`find_account_by_role(role)` devuelve la única cuenta **activa** con ese rol; el
partial-unique garantiza unicidad. Desactivar una cuenta libera el rol para otra.

**RLS:** SELECT a cualquier `authenticated` (`USING (true)`); INSERT/UPDATE
owner/admin/finance; **DELETE owner/admin** (finance no borra en DB — §1).

**Server actions** (`accounting:read`/`accounting:write`):
`listChartOfAccountsAction`, `createChartAccountAction` (deriva `level` y el
`parent` esperado del `code`; mapea unique-violation de `code`/`system_role` a
mensajes claros), `updateChartAccountAction` (`code`/`parent_id` **no** editables),
`deleteChartAccountAction` (pre-chequea hijos; FK `RESTRICT` + mensaje si hay
movimientos).

**UI:** `/accounting/chart` — árbol expandible (`ChartOfAccountsTree`), orden
numérico por segmento (`compareCodes`, no lexicográfico), `ChartAccountDialog`
(centrado) con código auto-sugerido (`suggestChildCode`). Hooks en
`use-chart-of-accounts.ts`.

> **Seeded:** 5 capítulos (Activo/Pasivo/Patrimonio/Resultados +/−) + asignación de
> 18 de los 19 `system_role`. **`caja_apertura` queda sin asignar** out-of-the-box.

---

## 3. Asientos — `journal_entries` (L.2)

Libro mayor de partida doble, **generado automáticamente**. Foundation:
`20260516210000_journal_entries_foundation` + varios hotfixes (`…215000`,
`…250000`, `…517860000`) y endurecimiento de RLS (`…517820000_post_audit_round3`).

### 3.1 Tablas

- **`journal_entries`** (header): `entry_date`, `accrual_period` (text `YYYY-MM`,
  devengado — puede diferir del `entry_date`), `description`, `source_table` +
  `source_id` (**FK informal**, sin constraint, porque la tabla destino varía),
  `channel_id` (FK real), `is_reversal` + `reversed_entry_id` (self-FK, contra-asiento),
  `cost_center_id` (FK, dormante — §8).
- **`journal_entry_lines`**: `chart_of_accounts_id` (FK `RESTRICT`), `debit`/`credit`
  `numeric(18,2)`, CHECK `jel_debit_or_credit_exclusive` (exactamente uno > 0).
- **`auto_journal_mapping`**: tabla de override para mapeos no-1:1 (ej. IIBB por
  jurisdicción). **Existe con RLS pero NINGÚN generador la lee hoy** — scaffolding
  a futuro (§11).

**RLS** (endurecida en round3): SELECT `journal_entries`/`_lines`/`auto_journal_mapping`
solo **owner/admin/finance**; escritura directa solo owner/admin (escape hatch de
soporte). Las escrituras reales van por funciones `SECURITY DEFINER`, nunca INSERT
directo de `authenticated`.

### 3.2 El RPC central — `create_journal_entry`

`SECURITY DEFINER`. Inserta header + itera las líneas jsonb; cada línea trae
`account_id` directo (gana) **o** un `system_role` resuelto vía
`find_account_by_role` (`P0002` si no hay cuenta para el rol; `22023` si no trae
ninguno). Hace `set constraints jel_enforce_balance deferred` al **inicio** (fix
`…215000`: un call previo en la misma tx dejaba el constraint IMMEDIATE) y
`immediate` al **final** (para propagar el error de balance al caller).

### 3.3 Trigger de balance

`enforce_journal_balance()` corre como **CONSTRAINT TRIGGER `jel_enforce_balance`,
DEFERRABLE INITIALLY DEFERRED** sobre `journal_entry_lines`. Suma debe/haber por
asiento; si `Σdebe ≠ Σhaber` levanta `23514`. DEFERRED permite insertar el header +
todas las líneas en una transacción antes del check.

### 3.4 Generadores por tabla de origen (triggers)

Cada tabla operativa tiene triggers `AFTER` que emiten/revierten/borran su asiento:

| Origen | Trigger / regla |
|---|---|
| `transactions` | AFTER INSERT → un asiento; **saltea** `invoice_id` (L.2c), `receipt_id`/`payment_order_id` (L.2d, anti-doble-conteo), `transfer_out` (solo `transfer_in` emite), y canal no fiscal. |
| `invoices` (ventas) | INSERT si `emitted`; `emitted→cancelled` emite **reversal**; guard que **bloquea** cancelar si hay allocations de recibo activas (`22023`). |
| `purchase_invoices` | INSERT si `received`; `received→cancelled` reversal; editar `purchase_invoice_items` **regenera** el asiento (statement trigger). |
| `receipts` / `payment_orders` | **CONSTRAINT TRIGGER DEFERRED en el header** (dispara en COMMIT, así las payment-lines hijas ya son visibles); `issued`; `issued→canceled` reversal. |
| `issued_checks` | `emitted→cashed/rejected/cancelled` → egreso banco / reversa de pasivo. |
| `checks` (endosados) | `endosado→rechazado` → Debe `cheques_cartera` / Haber `proveedores`. |

### 3.5 Reglas de negocio (asientos)

- **Fiscal-only** (`is_channel_fiscal`): solo canales fiscales generan asientos.
- **Anti-doble-conteo** (fix `…250000`): el generador de `transactions` saltea filas
  con `invoice_id`/`receipt_id`/`payment_order_id` (ya cubiertas por su header).
- **Zero-total guard** (fix `…517860000`): `emit_journal_for_invoice` /
  `…purchase_invoice` retornan null si `imp_total <= 0` — un comprobante en cero
  crearía una línea `debit=0/credit=0` (viola el CHECK, `23514`) que el handler
  `P0002`-only no atrapa y voltearía un batch entero de import AFIP.
- **Reversal model:** la cancelación crea un asiento **nuevo** `is_reversal=true` +
  `reversed_entry_id` (invierte debe/haber); nunca borra el original (auditoría).
  El DELETE de la fila origen sí hace hard-delete del asiento (cascade a líneas).
- **Mapeo cuenta→rol** (`coa_role_for_account`): `bank/investment→banco`,
  `cash/wallet→caja`, `checks/echeq→cheques_cartera`.
- **Asiento de venta (fiscal):** Debe `clientes` total; Haber `ventas`/`iva_debito`/
  `percepciones_iibb_cobradas`. NC invierte (`v_kind_factor=-1`). Compra: Debe
  `compras`/`iva_credito`/`percepciones_iibb_pagadas`; Haber `proveedores`.
- **Backfill:** cada migración de auto-journal termina con un `DO $$` que emite los
  asientos faltantes de las filas ya existentes; `P0002` (rol sin cuenta) se traga
  como NOTICE para ser re-ejecutable tras asignar el rol. No hay script aparte.

### 3.6 UI

`/accounting/journal` (`JournalList`, solo lectura, infinite scroll, filtros
período/origen/canal). `JournalEntryRow` marca reversals (icono `Undo2`) y avisa si
un asiento está desbalanceado (>0.005). Linkea al origen vía `SOURCE_HREF_PREFIX`
(transactions/invoices/receipts/payment_orders; purchase_invoices/issued_checks/checks
sin link). El filtro de origen **no expone `purchase_invoices`**.

---

## 4. Caja / `transactions` (Fase D)

Ledger de movimientos etiquetado por canal. Cada movimiento va a un canal
(`jouve|dz`, `fiscal|internal`) y a una cuenta de caja.

**`transactions`:** `account_id`, `channel_id` (NOT NULL), `kind` (`income|expense|
transfer_in|transfer_out`), `amount > 0`, `currency` (`ARS|USD`), `transaction_date`,
`accrual_month` (CHECK día=1, mes de devengado del cashflow), `transfer_pair_id`
(self-FK **DEFERRABLE**), `invoice_id`/`receipt_id`/`payment_order_id`/
`counterparty_*` (FKs). **Realtime ON.** Vista `v_transactions_tagged`
(`security_invoker`) enriquece con división/fiscal/cuenta.

**RLS:** SELECT owner/admin/finance; INSERT/UPDATE owner/finance; **DELETE owner** only.

**Transferencias atómicas:** `create_transfer` (RPC) inserta los dos lados
(`transfer_in` ↔ `transfer_out`) reservando los UUID antes para que cada uno apunte
al otro (requiere el FK DEFERRABLE, hotfix `…216000`). Solo misma moneda
(cross-currency diferido a J.7). Trigger `transactions_kind_pair_consistency`:
transfers requieren `transfer_pair_id`, income/expense lo prohíben.

**Saldos de apertura** (3 niveles, todos por RPC `SECURITY DEFINER`):
- **Por cuenta** (`account_opening_balances`): materializa una **transacción de
  ajuste** = diff entre `target_balance` y el saldo calculado. Owner-only.
- **Por cliente / proveedor** (`client/supplier_opening_balances` + `…allocations`):
  **imputación FIFO** contra facturas+NDs pre-corte (NCs excluidas), **sin** crear
  transacción — ajusta el aging. Proveedor es net de OPs pagadas y owner-only.

**Server actions** (`transactions:read`/`write`): `listTransactionsAction` (sobre
`v_transactions_tagged`, sort triple con `id` tiebreaker para no duplicar pares de
transfer entre páginas), `getTransactionByIdAction`, `createTransactionAction`
(rechaza transfers y cuentas `checks/echeq`), `createTransferAction`,
`updateTransactionAction` (solo header; `account/channel/kind` inmutables),
`deleteTransactionAction` (cascade al par; AFTER DELETE borra el asiento).

**UI:** `/transactions` (título "Caja"), `TransactionForm` 3-way (income/expense/
transfer), filtros sincronizados a URL, `useRealtimeInvalidate`.

---

## 5. Libro diario + libro mayor (L.3)

Ambos **solo lectura** sobre `journal_entries`/`_lines`.

- **Libro diario** = el feature `journal-entries` (§3.6), `/accounting/journal`,
  filtra por `accrual_period`.
- **Libro mayor** = feature `libro-mayor`, `/accounting/libro-mayor`, RPC
  **`get_ledger(account_id, from, to)`** (`SECURITY INVOKER`): líneas de una cuenta
  con **saldo running** = `Σ(debit−credit) OVER (ORDER BY entry_date, entry_id,
  line_id)`. Filtra por `entry_date` (no `accrual_period`). El action
  `getLedgerAction` trunca a **`LEDGER_MAX_ROWS=1000`** en app (no en DB) y avisa.

`get_ledger` y `get_account_balances` viven en `20260517200000_l_closure.sql`.

> **Sin exports** de libro diario/mayor (no hay PDF/Excel/CSV) — solo los libros IVA
> tienen export (PDF).

---

## 6. Libros IVA Ventas y Compras (L.4, RG 1361)

Reportes fiscales de solo lectura. Dos RPCs `SECURITY INVOKER`:
**`libro_iva_ventas(period, channel_id?)`** (mig `…260000`) sobre `invoices`/
`invoice_items`, y **`libro_iva_compras(…)`** (mig `…270000`) sobre
`purchase_invoices`/`purchase_invoice_items`. Devuelven **una fila por (comprobante
× alícuota)**; el front agrupa a una fila por comprobante con `per_rate[iva_rate_id]`.

- **Fiscal-only por diseño:** ambos filtran `channel.is_fiscal=true`. Ventas =
  `status='emitted'`; Compras = `status='received'`.
- **Alícuotas** (columnas): 0% / 2.5% / 5% / 10.5% / 21% / 27% (`iva_rate_id` ∈
  3,8,9,4,5,6).
- **Sin-desglose fallback:** comprobantes sin items (legacy AFIP, ~1313 de K.2) →
  fila sintética `iva_rate_id=NULL` con `imp_neto/imp_iva` del header.
- **En pesos** (mig `20261016140000_multicurrency_reports`): `neto`, `iva` e `imp_*`
  son el importe × la `cotizacion` del propio comprobante (la informada a AFIP),
  redondeado a 2 decimales por campo; `PES` va a 1. `moneda`, `cotizacion` y
  `*_orig` (importes en la moneda del comprobante) quedan para trazabilidad. La
  pantalla lista los comprobantes en moneda extranjera y avisa los que tienen
  cotización 1. El TXT de Libro IVA Digital (`lib/citi.ts`) usa `*_orig` + código
  de moneda + tipo de cambio, como lo espera ARCA.
- **Aging por moneda:** `v_client_aging`/`v_supplier_aging` exponen `ars_*` y
  `usd_*` por separado; el total único (pantallas, dashboard, PDF, IA) es el
  equivalente en pesos al último dólar oficial (`lib/fx.ts`, `lib/aging.ts`), o
  ninguno si hay USD y no hay cotización cargada.
- **Validación pre-presentación advisoria** (no bloquea): banner ámbar con "N sin
  CAE" / "N sin desglose". El **export PDF no está gateado** por estas alertas.
- **Export:** solo **PDF** (`@react-pdf`, A4 landscape), rutas
  `GET /api/accounting/libro-iva-{ventas,compras}/pdf`. **No hay Excel/CSV/SIAP** (RG
  1361 se nombra en el copy/footer pero no hay generador de archivo AFIP).

> ✅ **Discrepancia de etiqueta de alícuota (SQL ↔ TS) — corregido.** La constante
> TS `IVA_RATES` (features/libro-iva/schema.ts) ahora mapea `8→5%`, `9→2.5%`,
> alineada con el CASE de los RPCs y con `lib/afip/codes.ts`. Test en
> `schema.test.ts`. (Antes estaba swapeada: `8→2.5%`, `9→5%`.)
>
> ⚠️ **Export PDF bypassa RLS:** las rutas PDF usan `getServiceClient()` (service
> role) — RLS no aplica en el export, solo el check `accounting:read` de la ruta.
> Además `purchase_invoices` tiene SELECT RLS `USING(true)` (más laxo que `invoices`,
> que es owner/admin/finance): para compras, el gate efectivo es el `accounting:read`
> del action.

---

## 7. Balances — `get_account_balances` (L.5)

Feature `balance`, `/accounting/balance`, un solo RPC y 3 vistas en tabs.

**`get_account_balances(period_end, period_start?)`** (`SECURITY INVOKER`): por
cuenta activa, `total_debit/total_credit/balance` acumulados por `accrual_period <=
period_end` (y `>= period_start` si se pasa). `HAVING` descarta cuentas sin
movimiento. ✅ **El filtro de rango (`period_start`) ya está activo en la UI** — la
página de Balance tiene un control "Desde (opcional)" que acota a movimientos del
rango `[desde, corte]` (antes la UI siempre pasaba `period_start=null`).

Tres tabs (un solo fetch las alimenta):
- **Balance de saldos:** `Σdebe = Σhaber` (banner verde/rojo, tolerancia 0.01).
- **Estado de Resultados (EERR):** agrupa por `eerr_category`; convención de signo:
  `resultado_positivo` lleva saldo negativo → `computeEERR` lo flipea (Ingresos
  `sign=-1`, Gastos `sign=+1`); `resultado = ingresos − gastos`.
- **Balance General:** activo as-is; pasivo/patrimonio negados; inyecta "Resultado
  del período" en Patrimonio; check ecuación `Activo = Pasivo + PN`.

**Sin export propio.** Balances/EERR solo HTML en pantalla (el exportador PDF
genérico de `app/api/export/[resource]` cubre otros recursos, no estos).

---

## 8. Centros de costo — `cost_centers` (L.9)

Dimensión contable opcional. Migración `…517200000_l_closure`.

**`cost_centers`:** `code text UNIQUE` (regex `^[A-Z0-9_-]+$`, inmutable post-creación),
`name`, `description`, `is_active`. Seed: `FLOTA_DZ`, `FLOTA_JOUVE`, `ADMIN`.
RLS: SELECT `authenticated`; manage owner/admin/finance. CRUD vía
`{list,create,update,delete}CostCenterAction` (`accounting:read`/`write`),
`/accounting/cost-centers`.

> ⚠️ **Dimensión escrita a medias — no reportable.** La columna `cost_center_id`
> (FK nullable, `ON DELETE SET NULL`) existe en **6 tablas**. Update 2026-07:
> ahora **se escribe** desde `createPurchaseInvoiceAction`, `recurring-payments`
> y el mapeo de Document Intelligence — pero **`create_journal_entry` no recibe
> el centro**, así que `journal_entries.cost_center_id` queda **siempre NULL**
> (contradice el comentario de `l_closure.sql:22`), `get_account_balances` **no**
> filtra por centro y **ningún read** lo consume. Resultado: se guarda en el
> origen pero es **imposible reportar por centro end-to-end**. Falta: propagar el
> centro al asiento + filtro de EERR. (La premisa de columnas `is_required`/
> `show_in_sales`/`show_in_purchases` es falsa — no existen.)

---

## 9. Ajuste por inflación — `inflation_adjustments` (L.8, RG 4667)

Feature `inflation`, `/accounting/inflation`. Migración `…517200000_l_closure`.

**`inflation_adjustments`:** `period text UNIQUE` (`YYYY-MM`), `coefficient
numeric(10,6) > 0`, `index_source` (ej. "IPIM INDEC"), `journal_entry_id` (FK al
asiento de reexpresión), `applied_at`/`applied_by`. RLS: SELECT `authenticated`;
manage owner/admin/finance. Actions: `list`/`create`/`delete…Action`.

> ⚠️ **Apply/revert NO implementado.** La tabla está diseñada para sostener un
> "asiento de reexpresión" reversible (`journal_entry_id` + `is_reversal`/
> `reversed_entry_id`), pero **no hay flujo de preview/apply/revert** en ningún lado.
> El feature es **CRUD de coeficientes** nada más: `applied_at`/`applied_by`/
> `journal_entry_id` **nunca se escriben**; la columna "Estado" muestra "Aplicado"
> vs "Sin aplicar" leyendo un `applied_at` que ningún código setea; el delete es
> hard-delete (solo con un warning de UI sobre asiento huérfano).

---

## 10. Convenciones transversales

- **Server actions:** `"use server"` → `requireUserContext()` →
  `userCan(ctx.roles, "<perm>")` → query → `ActionResult<T>`. Reads narrowan enums y
  descartan filas desconocidas. Sin `select *` salvo en reads de tablas chicas.
- **RPCs:** lecturas `SECURITY INVOKER` (heredan RLS del caller); escrituras de
  asientos/aperturas `SECURITY DEFINER` con `set search_path=public` y
  `revoke/grant`.
- **Períodos:** `accrual_period`/`period` siempre `YYYY-MM` con regex CHECK (`22023`
  si no matchea). El devengado (`accrual_period`/`accrual_month`) es independiente
  de la fecha del movimiento.
- **Cliente:** `useSuspenseQuery`/`useSuspenseInfiniteQuery` con prefetch+Hydrate;
  excepción **libro IVA usa `useQuery`** (no suspense) porque Next 16 prohíbe llamar
  server actions en el render inicial con período elegido por el cliente.
- **UI:** `Dialog` centrado, botones a la derecha, monocromo. Páginas `force-dynamic`
  con gate de permiso + RLS de defensa en profundidad.

---

## 11. Gaps conocidos (candidatos a fix)

1. ✅ **Etiqueta de alícuota IVA swapeada (SQL ↔ TS)** (§6) — **corregido**:
   `IVA_RATES` ahora `8→5/9→2.5` (= AFIP/RPCs), con test.
2. ✅ **Asimetría action vs RLS en DELETE** (§1) — **corregido**:
   `deleteChartAccountAction` exige owner/admin, `deleteTransactionAction` exige owner.
3. **Centros de costo escritos pero no reportables** (§8): ahora se **escriben**
   (purchase-invoices, recurring-payments, Document Intelligence) pero
   `create_journal_entry` no propaga el centro al asiento (`journal_entries.
   cost_center_id` siempre NULL) y EERR no filtra por centro. Falta el
   wire-through hasta el asiento + filtro.
4. **Inflación apply/revert no implementado** (§9): solo CRUD de coeficientes;
   `journal_entry_id`/`applied_at` nunca se escriben; "Estado" siempre "Sin aplicar".
5. **`auto_journal_mapping` sin uso** (§3.1): tabla + RLS existen, ningún generador
   la lee (scaffolding a futuro para IIBB por jurisdicción).
6. **`caja_apertura` system_role sin asignar** (§2): 18 de 19 roles seedeados.
   Verificado: el valor del enum no lo consume **ningún** RPC ni cuenta (el RPC de
   apertura materializa el ajuste como transacción normal) — es scaffolding sin
   uso, no un bug. Asignarlo a una cuenta arbitraria no tendría efecto funcional.
7. ✅ **Comparativo de balances** (§7) — **corregido**: la UI ahora expone "Desde
   (opcional)" y pasa `period_start` al RPC ya cableado.
8. **Export PDF de libro IVA bypassa RLS** (§6): usa service client; solo protege el
   `accounting:read` de la ruta. `purchase_invoices` además tiene SELECT RLS
   `USING(true)`.
9. **Export contable parcial**: existe un exportador PDF genérico
   (`app/api/export/[resource]`) para caja/transactions, cost-centers,
   purchase-invoices, receipts, checks, exchange-rates, etc. **Todavía falta**:
   export de libro diario/mayor/balances, y libro IVA en SIAP/CSV (solo PDF).
   Pendiente L.6 (CITI/SIAP) en el roadmap.
