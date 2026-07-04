# Auditoría adversarial de JouveERP — Informe consolidado

Fecha: 2026-07-04 · Alcance: repo completo (features/, lib/, app/, 118 migraciones, docs/).
Método: 12 agentes de lectura profunda en paralelo (uno por subsistema) + batería mecánica
(jscpd, greps de convenciones) + verificación adversarial propia de los hallazgos críticos.
Cada agente leyó su área completa, no una muestra. Los reportes por área están en
`docs/audit/01-*.md` … `13-*.md`. Hallazgos marcados **CONFIRMADO** (traza citada) o
**PLAUSIBLE** (sospechado, no reproducido). Varios críticos fueron verificados por mí contra
el SQL/semántica real (marcados AUTO-VERIFICADO).

---

## 1. Mapa del sistema (para chequear mi entendimiento)

**Arquitectura real.** Next.js 16 App Router. El límite de seguridad NO es el `proxy.ts`
(solo refresca sesión y redirige anónimos) sino **cada server action / route handler**, que
llama `requireUserContext()` (re-lee `auth.getUser()` + `user_roles` por request, cacheado con
React `cache()` → revocación de rol efectiva al próximo request, sin staleness). La autorización
es **doble**: `userCan()` en la app + RLS en la DB. Contra lo que dice CLAUDE.md, ~62/70 actions
usan el cliente RLS (más seguro), solo 16 el service client.

**Contabilidad = "dos cajas".** Existen dos libros mayores paralelos que nunca se reconcilian:
(a) tesorería (`transactions`, saldos DERIVADOS en JS sumando todo el histórico), (b) el asiento
contable (`journal_entries`, generado por triggers, solo canales fiscales). Cada evento de ciclo
de vida (rechazo de cheque, anulación, edición) debe reconciliarse en ambos; varios caminos
arreglan solo uno.

**Emisión fiscal (AFIP).** `issueFiscalInvoiceAction` inserta un draft y dispara Inngest
`issue-invoice`, que reserva número (`FECompUltimoAutorizado+1`, memoizado en un step), lo
persiste ANTES de llamar a AFIP, pide CAE, y persiste. Recuperación de CAE solo ante error de
transporte. CAEA como contingencia (crons de solicitud e informe).

**Invariantes clave y DÓNDE se enforzan.**
- Débitos=créditos: constraint trigger diferido (sí se enforce en toda vía). Pero borrar un
  asiento entero pasa (0=0) → asientos borrables, no inmutables.
- Numeración única fiscal: índice único (no hay serialización local → carrera por POS).
- Doble facturación de storage / freight: **solo a nivel app** (no hay constraint DB).
- Máquinas de estado de shipments/trips/issued-checks: **solo en la UI** (el server acepta
  cualquier transición).
- `imp_total = neto+iva+trib`: **no se enforce en ningún lado** (ni ventas ni compras).
- Cierre/bloqueo de período contable: **no existe**.

---

## 2. Los 10 problemas más graves (accionar primero)

Estos concentran el riesgo fiscal, de corrupción de datos y de acceso. Detalle y escenario en
el reporte de área citado.

### Seguridad / control de acceso

1. **`create_journal_entry` (y todas las `emit_journal_*`) ejecutables por cualquier usuario
   autenticado vía PostgREST** — `09-db`, corroborado por `03-accounting` y `07-hr`.
   SECURITY DEFINER + `grant execute to authenticated` + sin chequeo de rol interno. Un rol
   `driver` puede `POST /rest/v1/rpc/create_journal_entry` con líneas balanceadas y forjar el
   libro mayor, o llamar `emit_journal_for_receipt` repetidamente (sin dedupe → asientos
   duplicados). **AUTO-VERIFICADO: exploit en vivo por el agente DB** (insertó fila + líneas,
   devolvió UUID). Arreglo: `revoke execute from anon, authenticated` en todos los emitters +
   guard `user_has_role` interno en `create_journal_entry`.

2. **Brecha de privilegios por defecto de Supabase** — `09-db`. `revoke all on function … from
   public` NO quita el EXECUTE que Supabase concede por default a `anon`/`authenticated`. Los RPC
   "solo service-role" (`next_internal_invoice_numero_atomic`, `bump_rate_limit_bucket`,
   `grant_vacation_balances`, `apply_vacation_delta`, `refresh_search_index`…) son en realidad
   invocables por cualquier autenticado → renumerar/forjar comprobantes internos, reescribir
   saldos de vacaciones de RRHH, resetear rate-limits de AFIP. Arreglo: `revoke … from anon,
   authenticated` explícito + check CI del ACL.

3. **Bucket `files` y `invoices-pdf` expuestos a todo autenticado** — `09-db`, corroborado por
   `07-hr` y `13-platform`. RLS de `files` es `USING(true)`; las policies de storage se apoyan en
   esa fila → cualquier autenticado descarga (y BORRA) escaneos de DNI/psicofísicos de empleados,
   PDFs de facturas, contratos de proveedores. `getSignedFileUrlAction`/`listAttachmentsAction`
   no chequean permiso. Arreglo: predicado de autorización por-entidad en `files`, achicar la
   policy de DELETE del storage.

4. **`search_index` (materialized view) legible por REST sin filtro de rol** — `13-platform`,
   corroborado por `09-db`. La MV vive en el schema `public` expuesto, ninguna migración revoca
   los grants default. El filtro de rol vive DENTRO de `search_global()`; `GET
   /rest/v1/search_index?select=*` lo saltea → CUIT/email/teléfono de clientes, números+CAE de
   comprobantes, montos de transacciones. Arreglo: `revoke select on public.search_index from
   anon, authenticated`.

5. **4 vistas de RRHH sin `security_invoker` → sueldos legibles por cualquier rol** —
   `07-hr`, corroborado por `09-db` (que halló 5 en total). `v_payroll_entries_with_payments`
   etc. corren con permisos del owner (bypass RLS); Supabase da SELECT a `authenticated`. Un
   `driver` lee `sueldo_neto`/`total_a_pagar` de todos. Arreglo: `alter view … set
   (security_invoker=on)` en las 5.

### Corrección / corrupción de datos

6. **Poison de numeración fiscal: una factura rechazada bloquea el POS para siempre** —
   `02-afip`, corroborado por `11-inngest`. `persist-numero` guarda `numero=N` ANTES de llamar a
   AFIP; si AFIP rechaza (fecha fuera de ventana, línea sin IVA, XML-injection en `doc_nro`),
   `onFailure` marca `failed` SIN limpiar `numero`. La próxima factura reserva N de nuevo →
   viola el índice único → el número reservado está memoizado en el step → reintenta 5× y muere,
   y toda factura siguiente del mismo (canal, POS, tipo, letra) falla hasta que alguien pone
   `numero=NULL` por SQL (no hay UI para hacerlo). Arreglo: limpiar `numero` en `onFailure`,
   re-reservar en 23505, índice único parcial excluyendo `failed`. **Gatillos reales**: default
   de fecha en UTC (03-afip/dates), líneas fiscales con `iva_rate_id=null` permitidas,
   `doc_nro` sin escapar XML.

7. **`get_account_balances`: los filtros de período y centro de costo son código muerto** —
   `03-accounting`. **AUTO-VERIFICADO contra el SQL** (`20260701120000:26-33`): los predicados
   `accrual_period`/`cost_center_id` están en el `ON` de un `LEFT JOIN` a `journal_entries`,
   pero las sumas agregan columnas de `journal_entry_lines` del primer join. Cuando el predicado
   falla solo anula columnas no usadas; la fila `jel` (débito/crédito) se mantiene. **Todo
   Balance/EERR renderizado muestra cifras de TODO el histórico** sin importar el selector de
   período, y el dropdown de centro de costo es inerte, mientras la UI dice "Mostrando
   movimientos del rango". Arreglo: unir `je` primero con los filtros dentro del join.

8. **Trigger de `purchase_invoice_items` falla en TODA escritura desde 2026-05-17** —
   `03-accounting`, corroborado por `02-afip`. **AUTO-VERIFICADO**: `purchase_invoice_items_
   regen_journal` es `for each statement` pero la función deref `new.purchase_invoice_id` /
   `old.…`, que están **sin asignar** en triggers statement-level → `record "new" is not
   assigned yet`. `replace_purchase_invoice_items` aborta en el primer DELETE → los ítems de
   línea de facturas de compra son inguardables (la acción devuelve "no se pudieron guardar los
   ítems"). Ninguna migración posterior lo corrige. Arreglo: trigger row-level, o mover el regen
   dentro del RPC tras actualizar el header.

9. **Saldos derivados rotos en el tope de 1000 filas de PostgREST** — `04-treasury`,
   corroborado por `13-platform` (exports) y `05-partners` (listas). `treasury-actions.ts:85` y
   `cash-flow-actions.ts:140` agregan TODAS las transacciones sin paginar; `config.toml` fija
   `max_rows=1000`. Con la transacción #1001 los saldos del dashboard de tesorería y el
   `cashToday` de la proyección son silenciosamente incorrectos. Lo mismo trunca los totales de
   los PDF de export (facturas, transacciones…). Arreglo: chunking o agregación en SQL.

10. **Sobre-aplicación de recibos/OP + regresión de aging de proveedores** — `04-treasury` y
    `05-partners` (hallado independientemente por ambos). (a) `create_receipt`/
    `create_payment_order` no verifican que la factura imputada pertenezca al cliente/proveedor
    ni que `aplicado ≤ total` → dos recibos concurrentes imputan la misma factura al 200% y,
    como el aging filtra `open_amount>0`, la factura sobre-aplicada DESAPARECE. (b) Migración
    `20260516120000` **eliminó la resta del saldo inicial** en `v_supplier_aging_documents` (la
    vista de clientes la conserva) → facturas saldadas con saldo inicial reaparecen como deuda
    abierta y se proyectan como pagos a realizar. Arreglo: lock de fila + verificación de
    contraparte en los RPC; re-agregar el join de opening al view de proveedores.

---

## 3. Otros hallazgos altos por área (resumen)

- **AFIP/CAEA** (`02-afip`): la contingencia CAEA falla 7 de 12 meses (cron día 26 pierde la
  ventana de meses de 31 días); NC/ND bajo CAEA se informan sin `CbtesAsoc` → rechazo diario
  eterno + observación 15014; `computeTotals(items, true)` calcula IVA a facturas INTERNAS
  (ingreso fantasma 21%); recuperación de CAE adopta comprobante de AFIP sin comparar importes.
- **Contabilidad** (`03-accounting`): errores P0002 (rol contable sin cuenta) se tragan como
  warning → facturas fiscales commitean sin asiento y nadie se entera; transacciones en USD
  postean valor nominal en el libro ARS; sin inmutabilidad de asientos posteados ni cierre de
  período; NC sumadas en positivo en los totales en pantalla del Libro IVA (el TXT sí lleva el
  signo → la pantalla difiere de lo que calcula AFIP).
- **Tesorería** (`04-treasury`): anular una OP con cheque propio ya cobrado borra la transacción
  bancaria → la caja "recupera" plata que salió; anular un recibo deja cheques fantasma
  gastables; cheque de tercero rebotado deja al cliente como pagado (sin nota de débito);
  `updateTransactionAction` edita montos sin trigger UPDATE de asiento → deriva del mayor;
  `deposit_check` sin `FOR UPDATE` → doble depósito en carrera.
- **Compras/socios** (`05-partners`): el chequeo de referencias que habilita el hard-delete de
  proveedor/cliente es un **array vacío con las tablas comentadas** → la UI dice "se puede
  eliminar definitivamente" para un proveedor con cientos de facturas, con pérdida de datos en
  cascadas; sin validación mod-11 de CUIT en ningún lado; tres parsers de montos distintos (dots
  como miles → ×100); asiento de compra no se re-emite al editar montos (mayor vs cta cte vs
  libro divergen para siempre).
- **Logística** (`06-logistics`): `pickTariff` aplica una sola tarifa a todo el período →
  sobre/subfacturación cuando un aumento cae a mitad de mes; sin constraint de exclusión en
  `storage_billing_runs` → doble facturación fiscal por doble-click; pallets sin tarifa facturan
  $0 y quedan permanentemente no facturables; totales de rentabilidad excluyen viajes sin
  vehículo y cuentan viajes cancelados.
- **RRHH** (`07-hr`): refund de vacaciones roto a través de la expiración (empleado cargado 20
  días por una licencia de 10); sin grant-on-hire → consumo silencioso; `finance` puede reabrir
  períodos de nómina cerrados por PostgREST; documento vencido ayer desaparece de la página de
  vencimientos.
- **IA** (`08-ai`): `ai_insights` visible a `operations`, que ve tarjetas con saldo de caja,
  clientes con mora 90+ y montos de proveedores que no puede ver en ningún otro lado; el mensaje
  entrante del chat no pasa `validateUIMessages` → inyección de resultados de tool/mensajes de
  system falsos; race de doble-confirm en Document Intelligence → doble posteo de gasto.
- **Plataforma** (`13-platform`): el barrido de huérfanos **borra los archivos de extracciones
  IA y adjuntos de RRHH** (cascade borra la fila de extracción) porque define "huérfano" como
  "sin `file_attachments`"; el flag `dirty` del índice de búsqueda nunca se setea (trigger sin
  security definer + RLS sin policy) → clientes nuevos no aparecen en ⌘K; exports suman NC en
  positivo, mezclan monedas e incluyen anulados.
- **Rutas** (`12-routes`): `bootstrapOwnerIfNeeded` corre para CUALQUIER autenticado antes del
  check `users:read` → si `owners` llega a cero, un `driver` que abre `/admin/users` se
  auto-promueve a owner; `?ask=` auto-ejecuta un prompt arbitrario contra la sesión IA de la
  víctima (prompt-injection reflejado).
- **Inngest** (`11-inngest`): la taxonomía de errores AFIP (TRANSPORT vs SERVICE) que debía
  guiar los reintentos nunca se conectó a Inngest (`NonRetriableError` cero usos) → un rechazo
  determinista se reintenta 5× por horas; los fallos de jobs degradan a `logger.warn` y nunca
  notifican al dueño del deadline.
- **Core** (`01-core`): `formatArgentineDate` aplica −3h a strings de solo-fecha → **toda
  columna `date` se muestra un día antes** (la factura de hoy dice "ayer"), y el test asevera el
  bug; open-redirect en login (`redirectTo` acepta `//evil.com`); admin puede auto-promoverse a
  owner por RLS de `user_roles`.

---

## 4. Tensiones de diseño (dónde el problema es el enfoque, no la línea)

1. **RBAC en TypeScript, espejado a mano en SQL.** `userCan`, los arrays de rol en 600+ líneas
   de RLS, el mapa de `search_global` y las listas de fan-out de los crons son copias manuales
   de `permissions.ts`. Ya divergieron en varios puntos (search map, admin→owner, `files:read`,
   insights a operations). Nada testea que el espejo coincida. **Alternativa:** generar el SQL de
   roles desde la matriz TS, o un test que compare ambos.

2. **RLS-bypass por service-role + RPC DEFINER concedidos a `authenticated` = doble superficie.**
   El modelo declarado es "las actions usan service-role; RLS es defensa en profundidad para el
   surface anónimo". Pero como los RPC contables/HR se conceden a `authenticated`, PostgREST
   puede invocar ESCRITURAS privilegiadas directo, no solo leer. La defensa en profundidad queda
   socavada. **Alternativa:** o los RPC son service-role puro (las actions los llaman vía service
   client) o cada RPC se auto-protege con `user_has_role` — hoy es inconsistente (los RPC de
   saldo inicial sí guardan; los de journal no).

3. **Documentos mutables + RPC de borrar/reinsertar vs coreografía de triggers.** Recibos/OP/
   facturas son editables y anulables; cada edición reescribe hijos en bloque; la corrección
   depende de un conjunto siempre creciente de triggers compensatorios, y varias fugas viven
   justo ahí (cheques fantasma, doble endoso, deriva de mayor). **Alternativa:** modelo
   append-only donde anular = documento de reversa.

4. **Tres relojes contables.** Diario y balances cortan por `accrual_period`; libro mayor por
   `entry_date`; libro IVA por `fecha` del comprobante. Un cierre de marzo nunca se puede
   cruzar entre los tres reportes. Está documentado (§5) pero sin resolver.

5. **Auditoría best-effort.** Para un ERP que emite documentos fiscales, tanto `logAudit` como
   `email_send_log` pueden fallar en silencio mientras la mutación de negocio commitea; además
   ~11 actions mutantes no llaman `logAudit` (chart-of-accounts, files, opening balances,
   descarga de backups). El trail de auditoría no es grado-evidencia.

---

## 5. Gaps de expectativa ("esperaba X, encontré Y")

- Esperaba que la regla "no importar de otra feature" se respetara → **151 imports
  cross-feature** (la regla es letra muerta).
- Esperaba "sin `select *`" → 16 violaciones; "sin `as`" → 276 archivos con `as`, 46 con
  `as unknown as`.
- Esperaba "100% monocromo" → ~40+ archivos con clases de color (badges de peligro rojo/ámbar/
  esmeralda) en 6+ páginas de ruta y en HR/logística/contabilidad.
- Esperaba cobertura "100%" de la matriz de permisos → invariantes estructurales + ~10
  spot-checks; 4 de 6 filas de rol sin pinear (un grant errado a `finance`/`operations` pasa el
  test).
- Esperaba que las actions usaran `getServiceClient()` (CLAUDE.md) → 62/70 usan el cliente RLS
  (más seguro, pero el doc entrena hacia el cliente que bypassa RLS).
- Esperaba `logAudit()` desde `lib/actions/audit.ts` en todas las mutaciones → copia local
  divergente en `users-actions.ts` + ~11 actions sin auditoría.
- Esperaba que "Backups" respaldara todo → solo la DB (`pg_dump`); los buckets `files`,
  `avatars` y PDFs NO se respaldan → tras un incidente, las filas restauradas apuntarían a blobs
  perdidos.
- Esperaba que la anulación de facturas internas fuera alcanzable → tiene soporte DB pero **no
  hay action ni UI**.
- El `.env.local.example` lista 4 vars; el código lee ~20 (AFIP, OpenAI, Google, Resend, VAPID,
  Sentry…). Un recién llegado no puede levantar IA/email/push desde el README.

---

## 6. Preguntas abiertas (requieren decisión del mantenedor)

1. **¿PostgREST/`/rpc/*` es alcanzable desde clientes en producción?** La anon key la publica la
   app Next. Si sí, los hallazgos 1–4 de la §2 son explotables ya; si el gateway restringe JWTs
   no-service, bajan a defensa en profundidad. Es la pregunta que más mueve severidades.
2. **¿`max_rows=1000` es también el valor de producción (hosted)?** `config.toml` gobierna local;
   si prod lo subió, el hallazgo 9 es bomba de tiempo en vez de bug activo.
3. **¿El shift de −3h en fechas de solo-fecha es decisión consciente o bug consagrado?** Los
   usuarios deben estar viendo la fecha de ayer en las facturas de hoy.
4. **¿`operations` debe ver tarjetas de insights de tesorería/AP/AR?** Si sí, contradice su
   exclusión en el resto; si no, es bug directo.
5. **¿Hay filas en `supplier_opening_balance_allocations` en producción?** Si sí, la regresión de
   aging (hallazgo 10b) es corrupción viva hoy; si nunca se usó, es latente.
6. **¿Se usan comprobantes/recibos en USD?** Varios hallazgos de moneda son latentes hasta el
   primer documento USD contra cuenta ARS.
7. **¿El `pg_dump` en Supabase hosted realmente captura los schemas `auth`/`storage`
   (usuarios)?** El ping de éxito solo prueba un dump no-vacío.

---

## Índice de reportes por área

| # | Área | Archivo | Criticals |
|---|---|---|---|
| 01 | Core infra (auth, RLS gates, format, rate-limit) | `01-core.md` | date-shift, open-redirect, admin→owner |
| 02 | AFIP / facturación | `02-afip.md` | poison de numeración |
| 03 | Contabilidad | `03-accounting.md` | balances-filtro-muerto, trigger items roto |
| 04 | Tesorería / movimientos de dinero | `04-treasury.md` | 1000-row balances, sobre-aplicación, aging |
| 05 | Compras / clientes / proveedores | `05-partners.md` | hard-delete, aging, subledger drift |
| 06 | Logística / storage billing | `06-logistics.md` | tarifa mid-período |
| 07 | RRHH / nómina | `07-hr.md` | vistas sin invoker (sueldos), grant RPC |
| 08 | IA / chat | `08-ai.md` | (altos: insights leak, msg injection) |
| 09 | Migraciones / RLS | `09-db.md` | create_journal_entry, files bucket, default-privs |
| 10 | Docs vs código / DX | `10-docs-dx.md` | (drift, no criticals) |
| 11 | Inngest (jobs) | `11-inngest.md` | (altos: CAE recovery, retry taxonomy) |
| 12 | Rutas dashboard | `12-routes.md` | bootstrap owner, ?ask= injection |
| 13 | Plataforma (export/search/files/notif/admin/backups) | `13-platform.md` | orphan-sweep borra archivos IA/RRHH |

**Corroboración cruzada** (hallazgos vistos independientemente por ≥2 agentes → alta confianza):
create_journal_entry sin guard (DB+contab+RRHH) · vistas sin security_invoker (DB+RRHH) · bucket
files expuesto (DB+RRHH+plataforma) · regresión aging proveedores `20260516120000`
(tesorería+partners) · trigger items roto (contab+afip) · search_index MV expuesta
(DB+plataforma) · tope 1000 filas (tesorería+plataforma+partners) · bootstrap owner
(rutas+core+plataforma) · numeración poison (afip+inngest).
