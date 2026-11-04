# Flota, pagos de sueldo y cuentas (2026-11-04, auditoría w7)

- [x] «Rentabilidad de flota» deja afuera los viajes cancelados.
- [x] «Viajes con margen negativo» usa el flete facturado (`v_trip_revenue`)
      y deja afuera los viajes cancelados. Pide también `shipments:read`.
- [x] Un mantenimiento con factura o movimiento vinculado exige el costo.
- [ ] Los mantenimientos que ya están guardados con comprobante vinculado y
      sin costo siguen contando $0 en el margen del camión hasta que alguien
      les cargue el costo (al editarlos, el formulario lo pide). Para
      encontrarlos:

      ```sql
      select id, vehicle_id, service_date
      from maintenance_records
      where cost is null
        and (purchase_invoice_id is not null or transaction_id is not null);
      ```

- [x] Pagos de un empleado: «Cuenta» se completa cuando las cuentas llegan
      tarde, y una lectura fallida de los pagos se muestra como error.
- [x] Cheques propios: sin cuentas se ocultan «Cargar cheque» y «Editar» y se
      dice por qué.
- [x] La tarjeta de cotización del AI CFO avisa un salto de más de un 30%.
- [ ] Manual de Tesorería (`docs/manual/treasury.html`, «Cheques propios»):
      falta decir que «Cargar cheque» y «Editar» piden `accounts:read`. Se
      dejó para no pisar la edición del mismo bloque de permisos que hace la
      tanda de docs de la auditoría w7.
