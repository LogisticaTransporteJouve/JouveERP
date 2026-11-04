# 2026-11-04 — NC de una compra a cargo de empleado: baja el cargo

**Decisión.** Una NC contra una compra a cargo de un empleado baja lo que se
le carga (la compra menos sus NC vivas, con la misma regla neto/total) y su
neto vuelve a anticipos al personal, no al gasto
(`20261104102300_employee_charge_net_of_credit_notes`). Una NC que lo deja en
cero quita el cargo. Si la descripción del cargo la editó el usuario, se
conserva.

**Por qué.** El empleado seguía debiendo la compra entera y la NC bajaba un
gasto que nunca fue de la empresa: Gestión mostraba una ganancia.

**Descartado.** Rechazar la NC mientras la compra tenga el cargo: obliga a
sacarlo, y al volver a ponerlo se carga entero otra vez.
