# Pendientes — Lecturas fallidas y notas de rollback (auditoría w11)

Decisiones: `docs/decisions/2026-11-04-lecturas-fallidas-y-vista-previa-w11.md`.

## Encabezados de migraciones mergeadas que no se editan

Estas migraciones ya están en `main`. Su ítem «Aprobar» en
[`antes-de-promover.md`](antes-de-promover.md) ya dice lo correcto. El
encabezado del SQL no:

- [x] **`20261104170200_recategorize_keeps_empty_nc_nd`.** Dice "older code
      calls the same RPC". `recategorize_expense` se crea en
      `20261104060000`, después de `production-latest`, y ese código no
      tiene «Recategorizar». El rollback no cambia nada. — ya no aplica: `production-latest` (`bbe08b38`) ya tiene esa migración y su código: un rollback no vuelve al código que describe la nota.
- [x] **`20261104170201_fleet_pending_by_count`.** Dice que el
      `getVehicleEconomics` anterior listaría el grupo `none` como un
      vehículo. `production-latest` no tiene `getVehicleEconomics`. Su único
      lector de `ai_fleet_margin` es la herramienta del asistente
      `getFleetMargin` (`getFleetMarginAction`). Por vehículo, esa
      herramienta muestra una fila «Sin vehículo», y sus totales (grupos,
      ingreso, neto) incluyen esos viajes. Es cosmético. — ya no aplica: `production-latest` (`bbe08b38`) ya tiene esa migración y su código: un rollback no vuelve al código que describe la nota.

## Sin verificar

- [ ] **Smoke AFIP (`tests/e2e/invoices-emit.spec.ts`).** Ahora hace clic
      en «Guardar», no en «Emitir y solicitar CAE», que ya no existe. No se
      corrió porque necesita `RUN_AFIP_E2E=1`, credenciales de
      homologación e Inngest local. CI lo saltea.
