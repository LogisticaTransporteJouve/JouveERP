# 2026-11-04 — Saldos de apertura en `MoneyInput`, con signo en cuentas

**Decisión.** Los diálogos de saldo de apertura de clientes, proveedores y
cuentas usan `MoneyInput` y precargan con `signedAmountToInput`. `MoneyInput`
acepta `allowNegative` (formatea con `formatSignedAmountInput`, que conserva
un "-" inicial); solo el de cuentas lo usa, porque el saldo de una cuenta
puede ser negativo y el de clientes y proveedores no (`check >= 0`).

**Por qué.** `String(1234.56)` precargaba "1234.56" y `parseArAmount` lo leía
como 123456. `amountToInput` descarta el signo: precargar con él un saldo
negativo lo guardaría positivo sin aviso.

Todo formulario cuyo monto lee un preprocess es-AR del server
(`moneyAmountPreprocess`, `openingBalancePreprocess`, el `amount` de
cheques emitidos) tipea en `MoneyInput`, valida con `positiveArAmountField`
(`lib/validation/common.ts`) y manda el número ya leído con `parseArAmount`,
nunca el texto. `MoneyInput` acepta `decimals` para los ítems de compra
(`numeric(15, 4)`) y las cotizaciones: `COTIZACION_DECIMALS` (4) en
comprobantes, recibos y OP, 6 en la tabla de cotizaciones.

**Descartado.** Hacer que `amountToInput` conserve el signo: tiene unas 50
llamadas que hoy reciben montos no negativos y no se revisaron una por una.
Un selector de signo aparte en cuentas: un "-" tipeado es lo que el usuario
espera y `parseArAmount` ya lo lee.
