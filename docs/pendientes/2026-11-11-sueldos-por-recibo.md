# Sueldos por recibo (2026-11-11)

Canal automático por recibo, modalidad del empleado y parte del recibo que salda
deuda (decisión [`2026-11-11-sueldos-canal-por-recibo`](../decisions/2026-11-11-sueldos-canal-por-recibo.md)).

- [x] **PR — sueldos por recibo.** Migraciones `20261111185000_employee_pay_mode`,
      `20261111185100_reconciled_movement_primitives`,
      `20261111185200_payroll_channel_split` y `20261111185300_payroll_receipt_gap`.
- [ ] Aprobar las migraciones con el deploy. Rollback: el código anterior manda
      `channel_id` y el trigger lo pisa; lista la parte interna como un pago más
      (editarla se reparte de nuevo, fijar `split_parent_id` se rechaza); el diario
      muestra la parte del recibo que salda deuda como «Otro origen».
- [ ] Después de promover, en producción: poner la modalidad «por recibo» a
      Cabral, Casco, Olmedo, Ramírez, Sánchez y Villagra, y repartir los pagos de
      las planillas abiertas (un update sin cambios de sus pagos llega al trigger).
- [ ] **Haberes de septiembre y octubre de 2026 (falta el dato).** Se cargaron
      desde el extracto de Galicia como egresos de sueldo en `jouve_fiscal`
      (~21,2 M y ~27,1 M) y no hay planillas de esos meses. Hace falta el neto del
      recibo de cada empleado de cada mes para partir cada egreso en la parte de
      libros (recibo − embargo) y la de gestión, como paso de datos con las
      primitivas de Tesorería si los egresos están conciliados.
