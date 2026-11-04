# 2026-11-04 — Diferencias de cambio en Gestión: resultado financiero

**Decisión.** La cuenta "Diferencias de cambio" (rol `diferencia_cambio`)
va en Gestión a "Costo financiero" (`financing_cost`, subrubro `intereses`,
como la 4.2.1), abajo del margen operativo
(`20261104102000_management_fx_loan_interest`). Una ganancia por cambio suma
y una pérdida resta en esa línea; no mueve el margen operativo, el margen %,
el EBITDA ni el margen por camión. Si el dueño ya le había dado un rubro a esa
cuenta, se respeta.

**Por qué.** Desde #344 el cobro o el pago en USD a otra cotización asienta
la diferencia en esa cuenta, que no tenía rubro: caía en "Sin clasificar",
que entra al margen operativo. El resultado por cambio no es de la
operación de transporte; en el EERR ya es ingreso financiero.

**Descartado.** Un subrubro propio "Diferencias de cambio" (pide cambiar el
CHECK de `management_buckets` y un código anterior en un rollback no lo
conocería); dejarla en "Sin clasificar" con un aviso.
