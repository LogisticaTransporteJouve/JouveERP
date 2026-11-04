# Pendientes — NC/ND editada, factura duplicada y flete sin facturar (auditoría w9)

Decisiones: `docs/decisions/2026-11-04-gestion-nc-nd-edicion-insights-y-flota-ia-w9.md`.

- [ ] **NC/ND ya guardadas sin cuenta o sin centro.** `20261104160200` no
      las toca: se completan desde su origen la próxima vez que se guardan
      en un período abierto. Las que están en un período cerrado siguen
      vacías hasta que se reabra. Para verlas:
      `select n.id, n.fecha, n.account_id, n.cost_center_id, o.account_id as origin_account, o.cost_center_id as origin_center from public.purchase_invoices n join public.purchase_invoices o on o.id = n.invoice_origin_id where n.kind in ('nc', 'nd') and n.status = 'received' and ((n.account_id is null and o.account_id is not null) or (n.cost_center_id is null and o.cost_center_id is not null));`
- [ ] **Factura pasada a NC/ND sin leer el proveedor.** El formulario
      vacía los valores por defecto del proveedor solo si pudo leerlo (con
      `suppliers:read`). Si no, la NC/ND guarda la cuenta y el centro de la
      factura y el usuario los tiene que vaciar a mano.
- [ ] **«Posible factura duplicada» con 2 facturas.** Sin espaciado para
      comparar, dos facturas del mismo importe a 30 días o menos se marcan,
      aunque sean dos meses seguidos de un abono (por ejemplo 1/2 y 1/3).
- [ ] **`getClientMargin`** no trae el flete sin facturar: su ingreso es lo
      facturado por comprobante, no el flete de los viajes.
