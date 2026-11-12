# Plan de ahorro y resumen de tarjeta pagado (2026-11-12)

Partes E y F del plan «DZ y sueldos» (E–I): un tipo de préstamo **Plan de ahorro** cuyas cuotas
suman a un activo, y la recategorización de un resumen de tarjeta **ya pagado** con un solo
re-registro.

## E — Plan de ahorro

- [x] **PR — tipo «Plan de ahorro».** Migraciones `20261112100000_loan_kind_savings_plan`
      (`loan_kind.plan_ahorro`, `coa_system_role.planes_ahorro`, solas en su archivo) y
      `20261112100100_loan_savings_plan`: cuenta 1.2.1.x (siguiente libre) «Rodados en plan de
      ahorro» (activo); `loan_liability_role` da `planes_ahorro` para un plan; en
      `build_transaction_journal_lines` una cuota de plan sin desglose o pagada por otro importe
      suma entera al plan (nunca a gastos) y una con desglose pagada por su importe suma su
      capital; `record_loan_bank_payments` baja la cuenta del propio préstamo (antes siempre
      Préstamos financieros); `record_loan_disbursement` y `book_loan_opening` rechazan un plan.
      UI: tipo en el alta, detalle con «Falta pagar» y «Acumulado en el plan», sin desembolso ni
      deuda de apertura; `getLoans` no cuenta un plan como deuda (`savingsPlansPending`). pgTAP
      en `loan_liability_test`.
- [ ] Aprobar las dos migraciones con el deploy. Rollback: el código anterior muestra un plan como
      «Préstamo» y no lo puede crear; el SQL nuevo queda (las cuotas de un plan siguen sumando al
      activo). Efecto para préstamos/leasings existentes: solo un comprobante del banco **nuevo**
      de un leasing baja Deudas por leasing en vez de Préstamos financieros; los asientos ya
      hechos no se tocan.
- [ ] **Datos (después de promover, el owner desde la app):** crear los planes Toyota Plan y
      Círculo Cerrado en `jouve_fiscal` con sus cuotas y pagar desde la línea de Galicia la de
      Toyota del 13/10 (948.922,09) y la de Círculo Cerrado del 15/10 (1.358.957,10). Sin saldo de
      apertura: la cuenta arranca en 0 en octubre de 2026 (decisión del usuario).
- [ ] «Acumulado en el plan» suma el capital (o lo pagado) de **todas** las cuotas pagadas, también
      las marcadas como pagadas antes de cargar el plan, que no tienen asiento; si se cargan cuotas
      viejas como pagadas, la cifra del detalle supera el saldo contable de la cuenta.
- [ ] Diferido: la adjudicación (pasar lo acumulado a Rodados 1.2.1.1) y las etiquetas de planes en
      el resultado de gestión y el flujo de caja (hoy la cuota pendiente de un plan se proyecta
      como la de un préstamo).

## F — Resumen de tarjeta pagado

**Chequeo previo F1.0 (producción, solo lectura, 2026-11-12):** `card_statements` tiene un
resumen pagado en el rango: cierre 01/10/2026 (consumos de septiembre), estado `pagado`,
`paid_ars_on` y `paid_usd_on` 13/10/2026. No hay filas en `accounting_closed_periods` para
2026-09 ni 2026-10. El chequeo pasa: se hicieron F1.1–F1.4.

- [x] **PR — recategorizar un resumen pagado.** Migración
      `20261112100200_card_reclassify_guard`: `reclassify_card_statement_lines` rechaza (55006)
      una parte pagada cuyo débito ya no está conciliado, sin cambiar ninguna línea (antes la
      salteaba y cambiaba las líneas igual). El destino por defecto de una tarjeta se aplica también
      a un resumen pagado: solo cambian los consumos que seguían el destino anterior (los cambiados
      a mano quedan) y la parte se vuelve a registrar **una vez**, con la misma línea del extracto.
      Selección de varios consumos con casilla y «Aplicar» (una sola llamada). Confirmación «¿Volver
      a registrar el pago?» con la cantidad de consumos. pgTAP en `card_statements_test`.
- [ ] Aprobar la migración con el deploy. Rollback: el código anterior llama la misma firma; el
      rechazo solo frena un cambio que dejaba las líneas y los asientos desparejos.
- [ ] **Datos (después de promover, el owner desde la app):** en el resumen con cierre 01/10/2026,
      pasar San Cristóbal (≈3,5 M, hoy en Peajes 5.2.3) a Seguros y los consumos personales (hoy
      5.1.1) a adelantos de los socios. Si el mes del pago se cerró antes, reabrirlo primero.
- [ ] Sin verificar en el navegador: la barra de selección y la confirmación se probaron con
      tests unitarios del helper (`holder-default`) y de la acción, no con `/verify`.
