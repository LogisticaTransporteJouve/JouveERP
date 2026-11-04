# 2026-11-03 — Cuenta corriente del empleado, aumentos en % y extras de viajes (3.3–3.6)

**Decisión (D1).** Adelantos, compras a cargo de un empleado y deudas son un
crédito contra el empleado, no costo: cuenta COA nueva "Anticipos al personal"
(rol `anticipos_personal`, activo) y una cuenta corriente por empleado
(`employee_account_movements`, ARS/USD, acreedor empresa o socio) con planes de
devolución (`employee_debt_plans`: total, cuota, activo/pausado/cancelado/
condonado). La planilla toma como Deudas la cuota de los planes activos en
pesos; editarla a mano la fija para ese mes (`deudas_override`) y se puede
volver a la cuota. Cerrar el período escribe el descuento en la cuenta y
reabrirlo lo saca; los períodos cerrados antes no escriben nada. "Adelanto a
empleado" en Tesorería y Caja es un egreso que pertenece al adelanto
(`record_employee_account_cash`) y se asienta contra el anticipo. Una compra
fiscal "a cargo de empleado" sigue en el Libro IVA, pero su neto va al
anticipo (fuera del costo operativo de Gestión) y su total a la cuenta del
empleado. En Gestión el costo aparece cuando se descuenta en planilla (o se
condona una deuda con la empresa), como sueldos internos de ese mes.

**Decisión (3.6).** Los aumentos se aplican en % por grupo (todos, puesto o
convenio) desde un mes; cada cambio del sueldo base queda en
`employee_salary_changes` y la planilla de un mes siembra el sueldo vigente en
ese mes. Las planillas en borrador desde ese mes que tenían el sueldo anterior
se actualizan; un sueldo editado a mano se respeta.

**Decisión (3.5).** Los extras de chofer se **sugieren** desde los viajes
completados del mes (jornadas, km, descargas × tarifas de la ficha) y se
agregan como extras comunes, editables; no se escriben solos.

**Descartado.** Seguir con Deudas como importe libre sin saldo; asentar el
descuento de planilla en el diario fiscal (lo cancela el asiento de sueldos
del liquidador); descontar planes en USD en la planilla (en pesos); escribir
los extras de viajes automáticamente (las tarifas y los viajes cargados tarde
los harían cambiar bajo los pies).
