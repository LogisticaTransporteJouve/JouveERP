# Quitar «Pagos recurrentes»: contrato en la base (2026-11-12)

Decisión en [`decisions/2026-11-12-quitar-pagos-recurrentes.md`](../decisions/2026-11-12-quitar-pagos-recurrentes.md).
La app ya no lee ni escribe `recurring_payments`, salvo Auditoría (nombra el pago
de un evento viejo: `features/audit/lib/resolve-entities.ts`).

## Contrato (después de promover, un release más tarde)

A borrar en una migración de contrato cuando el código que los usaba no pueda volver:

- [ ] Tabla `public.recurring_payments` con sus 4 políticas RLS
      (`recurring_payments select/insert/update/delete`), el trigger
      `recurring_payments_set_updated_at`, el índice `recurring_payments_active_due_idx`,
      el check `recurring_payments_end_after_next` y las FKs a `accounts`,
      `invoicing_channels` y `cost_centers`.
- [ ] Los triggers `guard_channel_active` sobre `recurring_payments.channel_id`
      (`20261031162740_channel_active_guard`): se van con la tabla.
- [ ] La rama `'pago_recurrente'` de `public.dz_open_items()` (herramienta del owner
      en el editor SQL; con la tabla borrada la función falla, así que se reescribe
      en la misma migración).
- [ ] Filas de `user_permission_denies` con `recurring_payments:read` /
      `recurring_payments:write`: `resolveAccess` ya las ignora (no son permisos);
      borrarlas.
- [ ] Antes de borrar, sacar el resolver `recurring_payment` de
      `features/audit/lib/resolve-entities.ts` (los eventos viejos quedan con el
      nombre genérico «un pago recurrente» del registry).

## Mientras tanto

- Nada en SQL sigue generando algo visible: `sync_automatic_tasks` no lee
  `recurring_payments` y ningún cron de Inngest los toca.
- La FK `recurring_payments.cost_center_id` es `on delete restrict`: un centro de
  costo usado por un pago recurrente viejo no se puede borrar (la app dice que se
  desactive en su lugar). Se resuelve con el contrato.
- Rollback: el código anterior vuelve a mostrar el módulo con las filas que haya;
  no hay schema nuevo que tolerar.
