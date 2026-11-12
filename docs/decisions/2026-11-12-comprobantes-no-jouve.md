# 2026-11-12 — Comprobantes que no corresponden a Jouve

**Decisión.** Las facturas de venta y de compra fiscales llevan la marca
«Corresponde a la actividad de Jouve» (`is_operational`, tildada por defecto).
Destildada, el comprobante sigue en el Libro IVA, en la cuenta corriente, en
los saldos y en el aging igual que hoy, pero **no cuenta como ingreso ni como
gasto**.

- **Asiento.** El neto (y, en una NC de venta en dólares, la diferencia de
  cambio) va a **«Cuenta particular de socios»**, un activo bajo 1.1 con rol
  `cuenta_particular_socios`, en lugar de la cuenta de ventas o de gastos. El
  IVA y las percepciones quedan igual: el crédito o débito fiscal es de la
  empresa. Una compra a cargo de un empleado sigue yendo a Anticipos al
  personal.
- **Por qué un activo.** Lo que la empresa paga o cobra por cuenta de un socio
  es un saldo con ese socio, no un resultado. Se descarta una cuenta de
  resultado aparte (seguiría en el estado de resultados) y sacar el comprobante
  del Libro IVA (es un comprobante real del CUIT).
- **Lecturas.** El resultado de gestión (devengado y percibido), los resúmenes
  de ventas y compras del asistente, los insights, el reporte por categoría y
  el resumen por canal lo dejan afuera. Lo que lee el diario (gastos por
  categoría, resumen de DZ) ya no ve una línea de resultado.
- **Cambiar la marca** vuelve a asentar el comprobante. No toca el Libro IVA,
  así que se puede cambiar con el período de IVA cerrado, pero no si el asiento
  está en un período contable cerrado: ahí se rechaza con un mensaje.
- **NC/ND.** Sin la marca explícita, una nota sigue a su comprobante de origen.
- **Comprobantes de ARCA** (importación y aceptación masiva) entran como de
  Jouve; se corrigen después desde el comprobante.

Migraciones `20261112170000_coa_role_cuenta_particular_socios` y
`20261112170100_non_operational_documents`.
