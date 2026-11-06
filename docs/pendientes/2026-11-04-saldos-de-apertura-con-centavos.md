# Saldos de apertura con centavos (2026-11-04, auditoría w4)

- [x] Ajustar saldo de clientes, proveedores y cuentas (Caja/banco): el campo
      usa `MoneyInput` y se precarga en es-AR ("1.234,56"). Antes mostraba
      "1234.56" y guardar sin tocar nada fijaba un saldo 100 veces mayor
      (123.456). El de cuentas acepta negativo (`allowNegative`); el de
      clientes y proveedores muestra el signo y rechaza el negativo en vez de
      guardarlo positivo.
- [x] Mismo error al crear y al editar, con el parser del server: el
      formulario mandaba un texto con punto decimal ("1234.56") y el server
      lo leía en es-AR (123456). Nuevo movimiento y transferencia, editar
      movimiento, saldo inicial de una cuenta (acepta negativo), cheque
      emitido y cheque recibido a mano: el campo es `MoneyInput` y el
      formulario manda el número ya leído con `parseArAmount`.
- [x] Mismo error dentro del cliente: el monto de una retención del recibo
      (un `type="number"` leído con `parseArAmount`) y la cantidad y el
      precio unitario de los ítems de una compra (la línea se calculaba con
      el parser es-AR y el ítem se mandaba con `Number`, también al
      precargar una compra existente o un documento escaneado) usan
      `MoneyInput`; los ítems con 4 decimales (`numeric(15, 4)`).
- [x] Venta de cheques: intereses y comisiones se leían con
      `Number(v.replace(",", "."))`, así que "1.500" se guardaba 1,50.
      Ahora `MoneyInput` + `parseArAmount`.
- [x] Cotizaciones: "Cargar cotización USD" leía el texto con
      `Number(v.replace(",", "."))`, así que "1.180" se guardaba 1,18 y
      pasaba el control `> 1`. Ahora `MoneyInput` con 6 decimales
      (`numeric(18, 6)`) y `parseArAmount`. La cotización de recibos, OP,
      compras y NC/ND también es `MoneyInput` (4 decimales,
      `numeric(10, 4)`), se precarga en es-AR (edición, cotización cargada
      del día y documento escaneado) y se lee con `parseUsdRate`.
- [x] Sin migraciones. Rollback: el código anterior vuelve al campo sin
      formato; los saldos ya guardados no cambian. — ya no aplica: el cambio ya está en `production-latest` (`bbe08b38`).
