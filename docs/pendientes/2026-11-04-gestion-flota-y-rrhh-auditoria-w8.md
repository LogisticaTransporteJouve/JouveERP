# Pendientes — Gestión, flota y RRHH (auditoría w8)

- [x] Una NC/ND de compra con cuenta propia hereda el centro de su origen
      (`20261104150200`).
- [x] Una NC/ND escaneada no se guarda con la cuenta y el centro que la IA
      sugirió para una factura.
- [x] «Margen por camión» cuenta la NC/ND de una compra vinculada a una
      carga de combustible o un service (`20261104150201`).
- [x] `getTrips` (AI CFO): ingreso de `v_trip_revenue`, sin cancelados.
- [x] «Viajes con margen negativo» no evalúa viajes con cargas sin facturar.
- [x] Lecturas fallidas en vacaciones, extras de sueldo, detalle de préstamo
      y rendición de chofer.
- [ ] **N/A en producción (base sin compras a 2026-11-04).** NC/ND ya
      cargadas con cuenta propia y sin centro, cuyo origen tiene centro:
      `20261104150200` no las toca. Si aparecen, se corrigen con
      «Recategorizar» desde la NC/ND. Para listarlas:
      `select nc.id from public.purchase_invoices nc join public.purchase_invoices o on o.id = nc.invoice_origin_id where nc.kind in ('nc', 'nd') and nc.cost_center_id is null and o.cost_center_id is not null;`
