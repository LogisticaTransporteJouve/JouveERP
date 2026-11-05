# 2026-11-05 — Lecturas fallidas y reclamos del escaneo: lo que queda (auditoría w16)

Decisión: [`2026-11-05-lecturas-y-reclamos-de-escaneo-w16.md`](../decisions/2026-11-05-lecturas-y-reclamos-de-escaneo-w16.md).

- [ ] **Toma vieja de un recibo, OP o factura de venta escaneados.** Hoy se
      puede descartar, pero no reintentar: no hay forma de saber si el alta
      corrió. Para reintentarla haría falta marcar la toma antes del alta
      (por ejemplo, un id de intento guardado en el borrador y en el recibo,
      la OP o la factura) y liberarla solo si no hay entidad con ese id.
- [ ] **Otras opciones de la página de Pallets.** Depósitos, productos y
      áreas siguen cayendo a una lista vacía si su lectura falla, igual que
      vehículos y choferes en Combustible, Mantenimiento, Vencimientos de
      flota y Viajes (auditoría w16-s8 F3).
- [ ] **`PosSelect` sin «Reintentar».** Dice «No se pudieron cargar los
      puntos de venta.» pero no ofrece reintentar, como sí hacen ahora los
      diálogos de factura.
