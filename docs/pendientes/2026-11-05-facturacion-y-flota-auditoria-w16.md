# 2026-11-05 — Facturación y flota (auditoría w16)

Decisión: `docs/decisions/2026-11-05-facturacion-y-flota-auditoria-w16.md`.
Migraciones: `20261105130000` (cadena de notas) y `20261105130001`
(combustible del viaje).

- [ ] **Notas sobre notas desde la app.** `issueFiscalInvoiceAction` solo
      rechaza una NC sobre una NC. Acepta una ND sobre una NC, que es la
      forma de AFIP de revertir una NC, y la regla ahora la lee bien. Si
      algún día la app ofrece emitirla (hoy los botones NC/ND aparecen solo
      en facturas), mostrar en la factura la cadena entera.
- [ ] **Cadenas de más de 10 notas.** `billing_invoice_live_amount` no lee
      más abajo. Ningún caso real llega a tanto. Si la consulta de control
      de `20261105130000` muestra una cadena profunda, revisar.
- [ ] **«Flota no asignada» negativa en `getClientMargin`.** Pasa cuando
      un viaje del rango tiene combustible cargado antes del rango. La cifra
      sigue cerrando con el costo de los vehículos, pero puede leerse raro.
      Si molesta, mostrar aparte ese combustible.
