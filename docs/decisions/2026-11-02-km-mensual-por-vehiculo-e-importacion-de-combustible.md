# 2026-11-02 — Km mensual por vehículo e importación de combustible

**Decisión.** Flota → Km mensual (`/vehicle-km`, `features/vehicle-km`,
migración `20261103020000_vehicle_km_and_fuel_import`): una lectura del
odómetro por vehículo y mes (`vehicle_km_readings`, único por vehículo y
`period`), permiso `fleet_km:read`/`fleet_km:write` para owner, admin y
operations. Los acoplados y semis no llevan km. Un km menor que el del mes
anterior se guarda igual (odómetro cambiado) y la pantalla lo marca. El
recordatorio es una fuente más de las tareas automáticas (`vehicle_km`): una
tarea "Cargar km de <mes>" por mes, vence el día 5 (el aviso de vencimiento de
`tasks-daily` sale ese día), se abre el día 1 mientras falte algún vehículo y
se cierra sola cuando están todos. Un mes que termina incompleto cierra su
tarea al empezar el siguiente; el faltante queda a la vista en la pantalla.

Combustible suma "Importar resumen": un .xlsx o .csv de YPF en Ruta, Axion
Card u otra planilla, con las columnas reconocidas por alias de encabezado por
proveedor (`features/fuel/lib/import.ts`, editables en el diálogo), vehículo
por patente o por la nueva `vehicles.fuel_card` (una tarjeta enmascarada se
reconoce por los últimos 4 dígitos si es única) y duplicados marcados (mismo
vehículo, día, importe y litros); nada se guarda hasta confirmar, y la
confirmación vuelve a saltear los duplicados que el usuario no eligió. Cada
carga acepta el ticket o remito como adjunto (`file_attachments.fuel_load_id`,
listado en Archivos).

**Por qué.** El km por camión no se registraba y las cargas de las tarjetas se
tipeaban una por una.

**Descartado.** Una tarea recurrente manual para el km (no sabe si ya se cargó)
y un formato fijo por proveedor (no tenemos un resumen real de cada uno: los
alias se amplían cuando llegue).
