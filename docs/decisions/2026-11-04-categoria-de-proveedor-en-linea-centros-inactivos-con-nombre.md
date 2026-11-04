# 2026-11-04 — Categoría de proveedor en línea; centros inactivos con nombre

**Decisión.** El select de Categoría del proveedor
(`SupplierCategorySelect`) termina en «Nueva categoría», que abre un `Dialog`
centrado anidado y llama a `createSupplierCategoryAction`, la misma acción
de Proveedores › Categorías (`suppliers:write`). La acción rechaza un nombre
que ya existe sin importar mayúsculas con «Ya existe la categoría "X".»
(la constraint de la tabla distingue mayúsculas). El ítem se muestra según
`canCreateSupplierCategoryAction`, porque el formulario también se abre desde
el selector de proveedor de una compra, donde no llega el `Access`.

`listCostTagOptionsAction` devuelve aparte los centros inactivos
(`inactiveCostCenters`): `CostTagSelect` no los ofrece, pero nombra el valor
guardado de un registro («FLOTA_DZ Flota DZ (inactivo)»). `FLOTA_DZ` se
desactiva, no se borra: lo referencian movimientos, facturas y asientos.

**Por qué.** Crear una categoría obligaba a cerrar el alta del proveedor (y la
compra). El submit del diálogo anidado frena la propagación: React lo
burbujea por el portal hasta el formulario del proveedor.

**Descartado.** Un input dentro del popover del select (Radix Select no
admite foco en un input propio); pasar `Access` por props hasta el selector
de proveedor de cada formulario de compra.
