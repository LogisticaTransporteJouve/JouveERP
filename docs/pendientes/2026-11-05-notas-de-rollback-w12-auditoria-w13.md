# Notas de rollback w12 (auditoría w13, 2026-11-05)

Auditoría w13, S7 F1–F2. Las migraciones ya están en `main` y no se editan.
Lo que dicen mal sus encabezados sobre un rollback a `production-latest` se
corrige acá. Sus ítems «Aprobar» están en
[`antes-de-promover.md`](antes-de-promover.md), que ya tiene el texto
corregido.

## Encabezados de migraciones mergeadas (w13 S7 F2)

- [ ] **`20261104194200_purchase_nc_nd_follow_keeps_empty`** (líneas 16-17).
      Dice "older code writes the same columns; the older function refills,
      as before". Un rollback de código deja la función nueva, y
      `updatePurchaseInvoiceAction` de `production-latest` no manda
      `account_id` ni `cost_center_id`. El trigger
      `purchase_nc_nd_follow_factura` corre solo cuando cambian esas dos
      columnas, así que no corre y no se rellena nada.
- [ ] **`20261104194201_fleet_client_split_pending`** (líneas 21-22). Dice
      "older code reads the same columns by name; a client row may show
      more cargas still to invoice, which it already reads as 'not final'".
      El `ai_fleet_margin` de `production-latest` no tiene
      `uninvoiced_shipments` (nace en `20261104170201`; las otras columnas
      `uninvoiced_*`, en `20261104160201`), y su código
      (`features/fleet-reports/actions/margin-actions.ts`,
      `features/ai/registry/actions/fleet.ts`) no la lee. Lee las demás
      columnas por nombre: el rollback no cambia nada.

## Consulta de control de `20261104194000` (w13 S7 F1)

La consulta leía `public.shipments` y `public.freight_settlements` en un
solo `union all`. `freight_settlements` nace en `20261103090000`, que
producción no tiene, así que la consulta entera fallaba ahí. En
`antes-de-promover.md` la mitad de cargas queda como consulta propia (corre
en producción) y la de liquidaciones pasa a un bloque aparte marcado N/A en
producción.

## Controles por permiso y lectura de canales (w13 S8 F1–F2, S4 F1, S6 F2)

Hecho en código, sin migración: ver
[`../decisions/2026-11-05-controles-de-escritura-por-permiso-w13.md`](../decisions/2026-11-05-controles-de-escritura-por-permiso-w13.md).
