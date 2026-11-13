# Plan de ahorro que se le imputa a un empleado (2026-11-13)

## Contexto

La empresa paga un Toyota Plan (Hilux) que en los hechos es parte de lo que
recibe un empleado (Walter Dziurdzia). Walter no tiene sueldo formal y la Hilux
está a nombre de la empresa en los libros.

## Decisión

- El plan se carga como cualquier **Plan de ahorro** (`kind = plan_ahorro`) con
  `loans.salary_employee_id` («Se le imputa a»), solo permitido en un plan.
- **Contabilidad sin cambios:** cada cuota pagada asienta como cualquier cuota de
  plan (capital a «Rodados en plan de ahorro», el resto como hoy). No toca
  «Sueldos y jornales». El único movimiento de caja es el débito de la cuota.
- **Planilla (solo gestión):** al pagarse una cuota (Pagar, Usar un egreso, Pagar
  cuota desde el extracto) la base agrega en la planilla mensual del mes de
  vencimiento la línea «Plan de ahorro: <descripción> · cuota N»
  (`payroll_entry_extras.loan_installment_id`), en pesos. Suma al Total y cuenta
  como **ya pagada** (`paid_in_kind` en `v_payroll_entries_with_payments`): el
  Saldo no cambia. No es un `payroll_payment` (eso crearía un movimiento y un
  asiento de sueldo): no asienta, no mueve caja, no entra en el reparto por
  recibo, la diferencia de recibo al cerrar, la transferencia/efectivo sugeridos
  ni el SAC.
- Si la planilla no existe se crea (como «Nueva liquidación»); si el empleado no
  está, se agrega su fila (como «Agregar faltantes» para él). Planilla cerrada:
  la cuota no se puede pagar hasta reabrirla.
- La línea la escribe solo la base; si la cuota deja de estar pagada (hoy ninguna
  pantalla despaga una cuota) o se borra, la línea se va. No se quita ni edita
  desde la planilla, la fila que la tiene no se borra y el empleado imputado no
  cambia una vez que una cuota figura en una planilla.
- Las cuotas cargadas como «pagada antes de cargar» y las que se vinculan después
  (`relink`) no generan línea.

Migración `20261113100000_loan_plan_salary_employee`. Carga del plan de Walter en
[`pendientes/2026-11-13-plan-toyota-walter.md`](../pendientes/2026-11-13-plan-toyota-walter.md).
