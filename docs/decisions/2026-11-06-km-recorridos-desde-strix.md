# 2026-11-06 — Km recorridos desde Strix

**Decisión.** Los km de cada vehículo salen de Strix Flotas (el GPS de los
camiones) y no de una lectura del odómetro cargada a mano. Un robot HTTP
(`lib/strix/robot.ts`, armado sobre la grabación del owner del 2026-11-06)
entra con un usuario de Strix, pide el informe «Kmts recorridos» y guarda los
km por vehículo y día en `vehicle_km_daily` (migración
`20261106191306_strix_vehicle_km`). Corre todos los días (la última semana)
desde Inngest (`strix-km-sync`) y a pedido con «Traer de Strix» para las
fechas elegidas. Flota → Km recorridos (`/vehicle-km`) suma los km del rango
que se elige; un clic en la patente (ahí o en Vehículos) muestra los km de
cada día.

El usuario y la clave de Strix se guardan como los de ARCA: la clave en
Supabase Vault, editable por owner y admin (`fleet_km:admin`), con freno tras
un rechazo o dos fallas seguidas. La patente de Strix se reconoce por la del
vehículo; una que no está cargada no se guarda y se nombra en el resultado.

Sale la carga manual del odómetro, la tarea automática «Cargar km de <mes>» y
la propuesta de la IA para cargar km. `ai_vehicle_activity` (IA y costo por
km) suma los km de Strix del rango. `vehicle_km_readings` queda en la base,
sin uso, para que un rollback no pierda datos.

**Por qué.** Los km ya están medidos en Strix; tipearlos una vez por mes no
deja ver un rango cualquiera ni el detalle por día.

**Descartado.** Seguir con el odómetro y guardar Strix aparte (dos números
para lo mismo); crear vehículos solos desde Strix (el tipo y los datos los
elige una persona); un navegador real para el robot (la API HTTP alcanza).
