# Decisiones — Liquidaciones, archivos guardados y escaneo (auditoría w12)

Pendientes: `docs/pendientes/2026-11-04-rrhh-archivos-y-escaneo-auditoria-w12.md`.

## `posts_employee_accounts` es de la base

`enforce_payroll_period_immutability` (`20261104194100`) rechaza cambiar
`payroll_periods.posts_employee_accounts` y crear un período con `false`,
salvo `service_role`. Lo escribe solo el default (`true`) y el backfill de
`20261103060100`; la app nunca lo toca. Se deja pasar a `service_role` para un
backfill futuro. `closed_at` y `closed_by` siguen como estaban.

## Cerrar y reabrir una liquidación solo desde su estado

`closePayrollPeriodAction` actualiza solo un período en borrador y
`reopenPayrollPeriodAction` solo uno cerrado. Si no cambia ninguna fila (otra
pestaña ya lo movió, o no existe) devuelven «El período ya estaba cerrado o no
existe.» / «El período ya estaba en borrador o no existe.», sin auditar y sin
pisar `closed_by`/`closed_at`. El rechazo de un guard muestra su propio
mensaje.

## Archivos guardados: borrar y subir

En el bucket `files` (`20261104194101`):

- **Borrar:** quien subió los bytes (`storage.objects.owner_id`) u
  owner/admin, el mismo techo que borrar la fila («Uploader or admin»). Se usa
  `owner_id` (lo pone storage al subir) y no `files.uploaded_by`: una fila
  puede nombrar una key que ninguna otra fila nombra, como un blob ajeno que
  quedó sin fila, así que no prueba quién escribió los bytes.
- **Subir:** solo los roles con `files:write`, y nunca a una key que nombra
  una fila de otro usuario (`files_storage_key_is_free`, DEFINER, porque la
  RLS del caller puede ocultar esa fila).
- **Fila en `files`:** el mismo chequeo de key y solo el bucket `files`.
  Sin esto, una fila falsa con la key de otro archivo (o de un avatar o un
  backup) quedaba huérfana y el barrido de huérfanos, con el cliente de
  servicio, borraba ese blob.
- La lectura no cambia: los archivos que ya están en producción se siguen
  viendo y firmando igual.

## Escaneo

- `extractionRequester` tira el error de la lectura, así el paso de Inngest
  reintenta. `null` queda solo para una fila sin quien la escaneó.
- Cuando quien escaneó no puede ver Clientes o Proveedores, la búsqueda por
  CUIT no corre y se guarda `matches.counterparty_unchecked`. La revisión dice
  «No se pudo verificar el cliente/proveedor (sin permiso)» y no sugiere
  cargarlo.
