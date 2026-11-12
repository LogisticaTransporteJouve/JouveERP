# Préstamo en dólares sin vencimiento (2026-11-12)

Parte I del plan «DZ y sueldos» (E–I): préstamos **sin vencimiento** (solo interés mensual,
capital devuelto aparte), cuotas en dólares **pagadas desde una cuenta en pesos** a la cotización
del día, y el paso de datos de Simionato.

## I — Código

- [x] **PR — pago en pesos de una cuota en dólares.** Migración `20261112140000_loan_fx_payment`:
      columnas `loans.is_open_ended`, `loans.monthly_rate`, `loan_installments.kind`
      (`cuota` | `devolucion_capital`), `paid_amount_ars`, `paid_rate` (con sus checks);
      `pay_loan_installment` de 4 argumentos queda como wrapper de uno nuevo de 5
      (`p_account_amount`): misma moneda como antes; préstamo USD + cuenta ARS paga la cuota
      entera, el egreso en pesos y la cotización implícita a menos de ±20 % de la oficial (si hay
      una cargada); préstamo ARS + cuenta USD se rechaza. `adopt_loan_installment_payment` pasa a
      un core interno (sin grant) que acepta un egreso en pesos para una cuota en dólares.
      `build_transaction_journal_lines` (copiado del de `20261112110000`) convierte la cuota a su
      `paid_rate` cuando el egreso es en pesos y compara con `paid_amount`; el capital usa la
      moneda del préstamo (diferencia de cambio contra el desembolso). Guardas
      (`guard_loan_installment_paid`, `guard_loan_installment_payment`, `guard_loan`) suman los
      nuevos escritores.
- [x] **PR — préstamos sin vencimiento.** Migración `20261112140100_loan_open_ended`:
      `open_ended_loan_interest` (capital adeudado × % mensual), `extend_open_ended_loan` (siempre 3
      cuotas de interés que vencen hoy o después; service role y los pagos),
      `create_loan_core` con la rama sin vencimiento, `open_ended_loan_projection` (flujo de
      fondos), `repay_loan_capital` («Devolución de capital»: recalcula las cuotas siguientes y
      cierra el préstamo con capital 0 y nada pendiente), y para el paso de datos
      `convert_loan_to_open_ended` y `relink_loan_installment_payment` (solo service role; relink
      rechaza un préstamo fiscal). Cron diario `loans-open-ended-extend` (05:23 AR, un step por
      préstamo). UI: «Canal» en el alta (cualquier canal activo de la app principal, por defecto
      el fiscal), «Sin vencimiento (solo interés)», «Devolución de capital…», cuenta en pesos con
      «Cotización» y «Monto en pesos» al pagar, «Pagar cuota de préstamo…» en el menú de una
      línea de débito del extracto; el flujo de fondos proyecta el interés de cada mes; AI CFO
      (`proposeLoanInstallmentPayment` con `rate`, `getLoanDetail` con los campos nuevos). pgTAP
      en `loan_fx_open_ended_test`.
- [ ] Aprobar las dos migraciones con el deploy. Rollback: el código anterior llama la firma de 4
      argumentos (sin cambios para la misma moneda) e ignora las columnas nuevas; un préstamo sin
      vencimiento se ve como uno de N cuotas y el cron deja de extenderlo hasta volver a promover.
- [ ] Sin verificar en el navegador: los diálogos (pago con cotización, devolución de capital,
      selector de cuotas del extracto) se probaron con tests de componentes y de acciones, no con
      `/verify`.
- [ ] Diferido: editar la tasa o el capital después del alta, desembolsos adicionales, una
      herramienta de IA para la devolución de capital, cotización BNA, pagos parciales en pesos de
      una cuota en dólares, prorrateo del interés al devolver capital a mitad de mes.

## I6 — Datos de Simionato (después de promover; lo corre el owner)

Préstamo «Simionato Esperanza» (persona, CUIT 27437995309), USD 40.000, `jouve_internal`, 12
cuotas de USD 400 desde el 2026-10-02 (capital y fecha de inicio provisorios). La cuota 1 figura
«Pagada (antes de cargar)» sin movimiento; el pago real es el egreso interno en pesos de
$ 622.000 del 2026-10-02 (cuenta 5.4.1), conciliado con la línea de Galicia del 02/10 (leído el
2026-11-11: re-chequear).

En el SQL editor de producción, **una sola transacción**.

1. **Pre-chequeos (solo lectura).**

   ```sql
   -- El préstamo y su cuota 1.
   select l.id, l.description, l.lender, l.principal, l.currency, l.channel_id, l.status,
          l.first_due_date, l.is_open_ended
     from public.loans l
    where l.lender ilike '%simionato%' or l.description ilike '%simionato%';

   select i.id, i.number, i.due_date, i.amount, i.status, i.paid_outside, i.transaction_id,
          i.capital_amount, i.interest_amount
     from public.loan_installments i
    where i.loan_id = '<loan>'
    order by i.number;

   -- El egreso real: expense, ARS, jouve_internal, suelto y conciliado.
   select t.id, t.kind, t.currency, t.amount, t.channel_id, t.transaction_date,
          t.expense_account_id, public.transaction_is_loose(t) as loose,
          exists (select 1 from public.bank_statement_matches m where m.transaction_id = t.id) as matched
     from public.transactions t
    where t.channel_id = 'jouve_internal' and t.kind = 'expense'
      and t.transaction_date = '2026-10-02' and t.amount = 622000;

   -- La oficial del día tiene que estar a menos de ±20 % de 1555.
   select public.get_exchange_rate('USD', '2026-10-02');
   ```

   Esperado: cuota 1 `paid_outside = true`, `transaction_id` null; el egreso `loose = true`,
   `matched = true`; la oficial entre 1244 y 1866. Si el usuario corrige la fecha de inicio o el
   capital (provisorios), corregirlos antes (`guard_loan` lo permite mientras solo haya cuotas
   `paid_outside` pagadas).

2. **Conversión y vínculo.**

   ```sql
   begin;
   set local request.jwt.claims = '{"role":"service_role"}';

   select public.convert_loan_to_open_ended('<loan>', 1);
   select public.relink_loan_installment_payment('<cuota1>', '<tx>');

   insert into public.audit_events (event_type, actor_type, payload, target_resource_id)
   values
     ('loan.converted_open_ended', 'system', '{"monthly_rate": 1, "source": "I6"}', '<loan>'),
     ('loan.installment_payment_relinked', 'system',
      '{"installment_id": "<cuota1>", "source": "I6"}', '<tx>');

   -- Post-chequeos (abajo); si alguno falla: rollback;
   commit;
   ```

   Las dos acciones tienen su frase en el registro de auditoría (`features/audit/lib/registry.ts`).

3. **Post-chequeos.**

   ```sql
   -- Cuota 1: vinculada al egreso, 400 / 622.000 / 1555, solo interés.
   select i.transaction_id, i.paid_amount, i.paid_amount_ars, i.paid_rate,
          i.capital_amount, i.interest_amount, i.paid_outside
     from public.loan_installments i where i.id = '<cuota1>';

   -- Cuotas 2+: desglose 0 / 400; exactamente 3 pendientes que vencen hoy o después
   -- (las vencidas antes de hoy siguen pendientes).
   select i.number, i.due_date, i.status, i.capital_amount, i.interest_amount
     from public.loan_installments i where i.loan_id = '<loan>' order by i.number;

   select l.is_open_ended, l.monthly_rate, l.installments_count, l.status
     from public.loans l where l.id = '<loan>';

   -- Sin asiento (canal interno) y la línea del extracto sigue conciliada.
   select count(*) from public.journal_entries
    where source_table = 'transactions' and source_id = '<tx>';
   select count(*) from public.bank_statement_matches where transaction_id = '<tx>';
   ```

   Esperado: `(<tx>, 400.00, 622000.00, 1555.000000, 0.00, 400.00, f)`; cuotas 2+ con 0 / 400;
   3 pendientes futuras; `is_open_ended = t`, `monthly_rate = 1.0000`; 0 asientos; 1 conciliación.

- [ ] I6 corrido y post-chequeos OK (owner).
- [ ] Desde ahí, cada transferencia mensual «Trf Inmed Proveed · Simionato Esperanza» se paga con
      «Pagar cuota de préstamo…» en la línea del extracto de Galicia (interés del mes, en pesos a
      la cotización implícita).
