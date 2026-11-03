# HR / RRHH — Patrones de arquitectura (Fase N)

> Spec del subsistema de **Personal / Sueldos** (Fase N del roadmap). Documenta
> el modelo de datos, los server actions, los RPCs/triggers, los crons Inngest,
> las reglas de negocio y los patrones de UI de RRHH. Generado de una auditoría
> del código (migraciones `…20260517100000`–`…20260518100000`, `features/hr/`,
> `features/employee-documents/`, crons en `lib/inngest/functions/`).
>
> Cubre 5 sub-dominios: **empleados**, **sueldos (payroll)**, **asistencia**,
> **vacaciones/licencias**, **documentos de empleado**. Ver también
> `docs/roadmap.md` §3.5.

---

## 0. Alcance y filosofía

JouveERP **no liquida sueldos** en sentido estricto. La liquidación detallada
(CCT, antigüedad, aportes, contribuciones, recibo firmado) la hace un
**liquidador externo**; el recibo firmado llega de él. JouveERP modela lo que
el dueño necesita ver y pagar:

- **Quién es el personal** (`employees`) — identidad, datos de pago, flags.
- **Cuánto se paga cada mes** (`payroll_*`) — una planilla mensual editable a
  mano, con extras de texto libre y pagos en cuotas.
- **Quién faltó / llegó tarde** (`attendance_records`) — solo excepciones.
- **Vacaciones y licencias** (`employee_leaves`, `employee_vacation_balances`)
  — saldos LCT con devengado anual y consumo FIFO.
- **Papeles que vencen** (`employee_documents`) — carnets, libretas, cursos,
  aptitudes, con alerta automática de vencimiento.

El monotributista que factura (chofer contratado, etc.) tiene `is_monotributo =
true` en `employees`, pero **su factura vive en `purchase_invoices`** (con su
propio `supplier_id`), no acá.

---

## 1. Modelo de permisos (RBAC)

Tres claves en `lib/auth/permissions.ts`, sección `// Personal / Sueldos (Phase N)`:

| Permiso | Significado | Roles |
|---|---|---|
| `hr:read` | Ver empleados, planillas, asistencia, vacaciones, documentos | owner, admin, **finance** |
| `hr:write` | Alta/edición de todo lo anterior | owner, admin, **finance** |
| `hr:admin` | Reabrir período de sueldos cerrado, otorgar/ajustar saldos de vacaciones | **owner, admin** |

`owner` y `admin` tienen el set completo (`ROLE_PERMISSIONS.owner =
ROLE_PERMISSIONS.admin = PERMISSIONS`); difieren solo en el alcance de
asignación de roles (`canAssignRole`), no en permisos. `finance` tiene
`hr:read` + `hr:write` pero **no** `hr:admin`. `operations`, `warehouse` y
`driver` no tienen ningún permiso `hr:*`. La matriz está aserida al 100% en
`lib/auth/permissions.test.ts`.

Patrón estándar del repo: el server action gatea con
`userCan(ctx.access, "hr:<x>")`, y **RLS es defensa en profundidad** en cada
tabla vía el helper `public.user_has_role(text[])`.

> ✅ **Permisos de documentos alineados a `finance` (resuelto 2026-06-16).** Antes
> **`employee_documents`** (RLS + el cron `document-expiry-alerts`) usaba
> **`['owner','admin','operations']`**, mientras que la matriz `hr:read`/`hr:write`
> es **`owner/admin/finance`** — así `operations` pasaba RLS pero fallaba
> `userCan` (lo redirigía) y `finance` al revés. Decisión del dueño: los
> documentos los administra **`finance`**, consistente con el resto de RRHH. RLS y
> destinatarios del cron migrados a `['owner','admin','finance']` (mig
> `…20260616120000_employee_documents_finance_rls`).

---

## 2. Empleados — `employees`

Tabla maestra única de todo el personal. Migración `…517100000_employees`.

**Columnas clave:**

- `id uuid PK`, `legal_name text NOT NULL` (apellido y nombre), `position text`.
- **Datos formales** (del recibo del liquidador, todos nullable, mig
  `…20261103050000`): `convenio`, `categoria`, `obra_social`, `art` (texto ≤ 120)
  y `retribucion_formal numeric(15,2) >= 0` (bruto, solo informativo). Se editan
  en la sección "Datos formales" del form (`hr:write`).
- `cuil text` — CHECK `cuil ~ '^[0-9]{11}$'` (11 dígitos) o NULL.
- `cbu text` — CHECK `cbu ~ '^[0-9]{22}$'` (22 dígitos) o NULL.
- `pay_frequency text NOT NULL` — CHECK ∈ `('semanal','mensual','mixto')`.
- `base_salary numeric(15,2)` **nullable**: el sueldo pactado. Un chofer
  mensual (`pay_frequency='mensual'`) lleva su sueldo acá; NULL solo para quien
  cobra semanal.
- `viatico_monthly numeric(15,2) NOT NULL default 20000`.
- `is_monotributo boolean NOT NULL default false`.
- `hire_date date NOT NULL`, `termination_date date`, `notes text`,
  `is_active boolean NOT NULL default true`.
- `created_by`, `created_at`, `updated_at` (trigger `set_updated_at()`).

**CHECKs / invariantes:**
- `employees_termination_after_hire`: `termination_date IS NULL OR
  termination_date >= hire_date`.
- `employees_inactive_when_terminated`: `termination_date IS NULL OR is_active =
  false` (un terminado no puede estar activo).
- **Soft-delete** = terminación (`termination_date` + `is_active=false`);
  reactivación = `termination_date=null` + `is_active=true`. **No hay policy de
  DELETE** — el hard-delete es solo vía service role.

**RLS:** SELECT/INSERT/UPDATE para `user_has_role(['owner','admin','finance'])`.

**Server actions** (`features/hr/actions/employees-actions.ts`):

| Action | Tipo | Perm | Nota |
|---|---|---|---|
| `listEmployeesAction` | read | `hr:read` | Todos, orden `legal_name`. Sin paginar. |
| `searchEmployeesAction` | read | `hr:read` | RPC `search_employees` (pg_trgm), cursor por offset; `limit+1` para `hasMore`. |
| `getEmployeeByIdAction` | read | `hr:read` | `maybeSingle`. |
| `createEmployeeAction` | write | `hr:write` | `created_by=ctx.userId`. Audit `employee.created`. |
| `updateEmployeeAction` | write | `hr:write` | Patch parcial; **audit granular**: si cambia `base_salary` → `employee.salary_changed` (from/to), si no `employee.updated`. |
| `terminateEmployeeAction` | write | `hr:write` | Audit `employee.terminated`. |
| `reactivateEmployeeAction` | write | `hr:write` | Audit `employee.reactivated`. |

**RPC `search_employees(p_query, p_only_active, p_offset, p_limit)`** —
`SECURITY INVOKER` (honra RLS). Match por `legal_name` (ILIKE + similitud
trigram) y prefijo de `cuil`; ordena por similitud desc. `limit` clamp 1..200.

**Reglas:**
- `base_salary` NULL = chofer pago semanal (solo viático + extras en la planilla
  mensual; "sueldos cargados a mano").
- Validación Zod preprocesa CUIL/CBU client-side (saca no-dígitos, vacío → null);
  CUIL exactamente 11, CBU exactamente 22 (matchea los CHECK de DB).
- `updateEmployeeAction` arma un patch mínimo de campos definidos y devuelve `ok`
  sin escribir si el patch queda vacío.

**UI:** `/employees` (tabla con search + "Solo activos", scroll infinito vía
`useIntersectionObserver`, filtros sincronizados a URL con `useUrlFilter`),
`/employees/[id]` (detalle con cards de vacaciones y documentos). CRUD en
`Dialog` centrado; submit deshabilitado si no hay cambios en modo edit.
Hooks en `features/hr/hooks/use-employees.ts`; query keys en
`features/hr/lib/employees-keys.ts` (`EMPLOYEES_PAGE_SIZE=50`).

---

## 3. Sueldos (payroll)

Planilla mensual editable. Migraciones `…517110000_payroll_periods` (períodos +
entries + extras + views) y `…517120000_payroll_payments` (pagos + sync de
transacción).

### 3.1 Tablas

- **`payroll_periods`** — un período por `(year, month, kind)`.
  `kind ∈ ('monthly','sac')` (mig `…20261103050100`): el SAC (aguinaldo) es su
  propio período, en el mes en que vence (6 = 1.er semestre, 12 = 2.º), así sus
  pagos devengan ahí y los agregados (resultado de gestión, IA) lo cuentan en
  junio/diciembre. `status ∈ ('draft','closed')`, `closed_at`, `closed_by`.
- **`payroll_entries`** — una fila por `(period_id, employee_id)`
  (`UNIQUE`). Campos de plata: `sueldo_neto` (el pactado), `vacaciones_monto`,
  `viaticos`, `deudas`, `telefono`, `embargo` (todos `numeric(15,2) >= 0`) y
  `recibo_neto` (nullable: el neto del recibo del liquidador; NULL = sin recibo,
  la planilla se comporta como antes). FK a `employees` con `ON DELETE RESTRICT`.
- **`employee_garnishments`** — embargos: `mode ∈ ('percentage','fixed')` con
  `percentage` (del neto del recibo, o del pactado sin recibo) o `amount`,
  `active_from`/`active_to`, `beneficiary`, `court_note`. Mientras uno está
  vigente en el mes del período, el trigger `payroll_entries_apply_garnishment`
  fija `embargo` al insertar el entry o al cambiar `sueldo_neto`/`recibo_neto`;
  escribir o borrar un embargo recalcula los entries de los períodos en
  **borrador** (los cerrados no cambian). Tipear `embargo` a mano marca
  `embargo_override`: ese período queda fuera de los recálculos hasta volver
  al embargo vigente (`resetPayrollOverrideAction`, `20261104095100`). RLS
  owner/admin/finance. El embargo es un descuento de planilla, no un pago: no
  tiene asiento propio.
- **`payroll_entry_extras`** — líneas de texto libre por entry (`amount > 0`,
  `description` 1..200, `sort_order`). Ej: "20% Fijo Tareas Gabriel".
- **`payroll_payments`** — tramos de pago contra un entry: `account_id`,
  `channel_id`, `amount`, `method` (enum `payroll_payment_method ∈
  ('transferencia','efectivo')`), `paid_at`, `transaction_id` (FK a
  `transactions`, mantenido por trigger).
- **Views:**
  - `v_payroll_entries_resolved`: agrega `extras_total = Σ extras.amount` y
    `total_a_pagar = sueldo_neto + extras_total + vacaciones_monto + viaticos −
    deudas − telefono − embargo`.
  - `v_payroll_entries_with_payments`: + `paid_total = Σ payments.amount`,
    `saldo = total_a_pagar − paid_total`, `payments_count`, y lo pagado por
    método (`paid_transferencia`, `paid_efectivo`). Es la fuente del grid.

**Recibo y reparto (decisión D5).** El liquidador emite el recibo formal; la
planilla "en mano" suma neto, extras, viáticos y descuentos.
`features/hr/lib/payroll-split.ts`: **Otros** = pactado − recibo; reparto
sugerido **transferencia** = recibo − embargo − deudas − teléfono (entre 0 y el
total) y **efectivo** = el resto del total. El pago masivo sugiere, por empleado,
lo que falta de la parte del método elegido (sin recibo, el saldo).

**SAC.** `seed_sac_period(year, half)` crea el período `kind='sac'` (idempotente)
y `fill_payroll_period` le pone a cada empleado activo (ingresado antes del fin
del semestre) `payroll_sac_suggestion`: 50% de la mejor remuneración mensual del
semestre (`sueldo_neto + extras_total` de los períodos mensuales), proporcional a
los días trabajados en él; sin viático. Editable. Ruta `/hr/payroll/sac/[year]/[half]`.

**Liquidación final.** En la ficha de un empleado dado de baja,
`getFinalSettlementAction` sugiere sueldo por días trabajados del último mes
(sueldo/30 × día de baja, tope 30), vacaciones no gozadas (saldos activos +
proporcional del año si todavía no se otorgó, × sueldo/25, LCT art. 155/156) y
SAC proporcional; `applyFinalSettlementAction` lo carga en la planilla mensual
del mes de baja (la crea si falta): `sueldo_neto`, `vacaciones_monto` y un extra
"Liquidación final: SAC proporcional …" (volver a cargar reemplaza).

RLS de las 4 tablas: SELECT/INSERT/UPDATE/DELETE para
`user_has_role(['owner','admin','finance'])`.

### 3.2 Lifecycle e inmutabilidad

- `status: draft → closed` (`closePayrollPeriodAction`). Reabrir `closed →
  draft` (`reopenPayrollPeriodAction`) **requiere `hr:admin`** — RLS dejaría a
  finance, pero el gate del action lo bloquea.
- Trigger `enforce_payroll_period_immutability()`: al estar el período `closed`,
  bloquea (SQLSTATE 23514) cualquier INSERT/UPDATE/DELETE de `payroll_entries` y
  `payroll_entry_extras`. En `payroll_periods` solo bloquea cambios de
  `year/month` y **permite** la transición `closed → draft`.
- **Los pagos sí se permiten sobre un período cerrado** — `payroll_payments`
  **no** tiene trigger de inmutabilidad. La intención: cerrar los valores de la
  planilla y después pagar en cuotas. `canManagePayments = hr:write && period`
  (sin importar el estado).

### 3.3 Sync de transacción (1-a-1)

`payroll_payment_sync_transaction()` (`SECURITY DEFINER`):
- **BEFORE INSERT**: crea una fila en `public.transactions`
  (`kind='expense'`, `currency='ARS'`, `account_id`/`channel_id` del pago,
  `transaction_date=paid_at`, `accrual_month = make_date(period.year,
  period.month, 1)`, `description='Sueldo <legal_name> (MM/YYYY)[ — notes]'`) y
  setea `new.transaction_id`. La transacción lleva `is_payroll=true`, así que su
  asiento debita `sueldos` (5.3.1 "Sueldos y jornales"), no `gastos`.
- **AFTER UPDATE**: propaga `account_id/channel_id/amount/transaction_date` a la
  transacción ligada.
- **BEFORE DELETE**: borra la transacción ligada.

### 3.4 Server actions

`payroll-actions.ts`: `listPayrollPeriodsAction`, `getPayrollPeriodAction(year,
month)`, `seedPayrollPeriodAction` (RPC, idempotente, `hr:write`),
`closePayrollPeriodAction` (`hr:write`), `reopenPayrollPeriodAction`
(**`hr:admin`**), `updatePayrollEntryAction` (`hr:write`, patch parcial), y el
CRUD de extras (`add/update/remove…ExtraAction`, `hr:write`).

`payroll-payments-actions.ts`: `listPayrollPaymentsAction` (`hr:read`),
`createPayrollPaymentAction`, `updatePayrollPaymentAction`,
`deletePayrollPaymentAction` (`hr:write`), y `bulkCreatePayrollPaymentsAction`
(`hr:write`): `items` = `{entry_id, amount}` (un monto por empleado), una cuenta
en pesos y un método → N `payroll_payments` en un solo `.insert(rows)` → N
transacciones; **atómico** (si una falla, rollback de todo el lote). Schema
`1..100` items; el control de sobrepago aplica a cada uno (`allow_overpay`).

**RPC `seed_payroll_period(p_year, p_month)`** — `SECURITY INVOKER`, re-chequea
`user_has_role(['owner','admin','finance'])` (defensa en profundidad).
Idempotente: si el período existe devuelve su id; si no, lo crea y siembra un
draft entry por cada empleado **activo**. Defaults del entry: `sueldo_neto =
coalesce(base_salary,0)` solo si `pay_frequency ∈ ('mensual','mixto')` (si no 0);
`viaticos = coalesce(viatico_monthly,0)`; resto 0.

### 3.5 UI

`/hr/payroll` (lista de períodos + `NewPayrollPeriodDialog`), `/hr/payroll/
[year]/[month]` (grid editable). `payroll-period-grid.tsx`: columnas Empleado /
Sueldo / Extras / Vacaciones / Viáticos / Deudas / Teléfono / Total / Pagado /
Saldo + totales de footer (sumados client-side); edición inline con
`InlineMoneyInput` (commit en blur/Enter, revert en Escape/inválido); botones
Close/Reopen; `BulkPayrollPaymentDialog`. `payroll-payments-dialog.tsx` muestra
el saldo coloreado (verde 0, ámbar >0, rosa <0). Bodies de diálogo montados solo
al abrir (lazy). Hooks en `use-payroll.ts` / `use-payroll-payments.ts`; keys en
`payroll-keys.ts` (`payrollKeys.period(year,month)` es la clave de invalidación
central).

Deudas muestra un botón para volver a la cuota de los planes cuando se cargó a
mano (§3.6); "Extras de viajes" (solo período mensual en borrador) abre la
sugerencia de §3.8.

### 3.6 Cuenta corriente del empleado (decisión D1)

Mig `…20261103060000` (rol COA `anticipos_personal`, solo, porque un valor de
enum nuevo no se usa en la transacción que lo agrega) y `…20261103060100`.
Adelantos, compras a cargo del empleado y deudas **no son costo**: son un
crédito contra el empleado ("Anticipos al personal", 1.1.4.x, activo) que se
devuelve con descuentos de planilla o pagos.

- **`employee_account_movements`** — la cuenta. Debe: `advance` (adelanto de
  caja), `charge` (compra a su cargo o deuda cargada a mano). Haber:
  `payroll_discount` (planilla cerrada), `payment` (pago del empleado, en caja o
  a mano), `forgiveness` (condonación de un plan). ARS/USD, importe positivo,
  `creditor ∈ ('empresa','socio')`. Cada movimiento es de su origen: el
  adelanto o pago en caja de su movimiento de tesorería
  (`record_employee_account_cash`), el cargo de compra de la compra, el
  descuento de la planilla cerrada, la condonación del plan;
  `guard_employee_account_movement` rechaza escribirlos desde otro lado (solo
  la descripción se edita). Los manuales (`charge`/`payment` sin origen) se
  cargan y borran a mano.
- **`employee_debt_plans`** — cómo se devuelve: total, cuota, moneda, mes de
  inicio, `status ∈ ('activo','pausado','cancelado','condonado')`, acreedor
  (empresa o socio + nombre). `v_employee_debt_plans` suma lo pagado
  (descuentos, pagos y condonación del plan) y lo que resta. Condonar escribe
  la condonación de lo que resta y no se deshace; un plan con movimientos no se
  borra (se cancela) ni cambia de empleado o moneda; el total no baja de lo
  pagado.
- **Saldo**: `v_employee_account_balances` por empleado y moneda (positivo = el
  empleado debe; `balance_socio` = la parte de socios).
- **Planilla**: `payroll_entries.deudas` = Σ cuota de los planes **activos en
  ARS** del empleado iniciados al mes del período, topeada a lo que resta
  (`payroll_plan_installments`), al insertar el entry y cada vez que cambia un
  plan o un movimiento de un plan (solo períodos mensuales en borrador). Editar
  Deudas a mano marca `deudas_override` y mantiene el importe; volver a `false`
  (`resetPayrollOverrideAction`) recalcula. **Cerrar** el período escribe sus
  deudas como `payroll_discount` (a cada plan activo en ARS hasta su cuota, o
  hasta lo que resta si se editó a mano; el resto sin plan); **reabrir** los
  borra. Los períodos cerrados antes de la migración
  (`payroll_periods.posts_employee_accounts = false`) no escriben nada aunque
  se reabran y cierren. El asiento fiscal no registra el descuento: el asiento
  de sueldos del liquidador cancela el anticipo.
- **Compras "a cargo de empleado"** (`purchase_invoices.charged_employee_id`,
  factura o ND en ARS/USD): sigue en el Libro IVA con su IVA crédito; el neto se
  asienta en `anticipos_personal` en vez de la cuenta de gasto (fuera del costo
  de Gestión) y es un `charge` en la cuenta del empleado, en su moneda: en canal
  fiscal el neto (el IVA y las percepciones son crédito de la empresa), en
  canal interno el total (`20261104095200`).
  Anular la compra o sacar el empleado borra el cargo. Setearlo pide `hr:write`
  además de `purchase_invoices:write`.
- **Tesorería**: "Adelanto a empleado" (Tesorería, Caja y la ficha) y "Pago en
  caja" (ficha) llaman `record_employee_account_cash`: el movimiento de caja
  (egreso / ingreso) y el de la cuenta en una transacción; el asiento va contra
  `anticipos_personal`. Con cuota, el adelanto abre su plan (total = adelanto,
  desde su mes); un pago puede imputarse a un plan. Pide `hr:write` +
  `transactions:write`. `delete_employee_account_movement` borra un manual, o un
  adelanto (con el plan que abrió, salvo que ya tenga descuentos o pagos) o
  pago en caja junto con su movimiento de caja. El movimiento de caja es "de un
  documento" (`v_transactions_tagged.source_document = 'employee_account'`): no
  se edita ni borra suelto.
- **Gestión** (`get_management_pnl`): en devengado, el descuento de planilla y
  la condonación de una deuda con la empresa son sueldos internos de su mes (el
  adelanto es activo, no costo); en percibido (desde `20261103070000`), el
  adelanto, el pago del empleado y el pago (con OP) de una compra a su cargo
  van a "Anticipos al personal", debajo del margen operativo, y el descuento
  de planilla o la condonación pasan ese importe a sueldos internos del mes
  (la generación de caja no cambia).

UI: `EmployeeAccountCard` en la ficha (saldos, planes con su estado, movimientos
con su origen); `EmployeeCashDialog`; `EmployeeChargeSelect` en el form de
compra. IA: `getEmployeeAccountBalances`, `getEmployeeAccount`.

### 3.7 Aumentos en % (mig `…20261103060200`)

`employee_salary_changes` guarda cada cambio de `employees.base_salary`
(trigger `employees_log_salary_change`): anterior, nuevo, mes desde el que rige
(una edición a mano rige desde el mes en curso) y, si vino de un aumento, % y
motivo. Solo lectura para la app (RLS select; sin grants de escritura).
`employee_salary_for_month` da el sueldo pactado de un mes (el anterior del
primer cambio posterior, o el actual) y `fill_payroll_period` lo usa al sembrar
un mes. `apply_salary_raise(ids, %, mes, motivo)` sube el sueldo de los activos
con sueldo y el `sueldo_neto` de sus entries en planillas mensuales en borrador
desde ese mes que tenían el sueldo anterior (uno editado a mano se respeta).
UI: "Aumento" en la lista de empleados (todos, por puesto o por convenio, con
vista previa) y "Historial de sueldo" en la ficha. IA: `getSalaryHistory`.

### 3.8 Extras desde viajes (mig `…20261103060300`)

`employees.trip_rate_per_day/_per_km/_per_unload` (NULL = sin sugerencia). La
planilla mensual sugiere, por empleado con chofer vinculado, jornadas (días
distintos con viaje completado), km y descargas (cargas entregadas) del mes ×
tarifa (`getPeriodTripExtrasAction`, lectura de viajes con service client tras
el gate `hr:read`, porque la RLS de viajes deja afuera a finance). Cada línea se
agrega como un extra común, editable; las ya agregadas se marcan. Tarifas en la
ficha (`TripRatesCard`). IA: `getTripExtrasSuggestion`.

---

## 4. Asistencia — `attendance_records`

Modelo **basado en excepciones**: solo se guardan los días anómalos; un día sin
fila = trabajó normal. "Días trabajados" se **deriva** (días hábiles del mes −
excepciones), no se almacena. Migración `…517140000_attendance`.

**Tablas:**
- **`attendance_records`** — `employee_id`, `date`, `kind` (enum
  `attendance_kind`: `absent_justified, absent_unjustified, late, early_leave,
  sick, leave, holiday`), `hours_lost numeric(5,2)` (CHECK `>0` si presente),
  `notes`, `source ∈ ('manual','leave_sync','holiday_sync')`.
  `UNIQUE(employee_id, date)` — target del upsert.
- **`holidays`** — `date PK`, `name`, `scope ∈ ('national','jouve','province')`.
  Seed con feriados nacionales 2026 y 2027. **RLS asimétrica**: SELECT
  owner/admin/finance; INSERT/UPDATE/DELETE **solo owner/admin** (finance lee,
  no escribe feriados).
- **`v_attendance_records_resolved`** (VIEW) — join a `employees`, expone
  `employee_legal_name` y `day_of_week`.

RLS de `attendance_records`: 4 policies, todas `user_has_role(['owner','admin',
'finance'])`.

**Trigger `sync_attendance_from_leave()`** (`SECURITY DEFINER`) en
`employee_leaves` (AFTER INSERT/UPDATE/DELETE): mantiene filas
`(kind='leave', source='leave_sync')` para cada día de `[start_date, end_date]`,
con `ON CONFLICT (employee_id,date) DO NOTHING` → **"manual gana sobre auto"**.
En UPDATE borra el rango viejo y reinserta el nuevo; en DELETE borra el rango.

**Server actions** (`attendance-actions.ts`): `getAttendanceMonthAction(year,
month)` y `listAttendanceEmployeesAction` (`hr:read`);
`upsertAttendanceRecordAction` (`hr:write`, fuerza `source='manual'`, onConflict
`employee_id,date`) y `deleteAttendanceRecordAction` (`hr:write`, **solo borra
filas `source='manual'`** — las `leave_sync`/`holiday_sync` se gestionan desde su
tabla origen).

**Reglas:**
- 7 valores de enum; solo 5 son seteables desde UI (`MANUAL_KINDS`); `leave` y
  `holiday` son del sistema (deshabilitados en el select).
- `hours_lost`: Zod permite `''` (→null) o positivo ≤24; ⚠️ el max Zod (24) no
  coincide con el DB (`numeric(5,2)` admite hasta 999.99).

**UI:** `/hr/attendance` redirige al mes actual; `/hr/attendance/[year]/[month]`
(grid mes: filas = empleados activos, columnas = días; fin de semana y feriados
con fondo atenuado; cada celda es un botón → `AttendanceCellDialog`). Filas
`source != 'manual'` se muestran read-only ("auto desde licencia/feriado").
Hooks en `use-attendance.ts`.

> ⚠️ **Gap:** el comentario de la tabla `holidays` menciona un trigger que
> auto-marcaría `attendance_records(kind='holiday')`, pero **ese trigger
> `holiday_sync` no está definido** en la migración (solo existen el comentario y
> el valor `source='holiday_sync'`). Si se quiere ese comportamiento, falta
> implementarlo.

---

## 5. Vacaciones y licencias

Eventos de licencia + saldos anuales de vacaciones con devengado LCT, arrastre,
consumo FIFO y otorgamiento anual. Migración `…517130000_vacations`.

**Tablas:**
- **`hr_settings`** — config global key/value jsonb. Seed
  `vacation_carryover=true` (controla el arrastre). RLS: SELECT
  owner/admin/finance; UPDATE owner/admin.
- **`employee_leaves`** — eventos con fechas. `days int GENERATED ALWAYS AS
  ((end_date - start_date) + 1) STORED` (días corridos LCT, incluye fines de
  semana). `kind` enum `leave_kind` (`vacaciones, enfermedad, franco, maternidad,
  paternidad, otro`). CHECK `end_date >= start_date`. RLS owner/admin/finance
  (R/W).
- **`employee_vacation_balances`** — una fila por `(employee_id, period_year)`
  (`UNIQUE`). `entitled_days + bonus_days + carryover_days − used_days`,
  `granted_at`, `expires_at`, `status ∈ ('active','expired','extended')`.
  **RLS asimétrica**: SELECT owner/admin/finance; INSERT/UPDATE **solo
  owner/admin** (finance lee, no escribe saldos). Sin DELETE.
- **`v_employee_vacation_balances`** (VIEW) — + `remaining_days = entitled +
  bonus + carryover − used`.

**Reglas LCT:**
- Días por antigüedad (Art. 150), medidos al 31-Dic del `period_year`: <5 años =
  14; <10 = 21; <20 = 28; ≥20 = 35.
- Mínimo de trabajo (Art. 151) y proporcional (Art. 153): `vacation_work_days
  (employee, year)` cuenta los días hábiles (lunes a viernes, sin `holidays`)
  del año calendario, los del tramo en que el empleado estuvo (desde
  `hire_date`, hasta `termination_date`) y, de esos, los de trabajo efectivo:
  todos menos los que tienen `attendance_records.kind = 'absent_unjustified'`
  (licencias, enfermedad y faltas justificadas cuentan como trabajados, Art.
  152; los días que faltan del año también, como cualquier día sin fila). Si
  los efectivos no llegan a la mitad de los hábiles del año, `entitled =
  efectivos / 20` (entero). Tiene precedencia sobre los tramos. Reemplaza el
  corte "ingresó después del 1-Jul" sobre días corridos (`…201921`).
- **Período anual**: renueva el **1-Oct** (`granted_at`); se puede tomar entre
  1-Oct-N y 30-Abr-(N+1); `expires_at = 30-Abr` del año siguiente.
- **Arrastre** (LCT art. 164): los días no usados del período anterior pasan a
  `carryover_days` solo si ese período está `extended` o `active` sin vencer, con
  tope de un tercio de sus `entitled_days`, y solo si `vacation_carryover=true`. El
  período de origen pasa a `expired` (nota "N días arrastrados a AAAA"), así sus
  días no se consumen dos veces.

**RPCs / triggers:**
- **`grant_vacation_balances(p_target_year, p_carryover)`** (`SECURITY DEFINER`)
  — rutina anual (corre el 1-Oct vía cron). Idempotente (saltea `(employee,
  period_year)` existentes; solo activos). Marca `active → expired` los saldos
  con `expires_at < current_date` (excepto `extended`). Arrastra solo si
  `p_carryover` **y** `hr_settings.vacation_carryover` están en true (`…193031`).
  Devuelve filas otorgadas.
- **`sync_vacation_balance_used()`** [trigger en `employee_leaves`] — solo actúa
  sobre `kind='vacaciones'`. INSERT: `apply_vacation_delta(+days)`; UPDATE:
  revierte viejo y aplica nuevo; DELETE: `−days`.
- **`apply_vacation_delta(employee_id, delta)`** — `delta>0` (consumir): FIFO,
  `period_year ASC`, toma de saldos `active/extended`; si no hay capacidad,
  apila el overflow en el saldo más reciente → `remaining_days` negativo
  (sobreuso, lo resuelve un admin a mano). `delta<0` (devolver): LIFO,
  `period_year DESC`, baja `used_days` sin pasar de 0.

**Server actions** (`vacations-actions.ts`): leaves CRUD (`hr:write`),
`listEmployeeLeavesAction`/`listVacationBalancesAction` (`hr:read`), y
**`grantVacationBalancesAction` + `adjustVacationBalanceAction` (`hr:admin`)**.
El ajuste manual solo toca `bonus_days`, `status`, `notes` — `entitled_days`,
`carryover_days` y `used_days` no son editables (los gestionan el grant y el
trigger).

**UI:** `EmployeeVacationsCard` (en el detalle del empleado): tabla de saldos
(saldo rojo si <0, verde si >0) + tabla de licencias + form de nueva licencia
(solo si `hr:write`). El otorgamiento/ajuste de saldos es UI de admin (hooks
`useGrantVacationBalances`/`useAdjustVacationBalance` existen pero la pantalla de
admin no está en este slice). Hooks en `use-vacations.ts`.

---

## 6. Documentos de empleado — `employee_documents`

Papeles con fecha de vencimiento (licencia de conducir, LNH, libreta sanitaria,
cursos de cargas/mercaderías peligrosas, aptitud psicofísica/visual, cédula
verde/azul, seguro personal, ARN, otro). Migración `…518100000_employee_documents`.

**Tabla `employee_documents`:**
- `kind` enum `employee_document_kind` (12 valores), `number`, `issued_at`,
  `expires_at NOT NULL`, `issuing_authority`, `notes`.
- `attachment_file_id uuid` → `files(id)` `ON DELETE SET NULL` (link al
  subsistema files; borrar el archivo desliga pero conserva el doc).
- `notified_at timestamptz` — marca de cooldown del cron; **se resetea a null en
  cada update** (para que el cron pueda re-alertar tras una renovación).
- CHECK `issued_at IS NULL OR expires_at >= issued_at`.

**RLS:** 4 policies, todas `user_has_role(['owner','admin','finance'])` (alineado
a la matriz `hr:*` desde la mig `…20260616120000`; antes usaba `operations`, §1).

**`v_documents_expiring`** (VIEW, `security_invoker=on`) — docs de empleados
**activos** que vencen en ≤30 días. La consume el cron y la página de
vencimientos. (No está en `database.types.ts`; tipada a mano como
`ExpiringDocumentRow`.)

**`notifications`** — la migración agrega `'document_expiring'` al CHECK
`notifications_type_known`.

**Modelo de renovación:** append-only por convención. Para renovar se inserta
una **fila nueva** con el `expires_at` extendido; las viejas quedan como
historial. **No hay índice único parcial de "fila vigente"** — Postgres exige
funciones IMMUTABLE en el predicado y `current_date` no lo es (comentario
explícito en la migración). La desambiguación es por orden de UI: `expires_at
asc`.

**Server actions** (`employee-documents-actions.ts`):
`listEmployeeDocumentsAction`/`listExpiringDocumentsAction` (`hr:read`),
`create/update/deleteEmployeeDocumentAction` (`hr:write`). `update` siempre setea
`notified_at=null`. `delete` es hard-delete.

**Estado (client-side, `getDocumentStatus`):** `<0` → `expired` (Vencido);
`≤30` → `expiring_soon` (Por vencer); si no `valid` (Vigente). La ventana de 30
días coincide con el cron y la view.

**UI:** `/hr/document-expirations` (tabla org-wide con search + filtro por tipo)
y `EmployeeDocumentsCard` en `/employees/[id]` (per-empleado, con dialog de
alta/edición). Hooks en `use-employee-documents.ts`.

> ⚠️ **Gap:** `attachment_file_id` está cableado en schema/action/insert pero el
> dialog de alta/edición **no expone el campo de adjunto** todavía.

---

## 7. Crons (Inngest)

Registrados en `app/api/inngest/route.ts`. Ambos `retries: 2`, TZ
`America/Argentina/Buenos_Aires`, usan `getServiceClient()` (bypassean RLS).

| Cron | Schedule | Qué hace |
|---|---|---|
| **`vacation-balances-grant`** | `0 0 1 10 *` (anual, 1-Oct 00:00 ART) | Un step que lee `hr_settings.vacation_carryover` y llama `grant_vacation_balances({ p_target_year: <año>, p_carryover: <setting> })`. Loguea `hr.vacation_balances_granted {target_year, count}`. Fallback manual admin-only vía `grantVacationBalancesAction`. |
| **`document-expiry-alerts`** | `0 8 * * *` (diario, 08:00 ART) | (1) lee `v_documents_expiring`; filtra por cooldown `NOTIFY_COOLDOWN_DAYS=7` (`notified_at` null o >7 días); (2) destinatarios = `user_roles.user_id` con `role_id ∈ ('owner','admin','finance')`; (3) inserta una notif `type='document_expiring'` por (doc × destinatario) con metadata; (4) marca `notified_at=now()`. Early-exit si no hay docs/destinatarios. |

> El recipient set de `document-expiry-alerts` quedó **alineado** a la matriz
> `hr:*` (`owner/admin/finance`) en la mig `…20260616120000` — antes apuntaba a
> `operations` (ver §1).

---

## 8. Convenciones transversales (heredadas del repo)

- **Server actions:** `"use server"` → `requireUserContext()` →
  `userCan(ctx.access, "hr:<x>")` → `getServiceClient()` → `ActionResult<T>`
  (`lib/query/run-action.ts`). Sin `select *`. Audit vía `logAudit()` →
  `audit_events`.
- **Narrowing:** las reads narrowan enums (`isAttendanceKind`, `isLeaveKind`,
  `isEmployeeDocumentKind`, `isPayrollStatus`, …) y **descartan + loguean** filas
  con valores desconocidos en vez de romper.
- **Cliente:** `useSuspenseQuery`/`useSuspenseInfiniteQuery` con prefetch+Hydrate
  en el server component; mutaciones invalidan la query key del dominio. Query
  keys por sub-feature en `lib/*-keys.ts`.
- **UI:** CRUD en `Dialog` centrado; botones a la derecha (Cancelar a la
  izquierda del primario); submit deshabilitado sin cambios en modo edit;
  monocromo (severidad por icono + copy, no color de marca).
- **Páginas:** `force-dynamic`, gate `userCan('hr:read')` con
  `redirect('/dashboard')` además de RLS.

---

## 9. Gaps conocidos (candidatos a fix)

1. ~~**Divergencia de permisos en documentos de empleado**~~ — **resuelto
   2026-06-16**: RLS de `employee_documents` + destinatarios del cron migrados a
   `owner/admin/finance` (mig `…20260616120000`), alineados a la matriz `hr:*`. §1.
2. **Trigger `holiday_sync` ausente** (§4): comentado en la migración, no
   implementado. Los feriados no auto-marcan asistencia.
3. **Campo de adjunto no expuesto** (§6): `attachment_file_id` cableado pero el
   form no lo ofrece.
4. ✅ **`hours_lost` desalineado** (§4) — **corregido**: check constraint
   `attendance_records_hours_lost_max` (`<= 24`) agregado (mig `…20260616190000`),
   alineado al tope Zod del action (una fila = un día).
5. **Sobreuso de vacaciones** (§5): `apply_vacation_delta` apila el exceso como
   `remaining_days` negativo; no hay alerta — lo resuelve un admin a mano.
6. **Tests:** `features/hr` y `features/employee-documents` tienen
   `schema.test.ts`, pero no hay tests de los server actions sensibles (matriz de
   permisos `hr:*` sí está en `permissions.test.ts`).
7. **Cuenta corriente vs. liquidador** (§3.6): el descuento de planilla no
   tiene asiento propio; si el liquidador no descuenta el anticipo en su
   asiento, `anticipos_personal` queda con saldo en el mayor fiscal. (En
   Gestión percibido, desde `20261103070000` el pago con OP de una compra a
   cargo de un empleado va a "Anticipos al personal", no a proveedores.)
