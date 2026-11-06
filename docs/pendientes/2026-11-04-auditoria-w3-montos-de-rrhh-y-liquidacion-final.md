# Auditoría w3: montos de RRHH y liquidación final (2026-11-04)

- [x] Todos los montos de RRHH (alta y edición del empleado: sueldo base,
      viático y retribución formal; celdas de la planilla; pagos individuales
      y masivos; adelantos y devoluciones; movimientos y planes de la cuenta
      corriente; embargos por monto; tarifas y extras de viajes; liquidación
      final) usan `MoneyInput` (`components/money-input.tsx`): texto con
      formato es-AR mientras se tipea, como recibos y OP. Un punto tipeado se
      ve descartado ("1500.50" se muestra 150.050) en vez de guardar 100
      veces el monto sin avisar, y el sueldo guardado se ve al editar.
      Cambiar un embargo entre monto y porcentaje vacía el valor ("1.500"
      son $1500 pero 1,5 %).
- [x] `parseArAmount` devuelve null ante basura ("12abc", "1e3"); todas sus
      llamadas ya trataban el null como inválido.
- [x] Liquidación final: el sueldo sale de `employee_salary_for_month` del mes
      de baja (un aumento cargado para el mes siguiente no cuenta). Sin sueldo
      base, usa la línea del mes anterior, nunca la del mes de baja que la
      propia liquidación pisa: volver a cargarla da las mismas cifras.
- [x] Impuestos: una DDJJ de IVA que solo deja saldo a favor no se marca
      Vencido (lista y calendario), no ofrece "Pagar" ni "Vincular movimiento
      existente", y la IA no la cuenta como vencida ni por vencer.
- [ ] Liquidación final de alguien sin sueldo base y sin planilla del mes
      anterior: sugiere $0 de sueldo, como antes; se tipea a mano.
- [x] Sin migraciones. Rollback: el código anterior vuelve a los inputs sin
      formato y a leer la línea del mes de baja; no hay datos que deshacer. — ya no aplica: el cambio ya está en `production-latest` (`bbe08b38`).
