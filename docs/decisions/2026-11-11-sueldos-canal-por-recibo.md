# 2026-11-11 — Sueldos: el canal sale del recibo

**Decisión.** Los libros llevan el recibo de sueldo; el resto va a gestión. El
canal de cada pago de sueldo ya no lo elige el usuario: lo asigna la base. A
libros (canal fiscal, 5.3.1 Sueldos y jornales) va el neto del recibo menos el
embargo, sin pasar el total a pagar; lo demás (otros, extras, viáticos) va al
canal interno, sin asiento. No depende del método (transferencia o efectivo).
Los pagos llenan la parte de libros por fecha de pago; el que la cruza se parte
en un pago fiscal y una parte interna (`payroll_payments.split_parent_id`). El
reparto corre en SQL, desde triggers, cada vez que cambia un pago, un extra o un
insumo de la parte o del total (migraciones `20261111185100`..`185300`).

Cada empleado tiene una **modalidad** (`employees.pay_mode`): «por recibo» (el
recibo es el sueldo; vacaciones y SAC proporcional van dentro; los aumentos por %
no lo tocan) o «sueldo acordado» (se carga a mano y se aumenta por %; el recibo,
si lo hay, es la parte formal). Migración `20261111185000`.

Cuando las deudas y el teléfono superan a los extras y los viáticos, lo pagado a
libros queda debajo del recibo. Al cerrar la planilla, esa diferencia se asienta
como sueldo contra la deuda del empleado (Debe Sueldos y jornales / Haber
Anticipos al personal); reabrir la anula. Gestión no la cuenta dos veces: ya la
cuenta como el descuento de planilla de la cuenta corriente.

Un movimiento conciliado con el extracto se reescribe solo con dos primitivas de
Tesorería (`split_matched_movement`, `merge_matched_movement`) que mantienen el
total conciliado de la línea. Un cambio que movería una parte fiscal en un mes
contable cerrado se rechaza. Las planillas cerradas antes de este cambio
conservan los canales elegidos.

**Por qué.** El dueño decidió (A1–A10) que los libros lleven exactamente el
recibo del liquidador y que todo lo demás quede para gestión; elegir el canal a
mano en cada pago no lo garantizaba y el reparto por método (D5) mezclaba las dos
cosas.

**Descartado.**
- Repartir en TypeScript: un pago puede volverse dos movimientos y el vínculo
  pago → movimiento es del trigger SQL; dos lugares que reparten se separan.
- Un pago con dos movimientos: rompe el 1-a-1 pago ↔ movimiento del que dependen
  los guards y la conciliación.
- Rechazar pagos mientras no haya recibo: se paga antes de que llegue el recibo;
  sin recibo todo va a gestión hasta cargarlo.
- Guardar los canales en `hr_settings`: hay un solo par de canales; nombrarlos en
  una función SQL alcanza.
- Rehacer las planillas de septiembre y octubre de 2026: esos haberes se corrigen
  con un paso de datos aparte (pendiente).
- Una excepción `is_payroll` en el guard de conciliados: ataría Tesorería a
  Sueldos; las primitivas son neutras y verifican la línea.
- Parte de libros = recibo − lo pagado: asentaría un saldo impago como deuda del
  empleado. La diferencia que se asienta es estructural (lo que descuenta la
  planilla), calculada con el mismo tope que el reparto.
- Que la transferencia sugerida sea igual a la parte de libros: queda como
  sugerencia de método (`suggestedSplit`), aparte; se unifica si el dueño lo pide.
