# Auditoría w2: RRHH, Gestión y rendiciones (2026-11-04)

- [x] Liquidación final de junio o diciembre: si la planilla del SAC del
      semestre ya tiene al empleado, el SAC proporcional sugerido es solo lo
      que falta (la tarjeta lo avisa y linkea esa planilla). Si ahí cobra el
      semestre entero de más, se ajusta a mano en esa planilla.
- [x] Liquidación final de alguien que entró ese mismo mes: el sueldo
      proporcional cuenta desde la fecha de ingreso.
- [x] Montos de RRHH (planilla, pagos, adelantos, planes, embargos, tarifas de
      viajes, liquidación final, alta del empleado) leen "150.000" como
      150000, como el resto de la app.
- [x] NC de una compra a cargo de empleado: baja el cargo y su neto vuelve a
      anticipos al personal (`20261104102300`, decisión en
      `docs/decisions/2026-11-04-nc-de-una-compra-a-cargo-de-empleado-baja-el-cargo.md`). El cargo conserva una descripción editada.
- [x] Gestión (`20261104102000`): "Diferencias de cambio" en costo
      financiero (decisión en
      `docs/decisions/2026-11-04-diferencias-de-cambio-en-gestion-resultado-financiero.md`); el interés de una cuota
      sin desglose de un préstamo con pasivo asentado es costo financiero y no
      capital, en las dos bases; un descuento de planilla o una condonación en
      USD sin cotización queda en "USD sin cotización"; el percibido valúa un
      recibo o una OP en USD a su cotización y redondea cada línea.
- [x] Rendición: cargar la diferencia al chofer, quitarla o cancelar la
      rendición que la tiene pide `hr:write` y `transactions:write`
      (`20261104102100` corrige el mensaje).
- [x] IA: `getDriverSettlements` devuelve `difference_kind`; una diferencia
      asentada al chofer antes de `20261104095300` (`charge`/`payment`) no
      dice que el cliente quedó saldado.
- [x] IA: `getPayrollSummary` con alcance muestra lo pagado por los otros
      canales (el saldo es siempre de todos).
- [x] Una DDJJ de IVA que solo deja saldo a favor no abre "Pagar IVA"
      (`20261104102400`).
- [x] **Decidido (owner, 2026-11-04):** todo lo de RRHH y cheques que mueve
      o borra tesorería pide también `transactions:write`: los pagos de
      planilla (individual y masivo, editar y borrar), borrar un movimiento de
      la cuenta corriente que tiene movimiento de caja
      (`deleteAccountMovementAction`) y pagar la deuda de un cheque vendido
      (`payCheckSaleDebtAction`). El botón queda oculto o deshabilitado con
      el motivo, con el mismo predicado que la acción (`HR_CASH_PERMISSIONS`,
      `CHECK_SALE_DEBT_PAY_PERMISSIONS`). La matriz no cambia: todo rol con
      `hr:write` o `cheques:write` (owner, admin, finance) ya tiene
      `transactions:write`; lo frena una denegación por usuario.
- La revisión previa de los cargos que baja `20261104102300` y de los
  planes de deuda que quedan por encima: en **Antes de promover**.
- [ ] **Después de promover** `20261104102300`, las NC de compras a cargo de
      empleado que quedaron con su asiento viejo por período cerrado (no
      quedan en `pending_journal_entries`: reabrir el período no las
      re-asienta solo): la consulta es la segunda del ítem siguiente.
      **N/A en producción (base sin compras/cheques/OP/préstamos/RRHH a
      2026-11-04).**
- [ ] Antes de aprobar `20261104102300`, el dueño revisa los cargos que baja
      el backfill (compras a cargo de empleado con NC):
      `select f.id, f.charged_employee_id, m.amount from purchase_invoices f left join employee_account_movements m on m.purchase_invoice_id = f.id where f.charged_employee_id is not null and exists (select 1 from purchase_invoices nc where nc.invoice_origin_id = f.id and nc.kind = 'nc' and nc.status = 'received');`.
      Y después, las NC que quedaron con su asiento viejo por período
      cerrado:
      `select nc.id from purchase_invoices nc join purchase_invoices f on f.id = nc.invoice_origin_id where nc.kind = 'nc' and nc.status = 'received' and f.charged_employee_id is not null and journal_entry_status('purchase_invoices', nc.id) = 'differs';`.
- [ ] Planes de deuda tipeados desde el total viejo de un cargo que bajó
      (al neto con `20261104095200`, o por una NC con `20261104102300`): la
      planilla sigue descontando hasta el total del plan. El dueño los
      revisa antes de promover (consulta en **Antes de promover**) y ajusta
      el plan a mano.
- [ ] Si el rol `diferencia_cambio` se asigna más adelante a otra cuenta,
      esa cuenta no tiene rubro de Gestión hasta que se lo den a mano.
- [ ] Una ND contra una compra a cargo de empleado no suma al cargo (va al
      gasto).
- [ ] Sin hacer (nits de la auditoría w1): el combustible importado no se
      liga a la factura del proveedor (W1 · S3 #20, sospecha); el embargo no
      entra en ninguna cifra de sueldos (#22, diseño); el percibido de una OP
      de compra a cargo de empleado sigue entero en anticipos aunque se le
      cargue el neto (ítem de arriba).
- [ ] Aprobar `20261104102000`–`20261104102400` con el deploy. Rollback: el
      código anterior lee los mismos datos; una rendición con el chofer se
      quita con `hr:write` solo y recibe el mensaje nuevo.
- [ ] No verificado contra una base real: las cuatro migraciones y los pgTAP
      `employee_charge_credit_notes`, `management_fx_loan_interest`,
      `tasks_iva_credit_only`, `driver_settlement_differences`.
