# Pendientes: NC/ND con un campo vacío que siguen a la factura y margen por cliente con cargas sin flete (auditoría w12)

Decisiones: `docs/decisions/2026-11-04-gestion-nc-nd-vacia-y-reparto-por-cliente-w12.md`.

- [x] **NC/ND rellenadas antes de `20261104194200`.** Si `20261104190201` se
      promueve antes que `194200`, una edición de la factura en ese tiempo
      puede llenar con el valor de la factura una cuenta o un centro que
      estaban vacíos a propósito. `194200` no lo corrige. Para revisarlas,
      buscá en `audit_events` las ediciones (`purchase_invoice.updated`) de
      facturas con NC/ND entre los dos deploys y recategorizá la NC/ND a mano.
      Si las dos migraciones salen juntas, no aplica. — ya no aplica: `190201` y `194200` llegaron juntas a producción (las notas de rollback w11 y w12 dicen que `production-latest` no tenía ninguna).
- [x] **pgTAP sin correr en esta sesión.** No había Supabase local, así que
      `supabase/tests/purchase_nc_nd_follow_keeps_empty_test.sql` y
      `supabase/tests/fleet_client_split_pending_test.sql` se escribieron sin
      ejecutarlos. Corren en CI. — hecho: corre verde en el job `database` de CI (`main` en `e239ee7`).
