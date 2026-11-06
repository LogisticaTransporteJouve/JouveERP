# Importador y sueldos y viajes históricos (2026-11-03, roadmap 5.1 + 5.2)

- [x] **Importador** (Admin › Importador, `/admin/imports`, owner y admin):
      .xlsx o .csv → tipo → columnas → vista previa con errores y avisos por
      fila → importar en una transacción. Clientes, proveedores, empleados
      (con su ficha de chofer si el puesto es chofer) y vehículos. Cada
      corrida queda registrada (archivo, hash, quién, filas importadas,
      salteadas y con error) y se puede **deshacer** si nadie editó ni usa
      sus filas. Reimportar el mismo archivo no duplica.
- [x] **Sueldos y viajes históricos**: tablas propias, solo de referencia, en
      las pestañas del importador. No generan asientos, pagos, cuenta
      corriente, extras de chofer ni facturas, y no entran en Gestión, libros
      fiscales, reportes ni IA.
- [x] Aprobar la migración `20261103110000_import_runs` junto con el deploy
      (después de las de 4.4–4.6): sin ella falla la página del importador.
      Rollback: el código anterior ignora `import_run_id` y las tablas
      nuevas; lo importado queda como un alta normal. — hecho: aplicada en producción (está en `production-latest`, `bbe08b38`).
- [x] pgTAP verde en CI (stack fresco: `import_runs_test.sql`); sin verificar contra datos de
      producción. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).
- [x] Importar tarifas, préstamos, cheques en cartera, saldos iniciales de
      clientes y extractos (5.3, 5.4): ver la sección siguiente.
- [ ] Mostrar los históricos donde ayuden (ficha del empleado, del vehículo
      o del cliente) y sumarlos a Gestión como serie separada si hace falta;
      hoy solo se ven en el importador.
