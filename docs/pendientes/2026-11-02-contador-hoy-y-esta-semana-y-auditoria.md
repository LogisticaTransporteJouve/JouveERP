# Contador, "Hoy y esta semana" y auditoría (2026-11-02, roadmap 1.9–1.11)

- [x] **Paquete del mes** (`/accounting/package`, `accounting:read`, también
      para `fiscal_reader`): checklist del período (cerrado, asientos
      pendientes y faltantes, comprobantes fiscales sin autorizar, CAEA sin
      informar, compras fiscales sin letra) y las descargas juntas: Libro IVA
      Ventas/Compras (PDF, Excel y TXT), libro diario, libro mayor y balance de
      sumas y saldos (PDF y Excel por `/api/export`). Tool
      `getMonthlyPackageStatus`.
- [x] **Dashboard "Hoy y esta semana"** (D12): vencimientos de Tareas, viajes
      de hoy y papeles por vencer, cada tile con su permiso. Tool
      `getTodayOverview`.
- [x] **Admin › Auditoría** (D13): lista, filtros, CSV, detalle con datos
      sensibles enmascarados, "Historial" en el detalle del comprobante,
      retención de 400 días (`audit-retention`), tool `getAuditEvents` y test
      de cobertura de `logAudit`.
- [ ] Aprobar la migración `20261103030000_audit_log` junto con el deploy: sin
      ella fallan el filtro de acciones, el "Historial" no tiene índice y el
      cron de retención falla.
- [ ] Tile de km mensual en "Hoy y esta semana" (la tabla
      `vehicle_km_readings` ya está en `main`).
- [ ] Un ZIP con todo el paquete (hoy son botones separados: no hay librería
      de zip en las dependencias de runtime).
- [ ] "Historial" en el resto de las páginas de detalle (recibos, OP,
      compras, clientes, proveedores): el componente `RecordHistory` ya está.
