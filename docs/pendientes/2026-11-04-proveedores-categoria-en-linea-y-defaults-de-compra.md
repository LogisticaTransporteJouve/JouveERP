# Proveedores: categoría en línea y defaults de compra (2026-11-04)

- [x] «Nueva categoría» al pie del select de Categoría del alta/edición de
      proveedor (también desde «Nuevo proveedor» dentro de una compra): un
      diálogo la crea, queda elegida y el resto del formulario no se toca.
      Solo con `suppliers:write`. Nombre de 1 a 60 caracteres, único sin
      importar mayúsculas.
- [x] Defaults de compra agrupados («Al cargar una compra de este proveedor,
      completar con:»), con Canal | Plazo de pago y Cuenta de gasto | Centro
      de costo; «Ninguno» en vez de «Sin default»; los selects abren hacia
      abajo, alineados con su campo.
- [x] Centro de costo `FLOTA_DZ` desactivado (`20261104120700`): DZ
      Instalaciones se retiró. Los pickers ya no lo ofrecen; un registro que
      lo usa lo sigue mostrando como «FLOTA_DZ Flota DZ (inactivo)».
- [ ] Candidatos al mismo «Nuevo …» en línea (sin cambiar todavía): centro
      de costo y cuenta de gasto en `CostTagSelect` (compras, movimientos de
      caja, conciliación bancaria, recategorizar, defaults del proveedor),
      cuenta de caja/banco en recibos y OP, y banco en cheques.
- [ ] El select de Categoría del proveedor lista solo las activas: un
      proveedor con una categoría desactivada la ve vacía al editar.
- [ ] La propuesta de gasto de la IA (`features/ai/registry/actions/expense-proposals.ts`)
      sigue mostrando «Centro actual (inactivo)» sin el nombre; ya puede
      usar `inactiveCostCenters`.
