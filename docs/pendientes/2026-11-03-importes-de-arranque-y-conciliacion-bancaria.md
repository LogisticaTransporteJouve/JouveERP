# Importes de arranque y conciliación bancaria (2026-11-03, roadmap 5.3 + 5.4)

- [x] **Importador, tanda 2**: tarifas por cliente (con vigencia, respeta la
      superposición), préstamos con sus cuotas pendientes, cheques de
      terceros en cartera, saldos iniciales de clientes (lo que debe cada
      uno al corte) y extractos bancarios. Cada corrida se deshace mientras
      nada la usó (cuota pagada, cheque movido, recibo nuevo del cliente,
      tarifa facturada, línea conciliada).
- [x] **Conciliación bancaria** (Tesorería › Conciliación,
      `/treasury/reconciliation`): por cuenta y mes, sugerencias por importe,
      fecha y referencia; conciliar una línea con uno o varios movimientos;
      desconciliar; "no corresponde" con motivo; crear el movimiento que
      falta (comisión, interés) con su cuenta de gasto. Saldo según extracto
      contra saldo según libros. Un movimiento conciliado no se edita ni se
      borra hasta desconciliarlo.
- [x] Aprobar las migraciones `20261103140000_bank_reconciliation` y
      `20261103140100_import_opening_items` con el deploy (después de
      `20261103110000_import_runs`). Rollback: el código anterior no lee las
      tablas nuevas, saltea las corridas de tipos que no conoce y no las
      puede deshacer; el guard de conciliación sigue rechazando editar un
      movimiento conciliado. — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [ ] pgTAP verde en CI (stack fresco: `bank_reconciliation_test.sql`); sin verificar contra
      datos de producción. La UI no se probó en el navegador.
- [ ] Cobranzas históricas (recibos de antes del go-live) **no** se importan:
      moverían caja y asientos de períodos ya cerrados en papel. Va el saldo
      inicial por cliente; el detalle por factura queda para el ajuste
      inicial.
- [ ] Cheques importados: el ingreso a cartera se fecha hoy y acredita
      ajustes de caja (sin cliente). No cargar además el saldo inicial de la
      cuenta de cartera por esos cheques.
