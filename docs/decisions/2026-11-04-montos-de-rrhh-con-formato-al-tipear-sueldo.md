# 2026-11-04 — Montos de RRHH con formato al tipear; sueldo de la liquidación final

**Decisión.** Todo monto de RRHH se tipea en `MoneyInput`
(`components/money-input.tsx`): `type="text"`, `inputMode="decimal"` y
`formatAmountInput` en cada tecla, el mismo comportamiento que los editores
de recibos y OP. Lo que el campo muestra es lo que lee `parseArAmount`; un
punto o un signo menos tipeados se ven descartados. `parseArAmount` exige que
todo el texto sea un número.

La liquidación final toma el sueldo de `employee_salary_for_month` para el
mes de baja; si es null (sin sueldo base), el `sueldo_neto` de la planilla
del mes anterior, y si tampoco hay, 0.

**Por qué.** Con `parseArAmount` detrás de inputs sin formato, "1500.50" se
guardaba como 150050 sin aviso, y los `type="number"` del alta del empleado
vaciaban el sueldo al editar. La liquidación leía la línea del mes de baja,
que ella misma pisa con el sueldo proporcional: cada recarga lo volvía a
prorratear.

**Descartado.** Rechazar "1500.50" como ambiguo: el resto de la app ya
formatea al tipear y es lo que el usuario conoce. Guardar el sueldo previo en
el payload de auditoría y leerlo de ahí: depende de una auditoría como dato
de negocio.
