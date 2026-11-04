# NC de ARCA vinculadas por total y reabrir liquidaciones (2026-11-04)

Auditoría w11 (s1 F1 y F2, s4 F1). Pendientes:
`docs/pendientes/2026-11-04-fiscal-nc-por-total-y-liquidaciones-auditoria-w11.md`.

## NC sin `CbtesAsoc`

- **Qué:** una NC vieja de ARCA, sin comprobante asociado, se vincula a la
  factura más reciente del mismo punto de venta, letra, receptor, moneda y
  total, hasta su fecha, **solo si** las NC ya vinculadas a esa factura le
  dejan lugar para el total completo de la NC. Si no hay ninguna así, la NC
  queda sin origen. Una ND sigue tomando la más reciente (suma, no resta).
- **Por qué:** sin el control, dos NC del mismo total caían en la misma
  factura. Esa factura quedaba con saldo negativo, fuera del aging, y otra
  factura del cliente seguía «abierta» con una deuda que no existe.
  Guardarla sin origen es lo que ya se hacía para una NC sin factura: el
  aging reparte su crédito entre las facturas más vencidas del mismo canal y
  moneda.
- **El lugar** se mide como en `invoice_open_amount`: total menos las NC en
  `draft`, `emitting` o `emitted`. No se restan los recibos: una NC sobre una
  factura cobrada puede ser una devolución y su origen sigue siendo esa
  factura.
- **Filas existentes:** no se tocan. La consulta del ítem de aprobación las
  lista y el dueño decide.

## Monedas que no son pesos ni dólares

El aging, los recibos y el reparto de NC solo modelan `PES` y `DOL`. Un
comprobante de ARCA en otra moneda no se importa: queda como hueco con un
aviso en los logs y la conciliación lo muestra. No se agregó un `check` en
`invoices` hasta confirmar qué monedas guarda producción.

## Reabrir una liquidación cerrada

- **Qué:** `enforce_payroll_period_immutability` rechaza (42501) que un
  usuario sin rol owner o admin saque un período de `closed`. El service
  role pasa. Una entry o un extra no se pasan de un período cerrado a otro.
- **Por qué:** `hr:admin` vivía solo en la action, y la RLS de
  `payroll_periods` deja actualizar a finance. Así finance podía reabrir por
  PATCH, sin auditoría, y el trigger de cuentas de empleados borraba los
  descuentos del período.
- **Trigger y no RLS:** finance cierra (`hr:write`) con el mismo UPDATE, y
  una política no ve el valor anterior de `status`.
- La función pasa a `SECURITY DEFINER` con `search_path = ''`, así que lee
  el período sin depender de la RLS de quien llama. Todas sus excepciones
  llevan `hint = 'jouve_guard'`.
