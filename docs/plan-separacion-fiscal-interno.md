# Plan de remediación — separación fiscal / interno (solo Logística Jouve)

Este plan cierra las fugas que quedan en [`separacion-fiscal-interno.md`](separacion-fiscal-interno.md).

- **Enfoque:** opción A del doc. Una sola app y una sola DB, con invariantes en la DB y un único
  filtro `isFiscal`.
- **DZ Instalaciones:** la app deja de operarla y queda solo Logística Jouve, por pedido del dueño
  (2026-10-31).
- **Además:** bugs sueltos y 45 warnings de lint.
- **Entrega:** 14 PRs en draft. Orden: 0 → A → B → 0b (con B promovido) → C → C2 → D → E → F → G → H → I → J → K.

**Interpretación del pedido** ("corregir todo" + "sacar DZ, acá solo Jouve", 2026-10-31):

- **Incluye:**
  - las fugas C3–C8, A1–A4, M1, M2, M4, M5 y las bajas;
  - los bugs de storage y de etiquetas NC/ND, y el lint;
  - dos bugs nuevos encontrados al falsificar este plan:
    - hoy **no se puede crear un recibo fiscal con retenciones** (el asiento sale desbalanceado y la
      DB lo rechaza al confirmar);
    - el PDF de facturas nunca dio el mismo hash;
  - el re-asiento de recibos y OPs editados.
- **Ya mergeado:** C1–C2 (#247, migración `20261031115523`) y los flakes de e2e (#248).
- **Diferido:**
  - A5 (rol `fiscal_reader`);
  - M3 (canal de saldos iniciales);
  - la reparación del histórico contaminado. Hasta entonces el objetivo 1 rige **hacia adelante**,
    con diagnósticos.
- **Decisiones del dueño (D1–D11):** cada una trae una opción recomendada. Un PR que depende de una
  decisión no se mergea sin que el dueño la confirme.

## Current State

### What already exists

- **Canales.** `invoicing_channels(id, division, is_fiscal, is_active)` tiene 4 canales: `dz_fiscal`,
  `dz_internal`, `jouve_fiscal` y `jouve_internal` (`20260508204342_business_units_channels.sql:84-89`).
  - `channel_id` NOT NULL (FK restrict): `invoices`, `purchase_invoices`, `receipts`,
    `payment_orders`, `transactions`, `loans`, `payroll_payments`.
  - `channel_id` nullable (FK set null): `journal_entries`, `sales_points`, `shipments`, `trips`,
    `recurring_payments`.
  - `default_channel_id`: `suppliers`.
  - Sin canal: `accounts`, `checks`, `issued_checks`, `clients` y los saldos iniciales.
- **Emisores de asientos.**
  - `emit_journal_for_invoice` y `emit_journal_for_purchase_invoice` leen `is_fiscal` inline.
    Construyen las líneas con `build_*_journal_lines`.
  - `emit_journal_for_receipt`, `emit_journal_for_payment_order` y
    `generate_journal_for_transaction` usan `is_channel_fiscal()` y construyen las líneas inline.
  - Atrapan `P0002` con un `warning`. Las cuentas sin mapear se saltean (`continue` o `warning`).
  - `emit_journal_for_receipt` debita solo las líneas de pago y acredita `clientes` por
    `total_amount`, que incluye las retenciones (`features/receipts/schema.ts:152-161`).
    `create_journal_entry` termina con `set constraints jel_enforce_balance immediate`, y el 23514
    no se atrapa: **crear un recibo fiscal con retenciones falla hoy** al hacer commit. No existen
    asientos desbalanceados.
  - Roles del plan de cuentas:
    - retención sufrida (activo): `retenciones_pagadas` (1.1.3.3);
    - percepción IIBB sufrida: `percepciones_iibb_pagadas` (1.1.3.2);
    - `retenciones_cobradas` (2.1.2.5) es un **pasivo**: son las retenciones que Jouve practica a
      terceros.
  - Los emisores de cheques no miran el canal.
  - ACL de los `emit_*`: `{postgres, service_role}`.
- **Reversos.** Los 4 triggers `*_after_update_journal` buscan el asiento con `order by created_at
asc limit 1` y lo **reconstruyen** con `emit_*(…, true, v_original)`. Usan la fecha del documento,
  así que hoy anular un documento de un período cerrado ya da `55006`.
- **Centro de costo.** `set_journal_cost_center` completa `cost_center_id` desde la fila **actual**
  del documento cuando viene NULL.
- **Re-asiento.**
  - `replace_purchase_invoice_items` (DEFINER) borra el asiento y lo re-emite. La edición de compras
    son dos llamadas: cabecera y después ítems.
  - `lib/email/send-comprobante.tsx:146-150` hace UPDATE de `receipts.notified_at` después de cada
    email.
  - `update_receipt` / `update_payment_order` son **INVOKER** y no re-asientan.
  - `generate_journal_for_transaction` solo corre en INSERT.
  - El único DELETE de `authenticated` sobre `journal_entries` es la policy `ALL` de owner/admin.
- **Pendiente de compras.** Hoy se calcula de tres formas distintas:
  - `v_supplier_aging_documents`: total − OPs − NC − saldo inicial;
  - `guard_payment_order_allocation` de #247: solo OPs, con tolerancia 0.01;
  - el guard nuevo de este plan.
- **Filtros.**
  - `search_purchase_invoices` tiene `p_is_fiscal` y `p_channel_id`.
  - Los pickers "mismo canal" (pendientes de recibo y de OP, origen de NC) dependen del canal; lo
    exige #247.
  - Las vistas `*_account_movements` y `*_aging_documents` exponen `channel_is_fiscal`. El saldo
    inicial tiene canal NULL.
  - `v_*_aging` agrupan solo por contraparte.
  - `useOriginSearch` (`use-invoices.ts:150-163`) trae 25 filas y filtra en el cliente.
  - `features/treasury/actions/cash-flow-actions.ts:42-48` tiene su propio clasificador
    `readFiscal`, y clasifica los cheques como "otro".
- **Alcance.**
  - `lib/scope.ts`: `Scope = {division, fiscalFilter}`, `channelsForScope` (solo la usa su test) y
    `DEFAULT_CHANNEL_ID`.
  - El parseo está duplicado (`layout.tsx:65-83`, `scope-provider.tsx:32-48`; cookie `jouve_scope`,
    localStorage `jouve_scope_v1`).
- **PDF.**
  - Solo las facturas guardan `pdf_hash`.
  - `invoice-template.tsx:273,281` no fija `creationDate`, y `@react-pdf` usa `new Date()`. Cada
    render da bytes distintos: el hash **nunca** fue reproducible.
- **Errores.** `55006` es `object_in_use`. Lo emiten `guard_journal_period_closed` y
  `guard_transaction_immutable_when_linked` (que es INVOKER y no tiene `search_path`).
- **CI.**
  - `.github/scripts/check-migration-definer-revoke.mjs` exige, para toda DEFINER, `revoke … from
public, anon, authenticated`.
  - `lib/db/rpc-role-guards.test.ts` exige ese revoke y el guard de rol en `update_receipt`,
    `update_payment_order`, `deposit_check`, `reject_check` y `replace_purchase_invoice_items`.
  - Default ACL de funciones nuevas: `{anon, authenticated, service_role}`.
- **Deploy.**
  - `promote-to-production.yml` aplica las migraciones y **después** Vercel (`:224`).
  - El rollback no aplica nada (`:184-187`) y acepta cualquier SHA.
  - Por eso todo cambio de schema es expand-only frente a lo que llama TS o `authenticated`.

### What does NOT exist yet

- Retiro de DZ: diagnóstico, guard de canal inactivo y desactivación.
- Canal en cheques.
- Asientos manuales fiscal-only, sin posibilidad de forjarlos.
- Un único reverso por clon y un único re-asiento por diferencia.
- Inmutabilidad de canal y de POS.
- Filtro `isFiscal` en lecturas y salidas.
- PDF y email internos inconfundibles, con PDF determinístico.
- Mapeo de errores de guards.
- Invariantes de regresión.

## Architecture & Ports Contract

**Filtro `isFiscal: boolean | null`.** `null` significa todos. Sale de la variante que declara el
puerto, `is_fiscal`, o `channel_is_fiscal` en las vistas. Es la excepción sancionada, y muere si el
canal deja de distinguir fiscal de interno.

- **Visibilidad ≠ elegibilidad.**
  - Las lecturas filtran por `is_fiscal` y nunca por `is_active`. El histórico fiscal de DZ sigue
    en "Solo fiscal".
  - `is_active` solo aplica a pickers, defaults y al guard de escritura.
- **Canal NULL** (cheques históricos, asientos "fiscal general", saldo inicial): solo se ve con
  "Todos", rotulado "sin canal".
- **Excepción documentada:** el filtro por canal **exacto** queda donde #247 lo exige (pendientes
  de recibo y OP, origen de NC). Responde "mismo canal", no "qué alcance".
- **Tesorería y saldos de cuentas** quedan consolidados por diseño: es la caja real. Se rotulan
  "Caja real (todos los canales)". El flujo de caja sí clasifica por `isFiscal`.

| Pieza                                                                                                                                                                                                        | Capa                                                       | Contrato                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FISCAL_FILTERS`, `FiscalFilter`, `isFiscalFilter`, `SCOPE_COOKIE`, `SCOPE_LABEL`, `parseFiscalFilter(raw)`, `channelIsFiscal(id, allChannels): boolean \| null`, `InvoicingChannelSummary` (sin `Division`) | `lib/scope.ts` (puro, apto para cliente, **sin `next/*`**) | Único módulo de canal y alcance. El alcance es un `FiscalFilter`, no se envuelve. `isFiscalFor(filter)` y `defaultChannelFor(filter, channels)` llegan con su primer uso (PR G)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `userCanAll(access, perms)`                                                                                                                                                                                  | `lib/auth/permissions.ts` (+ test)                         | Gate compuesto. Único helper para acciones, páginas, nav, export e IA. `NavItem.permission` y el `permission` de export aceptan un array                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `serializeFiscalFilter(f)` / `parseFiscalFilter(raw)`                                                                                                                                                        | `lib/scope.ts`                                             | Único writer y reader de la cookie y del localStorage. Se escribe `{"fiscalFilter": f}` (objeto JSON, así el código viejo sigue leyendo tras un rollback). Se leen el objeto viejo `{division, fiscalFilter}`, un string pelado y basura (→ `"all"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `applyFiscalFilter(query, isFiscal, embed)`                                                                                                                                                                  | `lib/supabase/fiscal-filter.ts`                            | Opera sobre el embed que ya usa el select (`channel:invoicing_channels(name,is_fiscal)`): `.eq(\`${embed}.is_fiscal\`, v)`+`.not(embed, "is", null)`cuando`isFiscal !== null`. Select constante, una sola función. Las vistas usan `channel_is_fiscal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mapDbGuardError(error, { slug, userId, id })`                                                                                                                                                               | `lib/db/guard-errors.ts` (PR A)                            | Solo con `error.hint === 'jouve_guard'`: devuelve el mensaje del guard y hace `logger.warn(slug, …)`, con `slug` literal (p. ej. `"receipts.update.rejected"`). Cualquier otro error devuelve `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `loadEmisor(supabase, channel)`, `redactEmisor({isFiscal, emisor})`, `divisionLabel(division)`                                                                                                               | `lib/pdf/emisor.ts`                                        | Una sola carga de `business_units` para los 3 renderers; el mismo texto de división que hoy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `build_*_journal_lines` (todos los orígenes)                                                                                                                                                                 | DB                                                         | EXTRACT para recibo, OP y movimiento, como ya existe para comprobante y compra. Los `emit_*` = build + insert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `current_journal_entry(src, id)`, `reverse_journal_entry(id)`                                                                                                                                                | DB, DEFINER internas                                       | **Reverso único:** clona las líneas negadas, el centro de costo (aunque sea NULL), el período, la fecha y el canal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `repost_journal(src, id)`                                                                                                                                                                                    | DB, DEFINER interna                                        | **Re-asiento único.** Se dispara solo con `AFTER UPDATE OF <columnas que lee el asiento>`; un UPDATE de `notified_at` o de notas no lo dispara.<br><br>Al disparar:<br>1. Vuelve a leer el estado y sigue solo si el documento está vigente.<br>2. Construye las líneas con `build_*`.<br>3. Compara contra el asiento vigente: el multiconjunto `(chart_of_accounts_id, cost_center_id, debit, credit)` más `entry_date`, `accrual_period` y `channel_id`. **Las descripciones no cuentan.**<br><br>Resultado de la comparación:<br>- Igual: no hace nada.<br>- Distinto: borra los asientos vigentes (`GET DIAGNOSTICS` = vigentes) y emite. Si el período está cerrado, `55006`.<br>- Sin asiento vigente: no hace nada; lo lista `journal_missing_entries()`, el diagnóstico de 4.1.<br>- Si no puede construir las líneas: `raise … hint 'jouve_guard'` con la causa |

**Grants (convención única, la que exigen los checks de CI):**

| Tipo de función                                                                                             | Grants                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| DEFINER internas (`emit_*`, `build_*`, `current/reverse/repost_journal`, guards, triggers, `dz_open_items`) | `revoke all … from public, anon, authenticated`, sin grant (o solo `service_role`) |
| DEFINER llamadas desde la UI (`create_manual_journal_entry`)                                                | revoke ×3 + `grant execute … to authenticated` + chequeo de rol interno            |
| INVOKER RPCs (aging, `ai_*`, búsqueda)                                                                      | `revoke all … from public, anon` + `grant … to authenticated, service_role`        |

pgTAP verifica `has_function_privilege('authenticated', …)` en cada caso.

**Prohibido en todo consumidor:** comparar `channel_id` o `division` con un literal; clasificar un
canal solo contra los activos; re-escribir el enum o las etiquetas de alcance.

**Duplicación:**

- REUSE de `formatInvoiceNumero` / `formatInvoiceNumber`.
- EXTRACT de `build_*_lines`, `reverse_journal_entry` y `repost_journal`.
- Pendiente de compras: una vista base set-based `v_purchase_invoice_open` (sin filtros de estado ni
  de `> 0`). La usan `v_supplier_aging_documents` y el chequeo diferido post-edición. El guard de
  #247 conserva su fórmula y su `FOR UPDATE`.
- **Regla de hints:** toda `raise` de un guard que este plan agrega o toca lleva `using hint =
'jouve_guard'`.
- `readFiscal` de tesorería → `channelIsFiscal`.

**One-way doors:**

1. **Retiro de DZ.**
   - El PR 0 instala el guard y el diagnóstico.
   - El PR 0b retira DZ. Se mergea cuando `dz_open_items()` da 0 en producción, lo vuelve a
     correr el dueño justo antes de aprobar `production-gate`, y el PR B ya está promovido.
   - Camino **borrar** (D10, sin documentos DZ): `delete` de los canales DZ. No se revierte con un
     update: hay que volver a insertarlos. Se aceptó porque no hay datos que perder.
   - Camino **ocultar** (D10, con documentos DZ): `is_active=false`. Se revierte con `is_active=true`.
2. **Canal en cheques + backfill.** Desde documentos solamente.
3. **Revoke de `create_journal_entry` a `authenticated` (C2).** Se mergea después de que C esté
   promovido. El checklist de C2 y `CONTRIBUTING.md` dicen: "para hacer rollback a un SHA anterior a
   C, primero `grant execute on create_journal_entry to authenticated`".
   - Se descartó un piso de rollback automatizado: protege una sola función (sin fuga ni
     corrupción), y el Instant Rollback de Vercel lo saltea.
4. **Firmas.** Expand-only para funciones que llama TS o `authenticated`.
   - Las internas (`emit_*`, `build_*`) pueden perder parámetros. En la misma migración, **antes**
     del `DROP FUNCTION` explícito de la firma vieja:
     - se reemplazan los **9 call sites en 8 funciones**: `invoices_after_insert_journal`,
       `invoices_after_update_journal` (2), `receipts_after_insert_journal`,
       `payment_orders_after_insert_journal`, `purchase_invoices_after_insert_journal`,
       `replace_purchase_invoice_items` y las anulaciones;
     - revoke ×3 de las firmas nuevas.

     Un Vitest sobre `latestDefinition` verifica que nadie llame a una aridad borrada.

   - Si cambia la firma de una RPC con defaults: drop + create de una sola versión (precedente
     `20260516190000:7`).

**Decisiones del dueño:**

- **D10 (PR 0/0b) — retirar DZ.** Objetivo del dueño: que DZ no exista más, ni en la app ni en la
  base. El camino lo decide un conteo que el dueño corre en producción (SQL editor, solo lectura):

  ```sql
  select t, n from (
    select 'invoices' t, count(*) n from public.invoices where channel_id like 'dz\_%'
    union all select 'purchase_invoices', count(*) from public.purchase_invoices where channel_id like 'dz\_%'
    union all select 'receipts', count(*) from public.receipts where channel_id like 'dz\_%'
    union all select 'payment_orders', count(*) from public.payment_orders where channel_id like 'dz\_%'
    union all select 'transactions', count(*) from public.transactions where channel_id like 'dz\_%'
    union all select 'journal_entries', count(*) from public.journal_entries where channel_id like 'dz\_%'
    union all select 'loans', count(*) from public.loans where channel_id like 'dz\_%'
    union all select 'payroll_payments', count(*) from public.payroll_payments where channel_id like 'dz\_%'
    union all select 'recurring_payments', count(*) from public.recurring_payments where channel_id like 'dz\_%'
    union all select 'shipments', count(*) from public.shipments where channel_id like 'dz\_%'
    union all select 'trips', count(*) from public.trips where channel_id like 'dz\_%'
    union all select 'suppliers', count(*) from public.suppliers where default_channel_id like 'dz\_%'
    union all select 'sales_points', count(*) from public.sales_points where channel_id like 'dz\_%'
  ) x order by t;
  ```

  - **Todo en 0 salvo `suppliers`, `sales_points`, `recurring_payments`, `shipments` sin factura →
    camino borrar (recomendado si aplica).** 0b pone esas referencias en NULL, borra los canales
    `dz_fiscal` y `dz_internal`, y la división `dz` desaparece del CHECK, del código, del seed y de
    los docs. No queda rastro de DZ.
  - **Hay comprobantes fiscales DZ con CAE → camino ocultar.** No se pueden borrar: AFIP ya los
    tiene, forman parte del Libro IVA del CUIT ya presentado y hay que conservarlos 10 años. Los
    canales quedan con `is_active=false` y la app los oculta del todo (selector, pickers,
    filtros, etiquetas). Solo aparecen como renglones del Libro IVA y de los reportes fiscales de
    sus períodos.
  - **Solo hay documentos internos DZ (o de prueba)** → el dueño elige: ocultar, o borrarlos en la
    limpieza aceptando que cambian los saldos de las cuentas y cajas que tocaron (0b lista el
    impacto antes de borrar).
  - En los dos caminos: saldar antes todo lo que liste `dz_open_items()` y después correr 0b. La
    función la ejecuta el dueño desde el SQL editor de Supabase: `select * from public.dz_open_items();`.
  - Después del retiro por el camino ocultar, DZ queda congelado:
    - corregir **compras** de DZ y anular recibos u OPs de DZ sigue funcionando, porque el diario no
      tiene guard de canal;
    - crear o mover registros a DZ falla;
    - una NC o ND de una factura fiscal de DZ necesita un **runbook**: el dueño reactiva el canal y
      el POS, emite y vuelve a desactivar.
  - La función no lleva chequeo de JWT: corre como `postgres` desde el SQL editor.
  - El POS 00004 queda habilitado hasta la baja en ARCA si es CAEA.

- **D1 (PR C):** asiento manual con canal NULL o con un canal fiscal **activo**.
- **D2 (PR D):** en compras con canal fiscal, la letra es obligatoria. El CAE solo se avisa.
- **D3 (PR D):** editar una compra recibida re-asienta. Alternativa: bloquear la edición de importes.
- **D4 (PR E):** el saldo inicial de una cuenta exige canal, sin default.
- **D5 (PR H):** PDF y email internos sin datos fiscales del emisor, con título interno.
- **D6 (PR H).**
  - Con "Todos", la cuenta corriente queda como hoy.
  - Con un alcance fiscal o interno, muestra los movimientos de ese alcance y un único saldo, que es
    el del aging de ese alcance (por documentos, con las imputaciones del saldo inicial). No hay
    columna de saldo corrido. El saldo inicial sin canal aparece como fila informativa.
- **D7 (PR G):** un solo control de alcance, el selector global. El diario conserva su filtro de
  canal fiscal.
- **D8 (PR G):** default de canal = el único canal activo del alcance; si hay más de uno, vacío.
- **D9 (PR B):** cheques manuales históricos quedan NULL y se fijan al depositar o endosar.
- **D12 (PR A):** retenciones de IVA, ganancias, SUSS y "otros" que sufre Jouve. No tienen hoy un
  rol de activo propio.
  - Recomendado: usar `retenciones_pagadas` para todas las retenciones. Las percepciones van a
    `percepciones_iibb_pagadas` si son de IIBB; si no, a `retenciones_pagadas`.
  - Alternativa: crear roles por impuesto.
- **D11 (PR B):** cuenta del cheque rechazado. **Decidido (2026-10-31):** no es gasto; Debe
  "Deudores por cheques rechazados" (`cheques_rechazados`) contra la cuenta donde estaba el
  cheque (banco del depósito, cartera o proveedor si estaba endosado). Ver
  `docs/accounting-patterns.md` §3.5.

## Validation Commands

- **Test:** `pnpm test` · **Lint:** `pnpm lint` · **Build:** `pnpm build` · **Quick check:** `pnpm typecheck`
- **DB:** `pnpm check:migrations`; `pnpm db:types:generate` + `git diff --exit-code lib/db/database.types.ts`.
- **pgTAP:** `supabase test db --local`. En local corre en una transacción con rollback.
  - Todo guard o trigger se prueba con `set local role authenticated` + claims de finance, más una
    corrida sin la migración.
  - Grants con `has_function_privilege`.
- **IA:** `pnpm eval:ai` (PRs 0b e I).
- **E2E:** `pnpm test:e2e`.

Cada PR se rebasea sobre `origin/main`, y cada migración lleva un timestamp mayor al máximo de
`main` (hoy `20261031115523`). El PR 0b se re-estampa al mergearlo. Los números de línea son de
`cae75a1`.

## Phase 0: Solo Logística Jouve (PR 0, PR 0b)

Objetivo: operar solo `jouve_*`. DZ desaparece de la base (camino borrar) o queda solo como
histórico fiscal oculto (camino ocultar). Depende de D10.

### 0.1 Diagnóstico y guard de canal activo (PR 0)

- **Files:** `supabase/migrations/<ts>_channel_active_guard.sql`, `supabase/tests/channel_active_test.sql`.
- **Problem:** ninguna función de la DB mira `is_active`. Solo lo hace `invoices-actions.ts:175`.
- **Target:**
  - **`dz_open_items()`** (DEFINER interna, solo `service_role`) devuelve una fila por pendiente.
    El monto va por moneda, con un resolvedor único `PES`/`ARS` → ARS y `DOL`/`USD` → USD.
    - comprobantes y compras DZ con `open_amount > 0.01` (vistas `*_aging_documents`);
    - recibos y OPs DZ con monto sin imputar > 0.01;
    - NC DZ sin origen con saldo;
    - cheques de recibos DZ en `en_cartera`, `depositado` o `endosado`;
    - `issued_checks` `emitted` de OPs DZ;
    - cuotas de préstamos DZ pendientes;
    - `recurring_payments` DZ activos;
    - comprobantes DZ en `draft`, `emitting` o `failed`.
  - **`guard_channel_active(col text)`**: DEFINER interna, con `hint 'jouve_guard'`. Lee el canal
    con `to_jsonb(new)->>tg_argv[0]` y **devuelve `new` si el canal es NULL**. El `WHEN` de cada
    trigger usa el nombre de la columna literal, porque `TG_ARGV` solo se puede leer dentro de la
    función. Va como **dos triggers por tabla**:
    - `BEFORE INSERT … WHEN (new.<col> is not null)`;
    - `BEFORE UPDATE OF <col> … WHEN (new.<col> is distinct from old.<col>)`.
  - Tablas: `invoices`, `purchase_invoices`, `receipts`, `payment_orders`, `transactions`, `loans`,
    `payroll_payments`, `recurring_payments`, `shipments`, `trips` y `suppliers(default_channel_id)`.
  - **No** van en esta lista: `journal_entries`, que deriva su canal de un documento ya protegido (y
    los asientos manuales se validan en 3.1), ni `checks` / `issued_checks`, que se suman en 2.1.
  - No desactiva nada todavía.
- **Validation:** pgTAP como `authenticated`, con un canal de prueba inactivo:
  - insert → `23514`;
  - update que mueve a ese canal → `23514`;
  - update de otra columna → ok;
  - un asiento derivado de un documento de ese canal → ok.
  - `has_function_privilege('authenticated','dz_open_items()')` → false.

### 0.2 Alcance sin división, parseo único (PR 0)

- **Files:** `lib/scope.ts`, `lib/scope.test.ts`, `components/scope-selector.tsx:24-41,123`,
  `components/providers/scope-provider.tsx:27-83`, `app/(dashboard)/layout.tsx:42-83`.
- **Target:**
  - Las piezas de `lib/scope.ts` listadas en la tabla de Arquitectura.
  - Se borran `Division`, `isDivision`, `Scope` y `channelsForScope`.
  - El layout y el provider usan `parseFiscalFilter`, `serializeFiscalFilter` y `SCOPE_COOKIE`.
    `jouve_scope_v1` y `readFromStorage` pasan a usar el mismo par.
  - El selector es un único `Select` que renderiza `SCOPE_LABEL`.
- **Validation:** Vitest:
  - `serializeFiscalFilter` → `parseFiscalFilter` da el mismo valor (ida y vuelta).
  - `parseFiscalFilter` con el objeto viejo `{division, fiscalFilter}` → toma `fiscalFilter`; con un
    string pelado → ese valor; con basura → `"all"`.
  - `channelIsFiscal`: canal fiscal inactivo → `true`; id desconocido → `null`.

### 0.3 Forms y PDFs sin ramas por división (PR 0)

- **Files:**
  - `features/purchase-invoices/components/purchase-invoice-form.tsx:187-188,349-361,385,505`
  - `app/(dashboard)/checks/page.tsx:28`
  - `lib/pdf/emisor.ts`, `lib/pdf/generate-and-store.ts:162-171`,
    `lib/pdf/receipt-render.tsx:168-173`, `lib/pdf/payment-order-render.tsx:59-75,143-148`
  - `features/afip-admin/components/configure-pos-dialog.tsx:148`,
    `features/cost-centers/components/cost-center-dialog.tsx:170`
- **Target:**
  - Form de compras:
    - `channelIsFiscal` contra todos los canales; si da `null`, no deja guardar;
    - en edición, las opciones son los canales activos más el propio;
    - ignora el default del proveedor si ese canal está inactivo.
  - Los PDFs usan `loadEmisor` y `divisionLabel`, con el mismo texto de división que hoy.
  - Se cambian los placeholders que mencionan DZ.
- **Validation:**
  - Test: editar una compra `dz_fiscal` conserva la letra.
  - Snapshot de las props del template de los 3 PDFs, con el mismo texto antes y después.
  - `git grep -n -E 'division ===' -- features lib app components ':!features/invoices/components/new-invoice-dialog.tsx' ':!features/ai/document/actions.ts'`
    → 0. Esos dos archivos cambian en 0.4.
- **Scope:** el Concepto, el prompt y los docs van en 0.4, mientras DZ siga operando.

### 0.4 Retirar DZ (PR 0b — requiere B promovido y `dz_open_items()` = 0)

- **Files:**
  - `supabase/migrations/<ts>_retire_dz_division.sql`, `supabase/seed.sql:16-25`,
    `scripts/seed-everything.mjs`
  - `features/invoices/components/new-invoice-dialog.tsx:67-75,375,503`,
    `features/ai/document/actions.ts:1144-1148`
  - `features/ai/agent.ts:40`, `features/ai/skills/registry.ts:91-104`
  - `CLAUDE.md`, `docs/{accounting-patterns,ai-patterns:710-711,separacion-fiscal-interno}.md`
- **Target:**
  - Migración, **camino borrar** (D10):
    - aborta con `raise` si alguna tabla del conteo de D10 tiene una fila DZ fuera de las que
      esta misma migración limpia (la guarda vive en la migración porque el conteo ya dio 0 en
      producción antes del merge; no bloquea deploys);
    - NULL en `suppliers.default_channel_id`, `recurring_payments`, `shipments` y
      `sales_points.channel_id` de DZ;
    - `delete from invoicing_channels where division='dz'`;
    - CHECK de `division` → `('jouve')`. La columna queda (expand-only: el código viejo de un
      rollback la sigue leyendo); se borra en un PR posterior;
    - `drop function dz_open_items()`.
    - Código: se borran las ramas y etiquetas `dz` (`division` deja de ser selector), el tipo
      `Division` pasa a `'jouve'`.
  - Migración, **camino ocultar** (D10):
    - `update invoicing_channels set is_active=false where division='dz'`;
    - deshabilita el POS 2, y el POS 4 solo si `last_known_emission_type <> 'caea'`;
    - pone en NULL **solo lo pendiente**: `suppliers.default_channel_id`, los `recurring_payments`
      activos y los `shipments` sin factura. `trips` y los envíos facturados conservan su canal
      histórico;
    - `drop function dz_open_items()`.
  - Seed sin DZ.
  - El concepto queda fijo en `CONCEPTO.SERVICIOS` en los dos lugares.
  - Prompt: "Logística Jouve (DZ & Sons S.A., un CUIT); canales fiscal e interno".
  - Docs: "DZ retirada el 2026-10-31".
  - Checklist del PR: salida de `dz_open_items()` vacía, vuelta a correr antes de `production-gate`.
- **Validation:** `supabase db reset`, `pnpm eval:ai`, `git grep -n '"dz"' -- features lib app components` → 0.
  Camino borrar: `select count(*) from invoicing_channels where division='dz'` → 0 y el pgTAP de la
  migración falla si queda una fila DZ. Camino ocultar, a mano: los pickers solo ofrecen Jouve, y
  "Solo fiscal" sigue mostrando las facturas fiscales de DZ.

## Phase 1: Bugs sueltos y base (PR A)

### 1.1 Canal de storage como slug

- **Files:** `features/storage-billing/schema.ts:13`, `features/storage-billing/schema.test.ts`.
- **Current:** `channel_id: z.string().uuid("Canal requerido."),`
- **Target:** `channel_id: z.string().min(1, "Canal requerido."),`
- **Validation:** un test con `jouve_fiscal` → ok, y falla contra el código actual.

### 1.2 Etiquetas y números de comprobante (REUSE)

- **Files:** `lib/pdf/receipt-render.tsx:139-147`, `app/(dashboard)/receipts/[id]/page.tsx:207-214`,
  `features/receipts/components/allocations-picker.tsx`, `features/clients/actions/account-actions.ts:209`,
  `features/clients/components/client-account-tab.tsx:65-84,217,251`,
  `app/api/export/resources/client-account.ts:19-35`, `lib/pdf/payment-order-render.tsx:108-123`,
  `features/payment-orders/components/allocations-picker.tsx`,
  `features/suppliers/components/supplier-account-tab.tsx:61`,
  `app/api/export/resources/supplier-account.ts:28`.
- **Problem:**
  - Los cinco primeros comparan con `credit_note`/`debit_note`. `payment-order-render` y el export
    de cuenta corriente ya usan `nc`/`nd`.
  - El outstanding de una NC sale como su bruto.
  - Todos arman el número con 4 dígitos.
- **Target:**
  - Usar `formatInvoiceNumero` (ventas) y `formatInvoiceNumber` (compras).
  - Comparar contra `"nc"`/`"nd"`.
  - En la OP se conserva la etiqueta "Gasto interno".
- **Validation:**
  - Recibo con una ND imputada → "ND00003-…".
  - Una NC no queda "Pendiente" en la cuenta corriente.

### 1.3 Mapeo de errores de guards

- **Files:**
  - `lib/db/pg-error-codes.ts` (+ `PG_OBJECT_IN_USE = "55006"`)
  - `lib/db/guard-errors.ts`, `lib/db/guard-errors.test.ts`
  - `supabase/migrations/<ts>_guard_hints.sql`
  - `lib/commands/create-manual-journal-entry.ts:39-47`
  - Writers de recibos, OPs, compras, comprobantes (alta, NC/ND, anulación), movimientos, cheques y
    afip-admin.
- **Target:**
  - Agregar `hint 'jouve_guard'` a los guards existentes con `create or replace` de la misma firma.
    Se conservan sus atributos:
    - los 4 guards de #247: DEFINER, `search_path=''`, revoke ×3;
    - `guard_journal_period_closed`: se le agrega revoke ×3;
    - `guard_transaction_immutable_when_linked`: sigue siendo INVOKER; se le agregan
      `search_path` y revoke a `public` y `anon`.
  - Adoptar `mapDbGuardError` en todos esos writers.
  - En la anulación de comprobantes (`invoices-actions.ts:1028-1045`), reemplazar el match por
    texto `includes("saldo inicial")` por el hint.
- **Orden:** el PR D (que reescribe `guard_payment_order_allocation`) y el PR E (que reescribe
  `guard_transaction_immutable_when_linked`) parten de las versiones del PR A. Un test sobre
  `latestDefinition` exige que ambas versiones tengan el hint.
- **Validation:** Vitest:
  - con hint → devuelve el mensaje del guard y emite un warn;
  - un CHECK nativo → `null`.

### 1.4 PDF de factura determinístico

- **Files:** `lib/pdf/invoice-template.tsx:271-283`, `lib/pdf/generate-and-store.ts` (`buildTemplateData`),
  `lib/pdf/generate-and-hash.ts:1-11,40-43`.
- **Target:**
  - `InvoiceTemplateData` incorpora `emittedAt`, cargado en `buildTemplateData` (si falta, se usa
    `fecha`).
  - `<Document creationDate={emittedAt} producer="JouveERP">`. Con el `CreationDate` fijo, también
    queda fijo el `/ID` de pdfkit.
  - El comentario de `generate-and-hash.ts` aclara que los hashes anteriores a este cambio no son
    reproducibles.
- **Validation:** renderizar dos veces la misma factura da el mismo hash.
- **Scope:**
  - Recibo y OP quedan afuera: no tienen hash.
  - No se recalculan hashes históricos.

### 1.5 Recibos fiscales con retenciones (bug en producción)

- **Files:** `supabase/migrations/<ts>_receipt_retentions_journal.sql`,
  `supabase/tests/receipt_retentions_test.sql`.
- **Problem:** `emit_journal_for_receipt` acredita `clientes` por el total (pagos + retenciones) y
  solo debita los pagos. `jel_enforce_balance` rechaza el asiento al hacer commit, así que **hoy no
  se puede crear un recibo fiscal con retenciones**.
- **Target:** `create or replace` de `emit_journal_for_receipt`, con la misma firma y la misma ACL.
  Por cada `receipt_retentions` agrega un **débito** según D12:
  - `kind='retencion'` → `retenciones_pagadas`;
  - percepción de IIBB → `percepciones_iibb_pagadas`;
  - el resto → `retenciones_pagadas`, salvo que D12 decida otra cosa.
- **Validation:** pgTAP como finance:
  - crear un recibo fiscal con una retención → ok, el asiento cuadra y la retención va al débito de
    una cuenta de activo;
  - el mismo test falla sin la migración.

## Phase 2: Cheques con canal (PR B — C3)

Depende de D9 y D11. El 2.4 se despliega junto con la migración.

### 2.1 Columna, herencia, backfill y guard

- **Files:** `supabase/migrations/<ts>_checks_channel.sql`, `supabase/tests/checks_channel_test.sql`.
- **Target, en este orden:**
  1. Columna `channel_id` + índice en `checks` e `issued_checks`.
  2. Backfill **solo desde documentos**:
     - el canal del recibo;
     - si no hay recibo, el de la OP no anulada que endosó el cheque;
     - en `issued_checks`, el de la OP.
     - El resto queda NULL.
  3. Triggers DEFINER: el insert hereda el canal del documento y rechaza uno distinto; el update de
     un `channel_id` que ya tenía valor se rechaza.
  4. Se agregan las dos tablas a `guard_channel_active`.
  5. Diagnóstico de los asientos espurios de C3 (cheques cuyo canal de depósito no coincide con el
     del recibo).
- **Validation:** pgTAP como `authenticated`:
  - un cheque de un recibo interno queda interno;
  - el cambio de canal falla;
  - el backfill no toma el canal del depósito.

### 2.2 Depósito y rechazo

- **Target:** `create or replace` de `deposit_check` y `reject_check`, misma firma.
  - Si el cheque tiene canal, se usa ese. Un `p_channel_id` distinto y no nulo → `23514`.
  - Si el cheque está en NULL, `p_channel_id` es obligatorio y se graba en el cheque.
  - Se mantiene paridad con `20260706090100` y con `lib/db/rpc-role-guards.test.ts`.
- **Validation:** pgTAP:
  - cheque interno + `jouve_fiscal` → `23514`;
  - `p_channel_id` NULL con canal ya asignado → ok;
  - ambos NULL → `23514`.

### 2.3 Endoso y asientos de cheques

- **Target:**
  - Cheque propio: no asienta si la OP es interna, ni en `cancelled` con la OP anulada. Si asienta,
    usa el canal de la OP.
  - Endoso rechazado: toma la OP no anulada más reciente (`created_at desc, id desc`) y usa su
    canal.
  - Trigger en `payment_order_payment_lines`: el canal del cheque endosado es el de la OP. Si el
    cheque está en NULL, toma el de la OP.
- **Validation:** pgTAP:
  - cheque propio de una OP interna → sin asiento;
  - anular una OP fiscal con cheque propio → un solo reverso;
  - endoso cruzado → `23514`.

### 2.4 UI de cheques

- **Files:** `features/checks/{components/check-action-dialogs.tsx:63-65,263-265,schema.ts,actions/checks-actions.ts}`,
  `features/issued-checks/**`, `app/(dashboard)/checks/page.tsx:28`.
- **Target:**
  - Con canal conocido: se muestra el nombre (resuelto contra todos los canales) y no se manda
    `p_channel_id`.
  - Con canal NULL: select obligatorio.
  - El alta manual exige canal.
  - Los errores pasan por `mapDbGuardError`.
- **Validation:** `pnpm typecheck`, `pnpm test`.

## Phase 3: Libro diario solo fiscal (PR C, PR C2 — C4)

Depende de D1.

### 3.1 RPC de alta manual

- **Files:** `supabase/migrations/<ts>_journal_manual_rpc.sql`, `supabase/tests/journal_manual_test.sql`,
  `lib/commands/create-manual-journal-entry.ts:31-37`.
- **Target:**
  - `create_manual_journal_entry(p_entry_date, p_description, p_lines, p_channel_id)`:
    - DEFINER con grant a `authenticated` y chequeo de rol owner/admin/finance;
    - canal NULL o fiscal **activo**;
    - sin `source_*`;
    - calcula `accrual_period` igual que `accrualPeriodFromDate`;
    - se agrega a `MONEY_RPCS` de `lib/db/rpc-role-guards.test.ts` con `accounting:write`.
  - `drop policy` de las dos `ALL`; `revoke truncate` de `anon` y `authenticated` sobre
    `journal_entries` y `journal_entry_lines`.
  - Diagnóstico de asientos con canal no fiscal.
- **Validation:** pgTAP como finance:
  - `jouve_internal` → `23514`;
  - NULL → ok;
  - insert directo → denegado.

### 3.2 Revoke de `create_journal_entry` (PR C2, con C ya promovido)

- **Target:** `revoke execute on create_journal_entry from authenticated`.
- **Validation:** pgTAP: `has_function_privilege` → false.

### 3.3 Checklist de rollback (PR C2)

- **Files:** `CONTRIBUTING.md`, cuerpo del PR C2.
- **Target:** escribir la nota de rollback descrita en la one-way door 3.
- **Validation:** —

### 3.4 Diálogo y docs

- **Files:** `features/journal-entries/components/manual-entry-dialog.tsx:74-75,163-172`,
  `features/journal-entries/schema.ts:105`, `docs/accounting-patterns.md:30-32`.
- **Target:** el select ofrece canales `is_active && is_fiscal`, con la etiqueta "Canal fiscal
  (opcional)". Actualizar el doc.

## Phase 4: Reversos y re-asientos (PR D — C5, C6; PR E — C7, M1)

Objetivo: después de editar o anular un documento, el diario coincide con él por cuenta y por centro
de costo, y nada cambia en un período cerrado salvo que el asiento realmente difiera. Depende de D2,
D3 y D4.

### 4.1 Bases: `build_*`, reverso y re-asiento (PR D)

- **Files:** `supabase/migrations/<ts>_journal_reverse_repost.sql`, `supabase/tests/journal_reverse_test.sql`,
  `lib/db/multicurrency-reports.test.ts:13,34`.
- **Target:**
  - **EXTRACT de `build_*_journal_lines`** para recibo, OP y movimiento. Los `emit_*` pasan a ser
    build + insert.
  - **Recibo:** mantiene las retenciones de 1.5.
  - **USD:** `build_*` usa la cotización **guardada** con la cadena actual (`nullif(cotizacion,0),
get_exchange_rate, 1`), igual que `libro_iva_*` y como exige `multicurrency-reports.test.ts:46-58`.
    No hay write-back ni raise. Recibos, OPs y movimientos siguen al nominal (Deferred).
  - **`journal_missing_entries()`:** diagnóstico DEFINER interno. Lista los documentos fiscales
    vigentes sin asiento y aquellos cuyo asiento vigente ≠ `build_*`. Va en el cuerpo del PR, para
    que el dueño vea el alcance antes de promover.
  - **`current_journal_entry`, `reverse_journal_entry` y `repost_journal`** según la tabla de
    Arquitectura.
    - `set_journal_cost_center` saltea cuando `new.is_reversal`.
    - Los 4 triggers de anulación usan `reverse_journal_entry`. Si no hay asiento, no hacen nada.
      Anular en un período cerrado da `55006`, igual que hoy.
  - **`DROP FUNCTION`** de las firmas viejas de `emit_*` y `build_*` (con `p_reverse`), y se crean
    las nuevas con revoke ×3.
- **Validation:** pgTAP. Después de cada mutación que deba disparar triggers diferidos se hace
  `set constraints all immediate` (precedente: `user_access_test.sql:70`), porque si no los triggers
  diferidos nunca corren dentro del `begin … rollback`. Casos:
  - un insert de cada origen (comprobante, recibo, OP, compra) sigue asentando: smoke de los call
    sites reemplazados;
  - anular después de cambiar el rol COA → el reverso es exactamente el original negado;
  - centro de costo NULL → X → el reverso queda NULL;
  - anular en un período cerrado → `55006` con hint;
  - `has_function_privilege('authenticated', …)` → false en todas.

### 4.2 Compras: re-asiento y guards (PR D)

- **Files:** misma migración, `features/purchase-invoices/hooks/use-purchase-invoices.ts:168`,
  `features/purchase-invoices/actions/purchase-invoices-actions.ts:480-565`.
- **Target:**
  - `replace_purchase_invoice_items` pierde su bloque de diario.
  - Constraint trigger `AFTER UPDATE OF imp_neto, imp_iva, imp_trib, imp_total, imp_op_ex,
imp_tot_conc, fecha, moneda, cotizacion, account_id, cost_center_id, kind, letter, punto_venta,
numero, channel_id`, `DEFERRABLE INITIALLY DEFERRED`, sobre compras `received` → `repost_journal`.
  - La edición en dos llamadas (cabecera y después ítems) re-asienta una vez por commit. Es
    idempotente gracias a la comparación. Si fallan los ítems, el asiento refleja la cabecera, que
    es lo que quedó guardado.
  - BEFORE UPDATE con hint:
    - cambiar el canal de una compra recibida → `23514`;
    - cambiar `kind` cuando ya tiene imputaciones → `23514`;
    - si la `fecha` vieja o la nueva cae en un período cerrado y cambia alguna columna que lee
      `libro_iva_compras` → `55006`.
  - Vista base set-based `v_purchase_invoice_open`, con todas las compras y sus montos imputados,
    acreditados y de saldo inicial. `v_supplier_aging_documents` se redefine sobre ella, con las
    mismas columnas y un test de paridad.
  - Constraint trigger diferido post-edición. Hace `select … for update` de la compra editada y de
    sus orígenes viejo y nuevo. Rechaza (`23514`, hint) si alguno queda con pendiente < −0.01.
  - `guard_payment_order_allocation` (#247) conserva su fórmula y su `FOR UPDATE`.
  - La UI invalida en `onSettled`.
  - Diagnóstico de compras cuyo asiento no coincide con el canal o el total actual.
- **Validation:** pgTAP como `authenticated`:
  - alta con ítems, cabecera + ítems, solo ítems, cambio de centro de costo: en todos,
    `sum(debit-credit)` por cuenta y centro = el asiento esperado;
  - cambio de notas en un período cerrado → ok;
  - pendiente negativo, cambio de kind y cambio de un campo del Libro IVA en período cerrado →
    fallan.

### 4.3 Campos fiscales en compras (PR D)

- **Target:**
  - Trigger: un canal fiscal exige letra al insertar o cuando cambian `letter` o `channel_id`.
  - El form marca la letra como requerida con `channelIsFiscal`.
  - Diagnóstico de compras fiscales sin letra.
- **Validation:** pgTAP:
  - INSERT fiscal sin letra → `23514`;
  - editar el importe de una histórica sin letra → ok.

### 4.4 Recibos y OPs editados (PR D)

- **Files:** misma migración.
- **Target:**
  - Constraint triggers `AFTER UPDATE OF receipt_date, total_amount` (o `payment_date,
total_amount`), `DEFERRABLE INITIALLY DEFERRED` y DEFINER, en `receipts` y `payment_orders` →
    `repost_journal`.
  - `update_receipt` / `update_payment_order` siempre setean esas columnas, así que toda edición
    dispara el trigger. `notified_at` no lo dispara.
  - `update_receipt` / `update_payment_order` (INVOKER) **no** cambian.
- **Validation:** pgTAP como finance:
  - editar el total de un recibo fiscal → un solo asiento vigente, que cuadra;
  - editar solo las notas en un período cerrado → ok;
  - un UPDATE de `notified_at` en un recibo viejo sin asiento → ok, sin asiento nuevo.

### 4.5 Saldo inicial de cuenta (PR E)

- **Files:** `features/accounts/components/account-opening-balance-dialog.tsx:68,81`,
  `features/accounts/schema.ts`.
- **Target:** canal vacío al abrir (el existente al editar), obligatorio, `min(1)`.
- **Validation:** `pnpm test`.

### 4.6 Movimientos sueltos (PR E)

- **Files:** `supabase/migrations/<ts>_transactions_repost.sql`, `supabase/tests/transactions_repost_test.sql`.
- **Target:**
  - Trigger `AFTER UPDATE OF amount, transaction_date, accrual_month, account_id, channel_id, kind`
    (DEFINER) → `repost_journal`. La descripción no lo dispara.
  - `channel_id` se suma a `guard_transaction_immutable_when_linked`.
- **Validation:** pgTAP:
  - cambiar el importe → un asiento;
  - cambiar la descripción en un período cerrado → ok;
  - mover un sueldo a canal interno → sin asiento;
  - cambiar el canal de un tramo de transferencia → `55006`.

## Phase 5: Configuración e invariantes (PR F — A4)

### 5.1 Inmutabilidad de canal y POS

- **Files:** `supabase/migrations/<ts>_channel_config_guards.sql`, `supabase/tests/channel_config_test.sql`.
- **Target:**
  - `invoicing_channels`: cambiar `is_fiscal` o `division` con documentos → `23514`.
  - `sales_points`, BEFORE UPDATE **OF channel_id**: rechaza si el canal viejo tiene numeración, o
    si `last_synced_at is not null` y el canal nuevo no es fiscal.
  - Reactivar está permitido.
- **Validation:** pgTAP: los rechazos fallan; un rename y un sync de un POS interno pasan.

### 5.2 POS en afip-admin

- **Files:** `features/afip-admin/{schema.ts,actions/afip-admin-actions.ts:125-210}`.
- **Target:**
  - `configurePosAction`: el canal debe existir y estar activo. Rechaza un segundo POS habilitado
    en el mismo canal (evita mover la numeración de `loadChannelPos`).
  - `syncAfipPosAction` omite los números de canales internos y loguea
    `logger.warn("afip.pos_sync.internal_conflict", { count })`.
- **Validation:** Vitest.

### 5.3 Invariantes de regresión

- **Files:** `supabase/tests/fiscal_invariants_test.sql`.
- **Target:** pgTAP con tres invariantes:
  - ningún `journal_entries` con canal no fiscal;
  - `authenticated` no puede insertar en el diario ni ejecutar funciones internas del diario;
  - todo asiento de un documento fiscal coincide con `build_*` (muestreo sobre el seed).
- **Validation:** CI.
- **Scope:** se descartó un censo estático de lecturas, porque tiene 74 sitios y no ve `.rpc` ni las
  vistas. Las lecturas quedan cubiertas por los Vitest por acción de 6.1 y 8.1.

## Phase 6: Filtro fiscal en lecturas (PR G — A2, A3)

Depende de 0.2, PR B, D7 y D8.

### 6.1 `isFiscal` en las read actions

- **Files:**
  - `lib/supabase/fiscal-filter.ts`;
  - `lib/scope.ts` (+ `isFiscalFor`, `defaultChannelFor`);
  - read actions de invoices, receipts, payment-orders, transactions, purchase-invoices, loans,
    payroll-payments, checks, issued-checks, aging, cuenta corriente, recurring-payments;
  - `features/treasury/actions/cash-flow-actions.ts:42-48,244-262`;
  - `features/invoices/hooks/use-invoices.ts:150-163`;
  - `supabase/migrations/<ts>_aging_by_scope.sql`.
- **Target:**
  - Cada read action recibe `isFiscal?: boolean | null` y usa `applyFiscalFilter` sobre su embed.
  - Las listas de UI dejan de recibir `channelId`. Lo mantienen los pickers "mismo canal" y
    `search_purchase_invoices`. No se quita ningún parámetro de RPC.
  - Las herramientas de IA que llaman estas acciones pasan `isFiscal: null` hasta el PR I.
  - Aging: vistas `v_client_aging_by_scope` / `v_supplier_aging_by_scope`, agrupadas por
    `(contraparte, channel_is_fiscal)`, con `security_invoker = on`, revoke de `anon` y la forma de
    `v_*_aging`.
    - Con `isFiscal` null se sigue leyendo `v_*_aging` sin cambios.
    - Con valor, se lee `by_scope` con `.eq("channel_is_fiscal", v)`: una fila por contraparte,
      ordenada por `(contraparte, channel_is_fiscal)`.
    - `lib/aging` sigue siendo el único agregador.
    - El `describe.each` de `multicurrency-reports.test.ts` cubre las vistas nuevas.
    - Las lecturas de `features/ai/insights/gather.ts` pasan a paginar.
  - Cuenta corriente: según D6.
  - Tesorería: el flujo de caja usa `channelIsFiscal`, y los cheques se clasifican por su canal.
  - `useOriginSearch` filtra `isFiscal` y `kind` en el servidor y excluye canales inactivos.
  - Gate compuesto `userCanAll(["clients:read","invoices:read","receipts:read"])`, con el
    equivalente para proveedores. El rol `operations` deja de ver aging (estrechamiento intencional,
    se dice en el PR). Se aplica en:
    - las acciones;
    - `app/(dashboard)/aging/page.tsx:20` y `aging-suppliers/page.tsx:20`;
    - las entradas de nav;
    - el export (el tipo `permission` en `app/api/export/shared.ts:76` pasa a
      `Permission | readonly Permission[]`);
    - la herramienta IA.
- **Downstream changes:** `app/(dashboard)/dashboard/page.tsx:47-51`, `features/ai/insights/gather.ts`,
  `lib/inngest/functions/aging-weekly-summary.ts:106`, query keys, prefetch de
  `clients/[id]` / `suppliers/[id]`.
- **Validation:** Vitest por acción con filas fiscal, interna, fiscal inactiva y de canal NULL:
  - `true` incluye la inactiva y excluye la NULL;
  - `null` incluye todas.

### 6.2 Un control: el selector global

- **Files:** las tablas (`invoices-table.tsx:204-258`, `transactions-table.tsx:191-244`,
  `purchase-invoices-table.tsx:232-271`, receipts, OPs, cheques, préstamos, aging), los tabs de
  cuenta corriente y las `page.tsx`.
- **Target:**
  - Se sacan los filtros locales y sus params de URL.
  - `isFiscal = isFiscalFor(filter)`, envuelto en `useDeferredValue`.
  - El server component lee la cookie con `cookies().get(SCOPE_COOKIE)` → `parseFiscalFilter` y
    prefetchea con la misma key.
  - El dashboard muestra `SCOPE_LABEL`, y tesorería se rotula "Caja real (todos los canales)".
  - El diario conserva su filtro propio.
- **Validation:** Vitest: misma key en server y en cliente. E2E: "Solo fiscal" no muestra internos.

### 6.3 Default de canal

- **Files:** `lib/scope.ts` y los forms (`receipt-form.tsx:114-118`, `payment-order-form.tsx:119`,
  `transaction-form.tsx:122`, `new-invoice-dialog.tsx:168,198`, `bulk-payroll-payment-dialog.tsx:100,122`,
  `payroll-payments-dialog.tsx:162`, `purchase-invoice-form.tsx:188`,
  `create-sales-invoice-dialog.tsx:63`, `create-payment-doc-dialog.tsx:120`),
  `tests/e2e/invoices.spec.ts:26-29`.
- **Target:**
  - Se borra `DEFAULT_CHANNEL_ID`.
  - Los forms quedan con `record?.channel_id ?? defaultChannelFor(...) ?? ""` y validación `min(1)`.
  - El e2e elige el canal.
- **Validation:** Vitest y e2e.

## Phase 7: Salidas a terceros (PR H — C8, M4)

Depende de 6.1, D5 y D6.

### 7.1 Exports por alcance

- **Files:** `app/api/export/{shared.ts,[resource]/route.ts}`, `components/export-button.tsx`, los
  11 resources (`invoices`, `receipts`, `payment-orders`, `transactions`, `purchase-invoices`,
  `aging`, `supplier-aging`, `checks`, `issued-checks`, `client-account`, `supplier-account`).
- **Target:**
  - `scope` con `z.enum(FISCAL_FILTERS)`.
  - Cada resource usa su read action o `applyFiscalFilter`.
  - Columna "Canal" y encabezado `SCOPE_LABEL`.
  - `ExportInputError` → 400 + `logger.warn`.
- **Validation:** Vitest del route.

### 7.2 PDFs y emails internos

- **Files:** `lib/pdf/emisor.ts`, `lib/pdf/{invoice-template,receipt-template,payment-order-template}.tsx`,
  los renderers, `features/invoices/actions/send-invoice-email.ts`,
  `features/receipts/actions/send-receipt-email.ts`, `lib/email/templates/{invoice,receipt}-email.tsx`.
- **Target:**
  - `redactEmisor` y título interno cuando `!isFiscal`.
  - Emails internos sin "factura" ni "sistema de facturación" en asunto, cuerpo y nombre de archivo.
  - Los PDFs fiscales quedan con las mismas props.
- **Validation:**
  - Snapshot de props: el fiscal no cambia; el interno sale sin CUIT.
  - Determinismo (1.4).
  - Tests de los emails.
- **Scope:** sin columna de layout. Los hashes históricos ya no eran reproducibles (1.4).

## Phase 8: IA y crons (PR I — A1, M5)

Depende de 6.1.

### 8.1 Alcance en herramientas

- **Files:** `features/ai/registry/actions/{sales,purchases,receivables,cash,statements,payroll,accounting,treasury,fleet,warehouse}.ts`,
  `features/ai/components/tool-renderers.tsx`, `supabase/migrations/<ts>_ai_rpcs_fiscal_filter.sql`.
- **Target:**
  - `scope: z.enum(FISCAL_FILTERS)` en lugar de `channelId` en:
    - getInvoices, getReceipts, getClientSalesSummary, getClientAging;
    - getPurchaseInvoices, getPaymentOrders, getSupplierPurchasesSummary, getSupplierUpcomingDues,
      getSupplierPriceEvolution, getSupplierAging;
    - getTransactions, getChecks, getIssuedChecks, getJournalEntries;
    - getLoans, getLoanDetail, getPayrollSummary, getRecurringPayments;
    - getFleetMargin, getStorageBilling.
  - getTreasurySummary rotula "caja real".
  - RPCs: drop + create con `p_is_fiscal boolean default null`, aplicado en cada CTE, para
    `ai_client_sales_summary`, `ai_supplier_purchases_summary`, `ai_supplier_upcoming_dues`,
    `ai_supplier_price_evolution`, `ai_payroll_summary` (incluido el lateral) y `ai_fleet_margin`.
    Grants INVOKER.
  - Libro IVA: el rechazo de canales no fiscales queda en `libro_iva_*` (`create or replace`, misma
    firma, con hint). `getLibroIva*` dejan de recibir `channelId`.
  - `getChecks`/`getIssuedChecks` usan `totalsByCurrency`.
- **Validation:** `pnpm test`; `pnpm eval:ai` antes y después.

### 8.2 Etiquetas, regla y crons

- **Files:** `features/ai/agent.ts:40-55`, `features/ai/skills/registry.ts:33`,
  `features/ai/weekly/reads.ts`, `features/ai/insights/{gather,analyst,anomalies/gather}.ts`,
  `lib/inngest/functions/aging-weekly-summary.ts:64-151`.
- **Target:**
  - `SCOPE_LABEL` en cada cifra.
  - Regla en el prompt: "facturación, IVA y fiscal solo con scope fiscal o desde los libros IVA; si
    sumás internos, decilo".
  - La sección Ventas del resumen semanal usa scope fiscal.
  - Insights y el mail de aging separan o rotulan.
  - El log `aging.weekly_summary` (`aging-weekly-summary.ts:134-137`) emite solo conteos: nada de
    razón social, CUIT ni montos.
  - Anomalías: solo comprobantes `received`, agrupados por alcance.
- **Validation:** `pnpm eval:ai` con "¿cuánto facturé en mayo?". Vitest.

## Phase 9: Rol `fiscal_reader`

Diferido (A5).

## Phase 10: Menores (PR J — M2)

### 10.1 Flete y storage

- **Files:** `features/shipments/actions/shipments-actions.ts:88-96,352-470`,
  `features/storage-billing/actions/billing-actions.ts:204-225`.
- **Target:**
  - Canales desde `getActiveInvoicingChannels()`.
  - Facturar un envío con un canal distinto al suyo → `{ ok:false }`.
  - El solapamiento de storage se mide por cliente y canal.
- **Validation:** Vitest.

## Phase 11: Lint (PR K — al final)

### 11.1 `no-unused-vars` (29)

- **Target:**
  - Agregar `argsIgnorePattern: "^_"` en `eslint.config.mjs` (convención nueva, va explicada en el
    cuerpo del PR).
  - Borrar lo muerto: `git grep` de `addMembers` y `terminationDateNullable` antes de sacarlos.
- **Validation:** `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### 11.2 `incompatible-library` (12), `exhaustive-deps` (2), Next (2)

- **Target:**
  - Reemplazar `form.watch` por `useWatch`.
  - Arreglar las deps de `reaction-bar.tsx:24` y `libro-mayor-page.tsx:35`.
  - `eslint-disable` justificado en `file-preview-dialog.tsx:86`.
  - `router.push` en `browser-notifier.tsx:76`.
- **Validation:** `pnpm lint`, `pnpm test`. A mano: los totales de los forms.

## File Inventory: What Gets Created/Modified

### New files

| File                                                                                       | Purpose                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `supabase/migrations/<ts>_channel_active_guard.sql` / `<ts>_retire_dz_division.sql`        | Guard + diagnóstico (0.1) / retiro (0.4)                       |
| `supabase/migrations/<ts>_guard_hints.sql`                                                 | Hints (1.3)                                                    |
| `supabase/migrations/<ts>_checks_channel.sql`                                              | Cheques (2.x)                                                  |
| `supabase/migrations/<ts>_journal_manual_rpc.sql` / `<ts>_revoke_create_journal_entry.sql` | Diario (3.1–3.2)                                               |
| `supabase/migrations/<ts>_journal_reverse_repost.sql`                                      | `build_*`, reverso, re-asiento, compras, recibos/OPs (4.1–4.4) |
| `supabase/migrations/<ts>_transactions_repost.sql`                                         | Movimientos (4.6)                                              |
| `supabase/migrations/<ts>_channel_config_guards.sql`                                       | Canal/POS (5.1)                                                |
| `supabase/migrations/<ts>_aging_by_scope.sql` / `<ts>_ai_rpcs_fiscal_filter.sql`           | Lecturas (6.1, 8.1)                                            |
| `supabase/tests/*_test.sql`                                                                | pgTAP por fase + invariantes (5.3)                             |
| `supabase/migrations/<ts>_receipt_retentions_journal.sql`                                  | Bug de recibos con retenciones (1.5)                           |
| `lib/supabase/fiscal-filter.ts`, `lib/db/guard-errors.ts`, `lib/pdf/emisor.ts`             | Helpers                                                        |
| `features/storage-billing/schema.test.ts`                                                  | Regresión 1.1                                                  |

### Modified files

| File                                                                                                                                                                                                                            | Change                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `lib/scope.ts`, `components/scope-selector.tsx`, `components/providers/scope-provider.tsx`, `app/(dashboard)/layout.tsx`                                                                                                        | Alcance                              |
| `features/{invoices,receipts,payment-orders,transactions,purchase-invoices,loans,hr,checks,issued-checks,aging,clients,suppliers,accounts,journal-entries,afip-admin,shipments,storage-billing,treasury,recurring-payments}/**` | `isFiscal`, defaults, forms, errores |
| `features/ai/**`, `lib/inngest/functions/aging-weekly-summary.ts`                                                                                                                                                               | IA y crons                           |
| `lib/pdf/**`, `lib/email/templates/**`, `app/api/export/**`, `components/export-button.tsx`, `components/layout/nav-items.ts`, `app/(dashboard)/aging*/page.tsx`                                                                | Salidas y gates                      |
| `lib/commands/create-manual-journal-entry.ts`, `lib/db/pg-error-codes.ts`, `lib/db/multicurrency-reports.test.ts`                                                                                                               | Diario, errores                      |
| `CONTRIBUTING.md`, `lib/auth/permissions.ts` (+ `userCanAll`), `lib/db/rpc-role-guards.test.ts`, `supabase/seed.sql`, `scripts/seed-everything.mjs`, `CLAUDE.md`, `docs/*.md`, `eslint.config.mjs`                              | Deploy, seed, docs, lint             |

## Success Criteria

1. Todos los pgTAP de guards, triggers y grants pasan como `authenticated` con su migración, y
   fallan sin ella.
2. Después de 0b:
   - camino borrar: no existe ningún canal ni fila DZ; el resto de este punto no aplica;
   - no se puede crear ni mover nada a un canal DZ;
   - corregir compras de DZ y anular recibos u OPs de DZ sigue funcionando;
   - una compra de DZ conserva su letra;
   - las NC y ND de DZ siguen el runbook de D10.
3. No aparecen asientos nuevos con canal no fiscal. `authenticated` no puede escribir en el diario
   ni ejecutar funciones internas del diario.
4. Después de editar o anular cualquier documento, el diario coincide con él por cuenta y por centro
   de costo. Un período cerrado solo rechaza los cambios que alteran el asiento o el Libro IVA
   Compras. Un UPDATE que no toca el asiento (`notified_at`, notas, descripción) nunca re-asienta.
   Los recibos fiscales con retenciones se pueden crear.
5. Con "Solo fiscal", listas, exports, cuenta corriente, aging, IA y crons no devuelven filas
   internas ni de canal NULL, y **sí** incluyen el histórico fiscal de DZ. Toda cifra lleva
   `SCOPE_LABEL`, y tesorería se rotula "Caja real".
6. `git grep -n -E 'DEFAULT_CHANNEL_ID|"(jouve|dz)_(fiscal|internal)"|"dz"|division ===' -- features
app components lib ':!*.test.*'` → 0.
7. Los PDFs y emails internos no muestran CUIT ni títulos fiscales. Las props de los fiscales no
   cambian. El PDF es determinístico.
8. `pnpm eval:ai` no regresa, y "¿cuánto facturé?" usa scope fiscal.
9. `pnpm lint` → 0 warnings. `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm check:migrations`
   pasan en cada PR.

## Falsification Log

**Método.** Rondas de atacantes `Explore` independientes. Cada uno recibió solo el plan y el código,
con los lentes por Read y eco de load-proof. Cada premisa se verificó en el código o en la DB antes
de actuar. Un atacante de la ronda 2 ejecutó un `CREATE` dentro de una transacción con rollback en
la DB local (fuera de la regla de solo SELECT): no persistió nada, y la ronda 3 lo prohibió
explícitamente.

**Ronda 1** (6 atacantes). Hallazgos principales:

- **Fatales:**
  - R1-1: sobrecargas de RPC → PGRST203.
  - R1-2: el retiro de DZ bloqueaba los saldos de DZ y el informe de CAEA.
  - R1-3: el form de compras borraba la letra.
  - R1-4: doble re-asiento de compras.
  - R1-5: el saldo de cuenta corriente por canal salía mal.
- **Serios (≈30):** visibilidad vs. elegibilidad, lista de ids vs. `isFiscal`, triggers sin DEFINER,
  forja de `source_*`, reverso reconstruido, guards de compras, cheques, IA y crons, exports, PDFs,
  parseo, controles, etiquetas.

Todos quedaron FIXED o superados en las versiones siguientes. D11 sigue como decisión.

**Ronda 2** (4 atacantes). Hallazgos principales:

- **Fatales:**
  - R2-1: un gate dentro de la migración trababa las promociones.
  - R2-2: el reverso tomaba el centro de costo actual.
  - R2-3: quitar `p_channel_id` rompía #247 y el código viejo.
- **Serios:** cobertura del gate y del guard, dos mecanismos de reverso, fila de saldo inicial,
  fórmula de pendiente, recibos/OPs sin re-asiento, raise en el INSERT, embed y canal NULL,
  `channelIsFiscal` booleano, DAG, contrato de errores, `pdf_hash`, `ai_payroll_summary`, cerca,
  emisor.

Todos FIXED en v3.

**Ronda 3** (4 atacantes: rol/deploy, objetivos/puertos/claims, alcance, integridad):

| #     | Vector · evidencia                                                                                                                                                                     | Sev.       | Resolución                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| R3-1  | Re-asiento dentro de `update_receipt`/`update_payment_order` (INVOKER): los `emit_*` no tienen grant y el DELETE bajo RLS borra 0 filas → 42501 o doble asiento. Lo vieron 4 atacantes | fatal      | FIXED: 4.4, constraint triggers diferidos DEFINER con `repost_journal`; las RPC no cambian            |
| R3-2  | Guard sobre `journal_entries`: los reversos y re-asientos de DZ fallan, contra D10 y el criterio 2. 4 atacantes                                                                        | fatal      | FIXED: `journal_entries` fuera del guard; los manuales se validan en 3.1                              |
| R3-3  | DDL inválido: WHEN con `OLD` en INSERT; `checks`/`issued_checks` no tienen columna en el PR 0; `suppliers` usa `default_channel_id`. 4 atacantes                                       | fatal      | FIXED: dos triggers con `TG_ARGV`; cheques en 2.1                                                     |
| R3-4  | La convención de revoke dejaba `authenticated` con EXECUTE sobre funciones DEFINER internas (forja) y contradice los checks de CI. 3 atacantes                                         | fatal      | FIXED: tabla de grants + pgTAP `has_function_privilege`                                               |
| R3-5  | Quitar `p_reverse` sin DROP deja sobrecargas ambiguas y contradice la regla de expand-only                                                                                             | serious    | FIXED: one-way door 4 acotado + DROP explícito                                                        |
| R3-6  | `dz_open_items` no puede salir de vistas con canal NULL o sin moneda; nunca llega a 0; no se dice quién lo corre                                                                       | serious    | FIXED: por documento, con moneda, ejecutado por el dueño antes de `production-gate`, y se borra en 0b |
| R3-7  | `pdf_layout`: nadie lo escribía; el código viejo; el PDF no es determinístico (`creationDate`), así que el test de hash es imposible                                                   | serious    | FIXED: 1.4 PDF determinístico, se elimina `pdf_layout`, snapshot de props                             |
| R3-8  | El piso de rollback de C2 no se impone                                                                                                                                                 | moderate   | FIXED → R4-6: checklist (3.3)                                                                         |
| R3-9  | El censo de CI es incompleto y depende de PR G                                                                                                                                         | serious    | FIXED: reemplazado por invariantes pgTAP + Vitest por acción (5.3)                                    |
| R3-10 | Gates compuestos sin tipo de export, páginas de aging ni nav                                                                                                                           | moderate   | FIXED: 6.1                                                                                            |
| R3-11 | 0b antes de B → el backfill de cheques choca con el guard                                                                                                                              | serious    | FIXED: 0b requiere B promovido                                                                        |
| R3-12 | 0.3 cambiaba el Concepto y el prompt mientras DZ todavía operaba                                                                                                                       | moderate   | FIXED: pasa a 0.4                                                                                     |
| R3-13 | `useOriginSearch` usa `isFiscal` de PR G y trunca por `kind`                                                                                                                           | serious    | FIXED: movido a 6.1, con filtros del lado del servidor                                                |
| R3-14 | Re-asiento en 4 copias, sin una unidad definida                                                                                                                                        | serious    | FIXED: `repost_journal` + `build_*`                                                                   |
| R3-15 | Guard de pendiente: lee OLD, tres fórmulas, tolerancias distintas                                                                                                                      | serious    | FIXED: `purchase_invoice_open_amount` + trigger diferido                                              |
| R3-16 | Re-asiento incondicional bloquea ediciones de solo notas en período cerrado; los recibos con retenciones quedan desbalanceados (bug existente, verificado en `schema.ts:152-161`)      | serious    | FIXED: comparar antes de re-asentar; retenciones → superado por R4-1                                  |
| R3-17 | TC re-derivado; `moneda`/`cotizacion` fuera del WHEN                                                                                                                                   | moderate   | FIXED → R4-4: cotización guardada, sin write-back; comparación sin descripciones                      |
| R3-18 | El raise reportaba mal la causa y no llevaba hint                                                                                                                                      | moderate   | FIXED: raise desde `repost_journal` con causa y hint                                                  |
| R3-19 | D6: el saldo de la cuenta corriente ≠ el del aging                                                                                                                                     | moderate   | FIXED: con alcance, un único saldo = aging; "Todos" igual que hoy                                     |
| R3-20 | Tesorería `readFiscal` y herramientas IA faltantes (treasury, recurring, loan detail, fleet, storage)                                                                                  | serious    | FIXED: 6.1, 8.1                                                                                       |
| R3-21 | API de filtro en dos funciones; `Scope` wrapper; helpers sin uso en PR 0                                                                                                               | should-fix | FIXED                                                                                                 |
| R3-22 | Slug de telemetría armado a partir del ctx; command de asientos sin mapeo                                                                                                              | cosmetic   | FIXED: slug literal; 1.3                                                                              |
| R3-23 | Claims: "13 PRs", overclaim en 1.2, `guard_transaction_immutable_when_linked` sin hint/`search_path`, TRUNCATE sobre el diario                                                         | cosmetic   | FIXED                                                                                                 |

**Ronda 4** (4 atacantes: diseño SQL, rol/deploy, alcance, objetivos/simplicidad):

| #     | Vector · evidencia                                                                                                                                                                                                                          | Sev.              | Resolución                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4-1  | Retenciones a `retenciones_cobradas` (pasivo, 2.1.2.5) y del lado del crédito: el asiento sigue desbalanceado. Además, hoy un recibo fiscal con retenciones **no se puede crear** (23514 al commit; `create_journal_entry:81`). 3 atacantes | fatal             | FIXED: 1.5 en el PR A, débito a `retenciones_pagadas` / `percepciones_iibb_pagadas`, y D12                                                                                      |
| R4-2  | El `DROP` de las firmas `emit_*` rompe los 9 call sites (plpgsql se resuelve recién al ejecutar)                                                                                                                                            | serious           | FIXED: one-way door 4, reemplazo previo + smoke + Vitest de aridad                                                                                                              |
| R4-3  | El re-asiento disparado por cualquier UPDATE (`notified_at`) reescribía el histórico; la clave de comparación no estaba definida; caso sin asiento. 4 atacantes                                                                             | serious           | FIXED: `AFTER UPDATE OF` columnas de asiento, comparación sin descripciones, no-op + diagnóstico                                                                                |
| R4-4  | El write-back o raise de la cotización USD choca con `check_invoice_immutability`, con el test de paridad y con documentos que no tienen la columna                                                                                         | serious           | FIXED: cadena actual con la cotización guardada, sin write-back                                                                                                                 |
| R4-5  | Los pgTAP de triggers diferidos no prueban nada dentro de `begin…rollback`                                                                                                                                                                  | serious           | FIXED: `set constraints all immediate`                                                                                                                                          |
| R4-6  | El piso de rollback se lee del árbol del SHA destino, y el Instant Rollback de Vercel lo saltea                                                                                                                                             | serious           | FIXED: se reemplaza por un checklist (simplicidad)                                                                                                                              |
| R4-7  | Las NC de facturas fiscales de DZ son imposibles después de 0b (guard + POS deshabilitado)                                                                                                                                                  | serious           | FIXED: runbook en D10; criterio 2 reescrito                                                                                                                                     |
| R4-8  | 0b borraba de forma irreversible el canal histórico de viajes y envíos; el guard frente a NULL                                                                                                                                              | serious           | FIXED: solo pendientes; el guard devuelve `new` con NULL                                                                                                                        |
| R4-9  | Las vistas `by_scope` daban varias filas por contraparte, con paginación y `party_count` rotos; grants a anon                                                                                                                               | serious           | FIXED: `null` → vista vieja; con valor → `.eq`; `security_invoker`; revoke de anon; test                                                                                        |
| R4-10 | `purchase_invoice_open_amount` por fila en la vista (perf) y paridad con el guard de #247                                                                                                                                                   | serious           | FIXED: vista base set-based; el guard de #247 queda igual                                                                                                                       |
| R4-11 | Edición de compras en dos llamadas                                                                                                                                                                                                          | moderate          | REBUTTED-with-evidence: idempotente por la comparación; el estado final coincide con lo guardado                                                                                |
| R4-12 | Writer de la cookie ausente                                                                                                                                                                                                                 | serious           | FIXED: `serializeFiscalFilter` + tests de ida y vuelta y legacy                                                                                                                 |
| R4-13 | Hints y adopters incompletos; match por texto en la anulación                                                                                                                                                                               | moderate          | FIXED: regla de hints, adopters ampliados                                                                                                                                       |
| R4-14 | Gate compuesto sin helper; nav de un solo permiso                                                                                                                                                                                           | should-fix        | FIXED: `userCanAll`                                                                                                                                                             |
| R4-15 | PRs que reescriben la misma función (A↔D/E); RPC manual fuera de `MONEY_RPCS`                                                                                                                                                               | should-fix        | FIXED: orden + test de `latestDefinition`; agregado a `MONEY_RPCS`                                                                                                              |
| R4-16 | El grep de 0.3 no podía dar 0; `emitted_at` no está en los datos del template; PII en el log de aging                                                                                                                                       | moderate/cosmetic | FIXED                                                                                                                                                                           |
| R4-17 | Que la comparación y el re-asiento genérico sobrediseñen                                                                                                                                                                                    | question          | REBUTTED: bloquear ediciones rompería la edición de recibos y OPs, que está en uso; la comparación es necesaria porque las ediciones en tablas hijas no se ven en la fila padre |

**Gate:** no quedan fatales ni serios sin resolver. Las correcciones de la ronda 4 no se volvieron a
atacar. Cada PR de implementación pasa por `/adv-review` antes de mergearse.

## Deferred Work

- **A5 — rol `fiscal_reader`.** Si el dueño lo confirma.
- **M3 — saldos iniciales por canal.**
- **Reparación del histórico contaminado.** Requiere firma del dueño. Partir de los diagnósticos de
  2.1, 3.1 y 4.2.
- **NOT NULL en `checks.channel_id` / `issued_checks.channel_id`.**
- **D11, si no se decide en el PR B.**
- **Movimientos, recibos y OPs en USD asentados al nominal.** Ya pasaba antes de este plan.
- **Keyset en las listas paginadas con OFFSET.**
- **Quitar `p_channel_id` de `search_purchase_invoices`** en un PR de contracción.
- **`signOut({ scope: "local" })`** (#248).
