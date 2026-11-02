# Decisiones

Registro fechado, la más nueva arriba. Cada entrada: qué se decidió, por qué,
y qué se descartó.

## 2026-11-02 — Auditoría (D13)

**Decisión.** Pantalla Admin › Auditoría (`/admin/audit`, `features/audit`,
migración `20261103030000_audit_log`) sobre `audit_events`, con `audit:read`
(owner y admin, el mismo techo que la policy de la tabla). Lista fecha, quién
(usuario; "Asistente IA (por X)" cuando `actor_type = 'ai-agent'`, con X el
usuario que lo pidió o aprobó; "Sistema"), acción (`event_type`), módulo (la
primera palabra del `event_type`), link al registro y un resumen del payload
(`before`/`after`, `from`/`to` o los primeros campos). Filtros por fechas,
usuario, módulo y acción; "Ver detalle" muestra el payload completo; exportar
CSV (hasta 10.000 filas, queda auditado como `audit.exported`). El detalle del
comprobante tiene su "Historial" con el componente compartido
`RecordHistory`. Tool `getAuditEvents` para el asistente con el mismo permiso.

**Enmascarado.** En el servidor, por nombre de clave y a cualquier
profundidad: CBU, CVU y CUIL quedan con los últimos 4 caracteres; token,
secret, password, key, cert, credentials y firmas se reemplazan enteros. El
navegador nunca recibe el valor.

**Retención.** 400 días: el cron diario `audit-retention` (03:41 AR) llama a
`purge_audit_events()`, que tiene el corte fijo adentro y solo borra
`audit_events`. Los documentos contables no se tocan.

**Cobertura.** `lib/actions/audit-coverage.test.ts` falla si un archivo
`"use server"` de `features/` escribe (insert/update/upsert/delete o un RPC de
escritura) y nunca llama a `logAudit`, salvo los exentos listados con su
motivo (preferencias propias, chat, notificaciones, caché de padrón). Se
cerraron los huecos de adjuntos (`file.attached` / `file.detached`, sobre el
registro adjuntado) y de saldos iniciales de clientes y proveedores.

**Descartado.** Triggers de auditoría genéricos en la base (duplican lo que ya
registra cada acción y no saben quién aprobó en nombre de la IA); un historial
por registro en todas las páginas de detalle en este PR (queda el componente).

## 2026-11-02 — Tareas (D11)

**Decisión.** Módulo `/tasks` (`features/tasks`, migración `20261103000000_tasks`):
tareas manuales, recurrentes (todos los meses el día N, recortado al último día
del mes) y automáticas desde documentos: compras con saldo que vencen en 7 días,
ventas vencidas con saldo, cuotas de préstamo, cheques propios emitidos que
vencen en 7 días y documentos de flota o de empleados que vencen en 30 días. Una
automática es única por `(source_table, source_id, kind)` y se cierra sola
cuando el documento se salda; el cron diario `tasks-daily` (06:17 AR) crea,
actualiza y cierra, materializa las recurrentes, asigna las nuevas automáticas a
quien puede actuar sobre el documento y avisa a los responsables el día del
vencimiento y una vez vencida. `tasks:read`/`tasks:write`: owner, admin,
finance, operations, warehouse.

**Por qué.** Lo pendiente vivía en la cabeza de cada uno; los documentos ya
saben qué vence.

**Reglas.** Una tarea que un usuario cerró no se reabre sola; un vencimiento que
un usuario movió le gana al del documento. Quien no lee el módulo de origen ve
"Tarea de un módulo sin acceso" y no puede editarla; la RLS además oculta la
fila a los roles fuera del techo de ese módulo. El aviso de vencida solo sale
en la semana posterior al vencimiento, para no inundar con lo viejo al
lanzar.

## 2026-11-02 — Gestión ≠ EERR; uso interno; sueldos por mes de liquidación

**Decisión.** El Resultado de gestión (`/management`, permiso
`management:read`: owner, admin y finance; **nunca** `fiscal_reader`) suma
los asientos fiscales y los documentos internos calculados al vuelo con
`journal_document_entry`, sin escribir asientos: el EERR, el Balance y el
Libro IVA siguen siendo los del contador. La pantalla dice "Uso interno" y no
exporta nada para terceros; la herramienta de IA (`getManagementPnL`) lo
repite en su descripción. Sueldos se muestra en dos líneas, "Sueldos" (canal
fiscal, del asiento) y "Sueldos internos (extras)" (canal interno), por **mes
de liquidación** (`accrual_month`), no por fecha de pago, para que un pago
atrasado no infle otro mes. Cada cuenta del plan va a una caja
(`management_buckets`, editable por owner/admin); una cuenta de resultado sin
caja aparece como "Sin clasificar" y suma en el margen operativo. Un ítem
vendido puede marcarse como venta de bien de uso (`invoice_items.revenue_kind`)
y sale del margen operativo. Moneda: todo en pesos con la cotización del
documento o la del día; un movimiento USD sin cotización no se suma (queda
aparte, en dólares).

**Por qué.** El dueño necesita saber si la operación deja plata con lo fiscal
y lo interno juntos, sin tocar la contabilidad que se presenta a terceros.

**Descartado.** Asentar lo interno en el libro (mezclaría las dos cajas) y
mostrar Gestión dentro del EERR (se confundiría con el fiscal).

## 2026-11-02 — Movimientos de caja en USD

**Decisión.** Un movimiento lleva la moneda de su cuenta (guard en la base) y
uno en USD se asienta en pesos a la cotización de su fecha
(`get_exchange_rate`); sin cotización no asienta y queda listado como
`sin_cotizacion` en `journal_missing_entries()`. Detalle en
`docs/accounting-patterns.md` §3.5.

**Descartado.** Guardar una cotización por movimiento: ningún escritor salvo
recibos y OP (que ya asientan con la suya) la conoce hoy.

## 2026-10-29 — Promoción manual a producción y CI como Plant

**Decisión.** Producción se actualiza solo con `promote-to-production.yml`
(workflow manual desde `main`, sin entorno de staging): CI verde en el SHA →
aprobación → migraciones → deploy de Vercel → sync de Inngest → smoke test →
tag `production-latest`. Vercel deja de publicar `main` (`vercel.json`). CI
suma el job `e2e` (Playwright) y pentests por rol contra PostgREST
(`tests/security`), con expectativas sacadas de `ROLE_PERMISSIONS`.

**Por qué.** Antes Vercel publicaba el código antes de que se aprobaran sus
migraciones, y nada probaba la app levantada ni la RLS por rol. Los grants de
tabla pasan a ser explícitos (`20261029120000_public_table_grants`): las
imágenes nuevas de Supabase no los dan por default y una base nueva no
cargaba ninguna página.

**Descartado.** Un entorno de staging como el de Plant (pedía otro proyecto
de Supabase y cambiar la rama de producción de Vercel).

## 2026-10-28 — Accesos por usuario: denegaciones en la app, techo en la DB

**Decisión.** Cada usuario tiene roles más una lista de permisos denegados
(`user_permission_denies`). `resolveAccess(roles, denied)` arma el `Access`
(tipo marcado, solo se construye ahí — cercado por ESLint) y todo gate usa
`userCan(ctx.access, …)`. Denegar `<recurso>:read` oculta el módulo entero
(sus pantallas, acciones, búsqueda, IA y adjuntos); datos de ese recurso que
otro módulo muestra con su propio permiso (p. ej. facturas en la cuenta del
cliente, saldos en tesorería) siguen visibles. Excepción: en `ai`, `ai:read`
y `ai:chat` se deniegan por separado. El
owner no se puede denegar. Solo `users:manage_access` (owner) edita
denegaciones; `users:assign_role` (owner y admin) edita roles. Roles y
denegaciones se guardan juntos con `set_user_access` (SECURITY DEFINER,
service_role), que rechaza editar los propios accesos (UA001), escrituras sobre
un estado viejo (UA002), roles fuera del alcance del actor (UA003) y dejar la
empresa sin owner (23514).

**Por qué.** El owner necesita ocultar módulos a una persona sin inventar un
rol por usuario. Aplicarlo en la app reutiliza los gates que ya existen en
actions, páginas, sidebar, herramientas de IA, jobs headless, búsqueda y
alertas.

**Descartado.** Overlays RESTRICTIVE de RLS por tabla: rompen los triggers en
cascada INVOKER, los embeds de PostgREST, las policies de storage y los RPC
DEFINER, y exigen verificar cada módulo. La DB sigue aplicando el techo del
rol; una denegación no se aplica a un acceso directo con el JWT del usuario.
Queda como follow-up.

**Ventana de deploy.** Vercel publica antes de que se apruebe la migración:
sin la tabla, `loadDenies` lee "sin denegaciones"; la búsqueda reintenta la
firma vieja de `search_global`; editar accesos responde "Actualización
pendiente". Esas tolerancias se quitan cuando la migración esté en producción.
Un rollback de Vercel a un build anterior ignora las denegaciones guardadas
(siguen en la tabla y vuelven a regir al volver a desplegar).

## 2026-10-28 — Tooling importado de las apps de referencia

**Decisión.** Se adoptan: guard de migraciones con squawk y header `SET LOCAL`
(Plant), gates de workflows y skills en CI, pgTAP en CI, re-propuesta
de migraciones no desplegadas (Plant), cercas de seams en ESLint, hooks de
git, `pnpm preflight`, y las skills de lentes (reach, outcomes, effects,
claims, data-integrity, deploy-safety, ui-state) adaptadas a JouveERP.

**Descartado.** Skills atadas a la infraestructura de la otra app (sync, integraciones contables,
evals propios) y las que suponen bots de review que Jouve no tiene.
