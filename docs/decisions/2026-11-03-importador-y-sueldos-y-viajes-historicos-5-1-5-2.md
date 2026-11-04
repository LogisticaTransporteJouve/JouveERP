# 2026-11-03 — Importador y sueldos y viajes históricos (5.1 + 5.2)

**Decisión (5.1).** Un importador genérico en Admin → Importador
(`/admin/imports`, `features/imports`, migración `20261103110000_import_runs`):
se sube un .xlsx (primera hoja) o .csv, se elige el tipo, se ajustan las
columnas (reconocidas por alias de encabezado, como el resumen de
combustible, con los helpers compartidos en `lib/tables/columns.ts`) y cada
fila se valida con el schema Zod del alta normal (`ClientCreateSchema`,
`SupplierCreateSchema`, `EmployeeCreateSchema`, `VehicleCreateSchema`) o uno
propio para los históricos. La vista previa muestra cada fila como lista, ya
cargada o con error, con sus avisos. Confirmar vuelve a leer el archivo en el
servidor (el navegador nunca manda filas) y `commit_import_run` inserta la
corrida y sus filas en una transacción, serializada por tipo con un lock. Las
filas con error quedan afuera y se cuentan. Cada corrida queda en
`import_runs`: quién, cuándo, tipo, nombre y SHA-256 del archivo, columnas,
filas importadas, salteadas y con error, y estado (`committed`/`undone`).
**Idempotente por clave natural:** cliente/proveedor por CUIT (o por nombre
entre los internos, sin CUIT), empleado por CUIL (sin CUIL, por nombre),
vehículo por patente (solo letras y dígitos), sueldo histórico por empleado +
mes + tipo, viaje histórico por el hash de su contenido y su repetición en el
archivo (dos viajes iguales del mismo día siguen siendo dos; el mismo archivo
otra vez no agrega nada). Reimportar el mismo archivo avisa la corrida
anterior. Cada fila importada lleva `import_run_id` (columna nueva en
clientes, proveedores, empleados, choferes y vehículos). Un empleado con
puesto chofer crea también su ficha de chofer, como el formulario.
**Deshacer** una corrida borra sus filas solo si ninguna se editó después
(`updated_at > created_at`) y ninguna fila fuera de la corrida las referencia
por alguna FK (se buscan en el catálogo, así una tabla nueva queda cubierta
sola); bloquea las filas antes de revisar, así nadie las referencia en el
medio. Permisos nuevos `imports:read` / `imports:write` (owner y admin);
importar o deshacer pide además el permiso de escritura del módulo destino
(`clients:write`, `suppliers:write`, `hr:write`, `vehicles:write`,
`trips:write`), así una denegación por usuario se respeta.

**Decisión (5.2).** Los sueldos y viajes históricos van a **tablas propias**
(`historic_payroll_entries`, `historic_trips`), no a `payroll_entries` /
`trips` con una marca: así no generan asientos, movimientos de caja, cuenta
corriente del empleado, extras de chofer, facturación ni rentabilidad, y no
pasan por los guards de movimientos con dueño ni de período cerrado (que no
los ven). Son **solo de referencia**: se ven únicamente en las pestañas
"Sueldos históricos" (por año, con totales por mes) y "Viajes históricos"
(por mes, con km y flete) del importador, con `imports:read` más `hr:read` o
`trips:read`. No entran en Gestión, flujo de caja, libro IVA, libro diario o
mayor, paquete del contador, reportes de RRHH o flota ni herramientas de IA.
Un sueldo histórico necesita el empleado cargado (por CUIL o nombre único);
avisa si ya hay una planilla real de ese mes. Un viaje guarda el texto de la
patente, chofer y cliente y, si los encuentra, su id. Las filas históricas no
se editan ni se borran sueltas (`guard_historic_row`): se deshace la corrida
y se reimporta. Las diferencias de saldos de antes del go-live se corrigen
con el ajuste inicial (decisión del usuario), no con estos datos.

**Por qué.** El arranque necesita cargar maestros y el historial de planillas
sin tipear fila por fila, sin duplicar al reintentar y sin que datos viejos
inconsistentes muevan la contabilidad.

**Descartado.** Filas históricas en `payroll_entries`/`trips` con una marca
(cada lector actual — asientos, extras de chofer, rentabilidad, IA — tendría
que aprender a excluirlas, y el código anterior en un rollback no lo sabe);
mandar las filas validadas desde el navegador (se vuelve a leer el archivo);
guardar el archivo en Storage (alcanza el hash y el nombre); deshacer
borrando en cascada; una dependencia de planillas (el lector de xlsx propio
alcanza). Fuera de alcance: cobranzas, tarifas, préstamos, cheques y
extractos bancarios (5.3, 5.4).
