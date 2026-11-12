# 2026-11-12 — Se quita «Pagos recurrentes»

**Decisión.** A pedido del owner, el módulo **Pagos recurrentes** sale de la app,
como los módulos que quitó el PR #544: sin página `/recurring-payments`, sin
entrada en Tesorería, sin exportación, sin permiso `recurring_payments:*` y sin
la herramienta `getRecurringPayments` del asistente.

- **Lo que dejaban de mostrar.** El flujo de caja (página, `getCashFlow` y el
  insight proactivo) ya no proyecta pagos recurrentes, y la tarjeta
  **Vencimientos** del dashboard (y `getUpcomingDueDates`) ya no los lista: un
  pago que nadie puede ver ni editar no tiene que mover una proyección.
- **Los alquileres, servicios y demás** se pagan como siempre, con una orden de
  pago o un egreso de Caja; lo que se proyecta sale de los documentos pendientes,
  los cheques y los préstamos.
- **La base no cambia.** La tabla `recurring_payments` queda (un rollback al código anterior
  sigue andando); se borra en una migración de contrato
  ([pendiente](../pendientes/2026-11-12-quitar-pagos-recurrentes.md)).
- **Auditoría.** Los eventos `recurring_payment.*` ya registrados se siguen
  leyendo en Auditoría, sin enlace.
