# 2026-11-05 — Flota: ND acreditadas (auditoría w15)

Decisión: `docs/decisions/2026-11-05-flota-nd-acreditadas-auditoria-w15.md`.
Migración: `20261105120100`.

- [ ] **Mensajes de las guardas con una ND viva.** `guard_billed_shipment`,
      `guard_freight_settlement` y el aviso de «Cancelar» de una liquidación
      (`freight-settlements-page.tsx`) dicen «emití una nota de crédito por
      el total». Con una ND de flete viva, hay que acreditar también la ND,
      y el mensaje no lo dice. Cambiar el texto obliga a reemplazar las dos
      guardas. La consulta de control del último ítem dice si hoy hay algún
      caso.
- [ ] **Quien lee facturas pero no `late_interest_charges`** (hoy solo
      `fiscal_reader`, que no factura ni libera nada) lee una ND de intereses
      como si fuera de flete en `billing_invoice_is_void`, porque la regla
      corre como el usuario. Responde «no anulada», del lado seguro. Si
      algún día otro rol lee la regla, revisar.
- [ ] **Facturas que dejan de leerse anuladas** al aplicar `120100`: la
      consulta de control está en su ítem de `antes-de-promover.md`. Owner:
      revisá si alguna carga, período o liquidación de esas facturas ya se
      volvió a facturar. (Desde la auditoría w16, «Facturar flete» ya no
      vuelve a tomar la factura vieja: solo el último intento puede ser el
      vigente, `lib/source-invoice-key.ts`.)
