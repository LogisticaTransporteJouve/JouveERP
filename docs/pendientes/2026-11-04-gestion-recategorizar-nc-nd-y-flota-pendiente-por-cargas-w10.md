# Pendientes — Recategorizar una NC/ND a vacío y flota pendiente por cargas (auditoría w10)

Decisiones: `docs/decisions/2026-11-04-gestion-recategorizar-nc-nd-y-flota-pendiente-por-cargas-w10.md`.

- [x] **NC/ND recategorizadas a vacío entre `160200` y este cambio.** El
      trigger les puso el valor del origen y la auditoría
      (`expense.recategorized`) registró vacío. `20261104170200` no las
      corrige. Para verlas (la auditoría dice vacío y la fila no lo está):
      `select a.ts, a.target_resource_id, a.payload from public.audit_events a join public.purchase_invoices p on p.id::text = a.target_resource_id::text where a.event_type = 'expense.recategorized' and a.payload ->> 'source' = 'purchase_invoices' and p.kind in ('nc', 'nd') and ((a.payload ->> 'cost_center_id' is null and p.cost_center_id is not null) or (a.payload ->> 'expense_account_id' is null and p.account_id is not null)) order by a.ts desc;`
      Si la última recategorización de la fila es la que aparece, hay que
      volver a recategorizarla a vacío. En producción no hay compras al
      2026-11-04. — ya no aplica: `160200` y `170200` llegaron juntas a producción (las notas de rollback w11 dicen que `production-latest` no tenía «Recategorizar»).
- [ ] **Una NC/ND recategorizada a vacío y después editada en «Modificar»**
      toma el valor del origen, porque en el formulario el vacío es «La/El
      del comprobante de origen». Para dejarla vacía hay que volver a
      recategorizarla.
- [ ] **«Posible factura duplicada» con 3 o 4 facturas en días seguidos**
      se sigue marcando, aunque sea un abono diario recién empezado.
- [ ] **Una carga que nunca se va a facturar** (sin cargo, o cargada por
      error y no anulada) deja su viaje como «pendiente de facturar» para
      siempre: no entra en «Viajes con margen negativo». Hay que anularla
      para que el viaje se evalúe.
- [ ] **`get_vehicle_margin` con 500 camiones con movimientos y algún viaje
      sin vehículo** ahora rechaza el rango (el grupo `none` ocupa un lugar
      en la página de `ai_fleet_margin`). Antes el tope era 500 camiones.
- [x] **pgTAP sin correr en la sesión.**
      `supabase/tests/recategorize_nc_nd_keeps_empty_test.sql` y
      `supabase/tests/fleet_pending_by_count_test.sql` se escribieron sin
      Supabase local. Corren en CI. — hecho: corre verde en el job `database` de CI (`main` en `e239ee7`).
