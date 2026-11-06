# Pendientes — Margen por camión pendiente, NC/ND que siguen a la factura editada y escaneo por permisos (auditoría w11)

Decisiones: `docs/decisions/2026-11-04-gestion-margen-por-camion-nc-nd-y-escaneo-w11.md`.

- [x] **Facturas de compra editadas en «Modificar» antes de `20261104190201`**
      con NC/ND que quedaron en la cuenta o el centro viejos. `190201` no las
      corrige, y «Recategorizar» la factura tampoco, porque la NC/ND ya no
      tiene el valor actual de la factura. Para verlas:
      `select f.id as factura, n.id as nota, f.account_id, n.account_id as nota_account, f.cost_center_id, n.cost_center_id as nota_cc from public.purchase_invoices f join public.purchase_invoices n on n.invoice_origin_id = f.id and n.kind in ('nc', 'nd') and n.status = 'received' where f.kind = 'factura' and f.status = 'received' and (n.cost_center_id is distinct from f.cost_center_id or (n.account_id is distinct from f.account_id and n.charged_employee_id is null));`
      Una diferencia puede ser a propósito (una NC/ND con su propio valor):
      se revisa una por una y se recategoriza la NC/ND a mano. — ya no aplica: el «Modificar» de producción anterior a `190201` no mandaba cuenta ni centro (nota de `190201` en las notas de rollback w11) y `190201` ya está en producción.
- [ ] **El cambio de la factura no audita las NC/ND que movió.** La
      auditoría `purchase_invoice.updated` registra los campos de la
      factura; las NC/ND se mueven por la regla, sin un evento propio.
      «Recategorizar» sí las lista (`adjustment_ids`).
- [ ] **Escaneo: una denegación agregada después del escaneo** no borra los
      matches ya guardados en `ai_document_extractions.matches`. Se podría
      filtrar también al leer (`listExtractionsAction` /
      `getExtractionAction`).
- [ ] **Escaneo: la sugerencia de cuenta de gasto** (`matches.expense`) sigue
      leyendo el plan de cuentas y los centros sin mirar el permiso
      `accounting:read`; quien escanea una compra también los ve en el
      formulario de alta.
- [x] **pgTAP sin correr en la sesión.**
      `supabase/tests/vehicle_margin_pending_cargas_test.sql` y
      `supabase/tests/purchase_nc_nd_follow_factura_test.sql` se escribieron
      sin Supabase local, igual que los cambios en
      `purchase_nc_inherit_account_test.sql` y
      `purchase_nc_inherit_on_edit_test.sql` (desactivan el trigger nuevo
      para reproducir una fila de antes). Corren en CI. — hecho: corre verde en el job `database` de CI (`main` en `e239ee7`).
