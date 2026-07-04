# Remediación de la auditoría — progreso

Rama: `fix/audit-remediation`. Se ejecuta tramo por tramo (T1..T7). Cada tramo:
código + migración + verificación (typecheck, tests, y aplicación real contra el
DB local de Supabase). Sin commit/push hasta que el owner lo pida.

## T1 — Lockdown de seguridad ✅ COMPLETO (verificado)

**Migraciones**
- `20260704140000_audit_t1a_security_lockdown.sql`
- `20260704150000_audit_t1b_rls_and_search.sql`

**Cambios de app**
- `features/files/actions/files-actions.ts`: guards `userCan` en
  `getSignedFileUrlAction` (files:read), `listAttachmentsAction` (files:read),
  `detachFileAction` (files:write).

**Qué cierra**
1. `create_journal_entry` / `emit_journal_*` / `grant_vacation_balances` /
   `next_internal_*` / `bump_rate_limit_bucket` / `refresh_search_index*` /
   `cleanup_*` / `find_orphan_files`: EXECUTE revocado de `public, anon,
   authenticated`. Las dos que se llaman por RLS client y leen `auth.uid()`
   (create_journal_entry, grant_vacation_balances) conservan EXECUTE para
   `authenticated`+`service_role` pero con **guard interno** por rol del JWT.
2. `search_index` (matview): REST bloqueado (`revoke select`); `search_global`
   pasa a `security definer` y su mapa rol→entidad se alinea a la matriz TS
   (operations = client+supplier; warehouse/driver = nada).
3. Tablas maestras (clients, suppliers, purchase_invoices,
   purchase_invoice_items, chart_of_accounts, files, file_attachments): SELECT
   `USING(true)` → scoped a los roles con el `:read` correspondiente.
4. Buckets storage: `invoices-pdf` gateado a roles finance; bucket `files`
   hereda el tightening (su policy consulta `files` bajo RLS del usuario).
5. `user_roles`: escrituras solo por service-role (cierra auto-promoción
   admin→owner por PostgREST).

**Verificación (DB local)**
- driver autenticado → `create_journal_entry` BLOCKED 42501; owner → ALLOWED.
- anon/authenticated → `has_function_privilege` = false en las trigger-only.
- `search_index` → permission denied para anon/authenticated.
- clients/suppliers/purchase_invoices/v_payroll_entries_with_payments → 0 filas
  bajo RLS para usuario sin roles, sin error.
- `pnpm typecheck` ✅ · `pnpm test` 743/743 ✅ · types sin drift.

**Residual (trackeado, no en T1)**
- Scoping por-entidad de `files`/`file_attachments` (que warehouse no vea
  adjuntos de RRHH): es la tensión de diseño "bucket compartido" → **T6**.
- Otras RPC DEFINER de dinero (`create_receipt`, `deposit_check`, etc.) siguen
  llamables por authenticated; refuerzan invariantes internos y escriben a
  tablas con RLS. Guard por rol → se aborda junto con **T4** (tesorería).

## T2 — Corrección fiscal/AFIP 🟡 PARCIAL (subconjunto seguro hecho + verificado)

**Hecho y verificado** (no requiere AFIP en vivo):
- **Poison de numeración (CRÍTICO)** — `lib/inngest/functions/issue-invoice.ts`:
  se eliminó el step `persist-numero` (que escribía `numero` ANTES de llamar a
  AFIP). Ahora el número se computa en memoria, se manda a AFIP, y se persiste
  junto con el CAE en `persist-cae`. Un comprobante rechazado ya no ocupa un
  número → no bloquea el POS; además mejora el caso de concurrencia.
- **IVA fantasma en internas (medio)** — `invoices-actions.ts`:
  `computeTotals(items, channel.is_fiscal)` (antes hardcodeado `true`).
- **Línea fiscal sin IVA (alto)** — `invoices-actions.ts`: se rechaza en la
  action si un canal fiscal tiene un ítem con `iva_rate_id === null` (evita el
  rechazo AFIP ImpNeto ≠ ΣBaseImp que gatillaba el poison).
- **XML injection en doc_nro (medio)** — `lib/afip/wsfev1.ts`: helper
  `xmlEscape` aplicado al único campo de texto libre.
- **Default de fecha UTC (medio)** — `new-invoice-dialog.tsx` +
  `issue-nc-nd-dialog.tsx`: `todayInAR()` en vez de `toISOString().slice(0,10)`.
- **Inmutabilidad de `invoice_items` (alto)** — migración
  `20260704160000_audit_t2_invoice_items_immutable.sql`: trigger row-level que
  bloquea UPDATE/DELETE de ítems de comprobantes emitidos/anulados. Verificado
  contra DB local (emitida bloqueada, draft editable).

Verificación: `pnpm typecheck` ✅ · `pnpm test` 743/743 ✅ · migración aplicada y
probada contra Supabase local.

**Pendiente en T2** (requiere validación en homologación AFIP o rediseño mayor —
no se toca a ciegas la lógica de CAE/CAEA en producción fiscal):
- Recuperación de CAE ante error de servicio (crash post-autorización) — hoy solo
  recupera ante error de transporte.
- Ventana CAEA en meses de 31 días (cron día 26) + `origenes:[]` en NC/ND bajo
  CAEA + fecha vs vigencia CAEA.
- Adopción de CAE recuperado sin comparar importes.
- Validación de ventana ±5/±10 días de fecha.
- `NonRetriableError` para errores deterministas de AFIP (evita reintentar 5×).
- Validación server-side de `invoice_origin_id` (NC/ND).
- Concurrencia por POS (Inngest concurrency key).
## T3/T4 — Fixes de DB/lógica 🟡 EN CURSO (lote 1 hecho + verificado)

**Hecho y verificado contra el DB local** (migraciones `20260704170000`–`20260704200000`):
- **`get_account_balances` — filtro de período/centro de costo muerto (CRÍTICO)**:
  reescrito el join (INNER `jel⋈je` con los filtros → LEFT a `coa`). Verificado:
  período amplio 11 filas / $10.1B vs período angosto 0 filas — **ahora filtra**.
  También incluye cuentas inactivas con movimientos (fix Σdebe=Σhaber).
- **`purchase_invoice_items` — trigger statement-level roto (CRÍTICO)**: eliminado
  el trigger que leía `new/old` (rompía toda escritura desde 2026-05-17); el regen
  del asiento se movió dentro de `replace_purchase_invoice_items` (SECURITY
  DEFINER, tras recalcular el header → corrige también la deriva de subledger C3).
  Verificado: INSERT en items ahora funciona.
- **Aging de proveedores — regresión del saldo inicial (CRÍTICO)**: re-agregado el
  join `supplier_opening_balance_allocations` a `v_supplier_aging_documents`
  (como la vista de clientes). Verificado: vista compila y netea.
- **Dirty-flag de búsqueda (ALTO)**: `search_index_mark_dirty` → `security definer`
  (antes el `update search_index_state set dirty=true` matcheaba 0 filas bajo RLS).
  Verificado: un write autenticado ahora setea `dirty=true`.
- **Orphan-sweep borra archivos IA/RRHH (CRÍTICO)**: `find_orphan_files` excluye
  archivos referenciados por `ai_document_extractions` y `employee_documents`.

Verificación: `typecheck` ✅ · `test` 743/743 ✅ · sin drift de tipos.

**Lote 2 (validaciones app-side) ✅ verificado:**
- **CUIT mod-11 (ALTO)**: helper `lib/validation/cuit.ts` (+ test) cableado en los
  schemas de clients y suppliers (`.refine(isValidCuit)`). Previene CUITs
  tipeados mal que rebotan en AFIP / Libro IVA Digital.
- **Hard-delete con ref-check vacío (ALTO)**: `deleteSupplierAction` /
  `deleteClientAction` ahora chequean TODAS las tablas dependientes (obtenidas de
  `information_schema`), incluidas las CASCADE que causaban pérdida silenciosa
  (opening balances, allocations, storage tariffs, attachments).
- **NC en positivo en Libro IVA en pantalla (MEDIO)**: `computeTotals` /
  `computeComprasTotals` ahora restan las notas de crédito (test agregado).

Verificación acumulada: `typecheck` ✅ · `test` **748/9** ✅ · sin drift de tipos.

**Lote 3 (movimiento de dinero — quirúrgico) ✅ verificado:**
- **Doble depósito/crédito de cheques (ALTO)**: `FOR UPDATE` agregado a
  `deposit_check`/`credit_check`/`reject_check` (migración `20260704210000`,
  re-emisión completa del cuerpo). Verificado contra DB local.
  ⚠️ La verificación local cazó que había re-emitido `endorse_check` (RPC
  dropeada a propósito en `20260514221121`) — corregido y confirmado sin drift.
- **Deriva de mayor al editar transacción (ALTO)**: trigger DB
  `guard_transaction_immutable_when_linked` (migración `20260704220000`) que
  bloquea cambios de monto/fecha/cuenta/tipo en movimientos generados por
  recibo/OP/transferencia/comprobante, + pre-check amigable en
  `updateTransactionAction`. Verificado: ligada bloqueada, descripción y libres OK.

**Lote 4 (movimiento de dinero — DB descartable, validado ejecutando flujos) ✅:**
- **Sobre-aplicación + contraparte (CRÍTICO)**: triggers `guard_receipt_allocation`
  / `guard_payment_order_allocation` (migración `20260704230000`) con `FOR UPDATE`
  sobre el comprobante. Verificado: válida OK, sobre-aplicación y cross-client
  bloqueadas.
- **Coreografía de anulación (ALTO)**: `20260704240000` — OP con cheque emitido
  cobrado/rechazado no se anula; recibo con cheque depositado no se anula y limpia
  los `en_cartera`. Verificado los 4 casos (bloqueos + permitidos).

Nota: se detectó que `receipts`/`payment_orders` usan `'canceled'` (una l) vs
`invoices` `'cancelled'` (dos l) — los triggers usan la ortografía correcta.

## T5 — Drift sistémico + tests 🟡 PARCIAL
- **Matriz de permisos "100% cobertura" ahora REAL (ALTO)**: snapshot inline
  exacto de `ROLE_PERMISSIONS` en `lib/auth/permissions.test.ts` — cualquier
  privilege creep (ej. `operations`+`accounting:write`) rompe el test. 750 tests.
- **Pendiente (mecánico, bajo riesgo, alto volumen)**: `select *` → columnas
  explícitas (16 sitios); limpieza monocromo (~40 archivos con clases de color);
  reconciliar CLAUDE.md (regla de imports cross-feature / `sin as` / `sin select *`
  son letra muerta hoy — decisión: documentar realidad vs enforcar); query keys a
  `lib/*-keys.ts`; `logAudit` en ~11 actions mutantes.

## T2 — lote 2 (lógica AFIP, sin llamadas reales) ✅ implementado
- **`NonRetriableError`**: los errores deterministas de AFIP (service/soap/config/
  input) ya no reintentan 5× — `issue-invoice.ts` los envuelve → fallan rápido.
- **Ventana CAEA meses de 31 días**: cron `caea-request` ahora corre días
  11,24-28 (cubre el pre-fetch para 28/30/31) — antes día 26 los perdía.
- **Validación server-side de `invoice_origin_id`**: NC/ND rechaza origen
  inexistente / no emitido / de otro cliente o canal / sin número.
Restan (requieren homologación AFIP para validar de verdad): recuperación de CAE
ante error de servicio + adopción con chequeo de importes; `origenes` en
caea-inform; concurrency key por POS.

## T6 — Tensiones de diseño 🟡 PARCIAL
- **Cierre/bloqueo de período contable ✅**: tabla `accounting_closed_periods` +
  guard `guard_journal_period_closed` en asientos (migración `20260704250000`) +
  actions close/reopen/list (owner/admin). Verificado: postear en período cerrado
  bloqueado, abierto permitido. (Falta UI — la lógica queda funcional por action.)
- **Pendiente (reescrituras multi-semana, decisión de producto)**: modelo
  append-only de dinero/documentos; saldos de tesorería materializados; refactor
  real de imports cross-feature (151). Varios síntomas ya mitigados con guards.

## T7 — Deuda de testing/DX 🟡 PARCIAL
- **Tests nuevos ✅**: unitarios (CUIT, NC Libro IVA, matriz de permisos exacta) +
  **suite de integración `tests/integration/money-guards.test.ts`** (over-application,
  cross-counterparty, cierre de período) — 4/4 verde con `RUN_INTEGRATION=1`.
- **`.env.local.example` ✅**: completado (FINANCE_EMAIL, fallback AI, CSP extras).
- Pendiente: más cobertura de integración; sync de docs/manual.

## T5 — restante (mecánico/cosmético, bajo valor)
No hecho: `select *` → columnas (16), limpieza monocromo (~40 archivos), refactor
de 151 imports cross-feature. Son barre-y-junta cosmético o decisiones de tu
CLAUDE.md — no toqué la governance-doc unilateralmente.

---
## Resumen de verificación
Cada migración aplicada y probada contra el Postgres local (DB descartable);
flujos de dinero verificados ejecutando inserts reales. `pnpm typecheck` ✅ y
`pnpm test` **750/9** ✅ tras cada lote; `database.types.ts` sin drift.
Todo en la rama `fix/audit-remediation`, sin commitear.
