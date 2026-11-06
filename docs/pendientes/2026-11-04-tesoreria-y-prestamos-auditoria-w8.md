# Tesorería y préstamos: guardas de altas y pagos, auditoría w8 (2026-11-04)

Ver [la decisión](../decisions/2026-11-04-tesoreria-y-prestamos-escritos-por-sus-rpc-w8.md).

- [x] **Un recibo o una OP se dan de alta solo por su RPC**
      (`20261104150000`). Antes, un POST de una cabecera sin líneas movía la
      cuenta corriente sin nada en Caja.
- [x] **Una cuota se paga solo por «Pagar» o «Usar un egreso ya cargado»,
      y el desembolso se registra solo por «Registrar desembolso»**
      (`20261104150001`). Antes, un PATCH podía marcarla pagada sin egreso,
      volverla a pendiente o ligarla a cualquier movimiento.
- [x] **«Nuevo préstamo» guarda el préstamo y sus cuotas juntos**
      (`create_loan`, `20261104150001`).
- [x] **Una cartera de cheques se mueve solo con un cheque** en recibos y
      OP (`20261104150002`).
- [x] **Un movimiento en una cartera o ligado a un documento lo escribe su
      documento** (`20261104150003`).
- [x] **«Nuevo cheque propio»** muestra el motivo de la guarda.
- [x] No verificado contra una base real: las cuatro migraciones y sus
      pgTAP. Son `treasury_loan_guards_w8` y los fixtures adaptados de
      `allocations_same_channel`, `channel_config`, `checks_channel`,
      `db_integrity_authz`, `fx_difference`, `journal_document_entry`,
      `journal_reverse`, `money_guards`, `opening_balances_real_open`,
      `otras_ventas_sides`, `receipt_retentions` y
      `rejected_check_receivable`. El test de integración
      `tests/integration/money-guards.test.ts` (con `RUN_INTEGRATION=1`)
      ahora crea su recibo con `create_receipt`. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
- [ ] Fuera de alcance, igual que en w7: las asignaciones de recibos y OP
      siguen abiertas a escritura directa bajo RLS.
- [ ] Fuera de alcance: el ajuste de saldo inicial de una cuenta
      (`apply_account_opening_balance`, solo owner) sigue aceptando una
      cartera de cheques, y ese saldo no corresponde a ningún cheque.
