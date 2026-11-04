# 2026-11-02 — Dashboard "Hoy y esta semana" (D12)

**Decisión.** Arriba de los widgets del dashboard, una sección fija (no
personalizable) con tres tiles, cada uno solo para quien lee su módulo:

- **Vencimientos** (`tasks:read`): las tareas abiertas vencidas o que vencen en
  los próximos 7 días, de Tareas (que ya junta pagos a proveedores, cobranzas,
  cuotas, cheques propios y documentos con las manuales y recurrentes). Una
  tarea de un módulo que el usuario no lee no se muestra.
- **Viajes de hoy** (`trips:read`): los no cancelados de la fecha, con camión,
  chofer, clientes de sus cargas y estado.
- **Papeles por vencer** (`fleet_documents:read` para camiones y choferes,
  `hr:read` para empleados): vencidos o que vencen en 30 días, agrupados por
  titular. Un papel ya renovado (otro más nuevo del mismo tipo y titular) no
  cuenta, igual que en Tareas.

Un tile que no se pudo leer lo dice; no se muestra vacío. El asistente lo lee
con `getTodayOverview` (vencimientos con `getTasks`).

**Por qué fija.** Es lo primero que se mira al entrar; como widget, quien ya
guardó su layout no la vería hasta agregarla a mano.

**Pendiente.** El tile de km mensual pendiente espera a `vehicle_km_readings`,
que todavía no está en `main`.
