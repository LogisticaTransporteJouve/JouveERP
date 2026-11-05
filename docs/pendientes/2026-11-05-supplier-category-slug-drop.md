# Categorías de proveedores: borrar la columna `slug`

El owner pidió sacar el slug de todos lados (2026-11-05). La app ya no lo
muestra, no lo pide ni lo escribe, y `20261105230000` le puso un valor por defecto generado.

- [ ] Cuando el código sin slug ya esté en producción y no haga falta volver
      a un commit anterior a ese cambio, agregar una migración que borre
      `supplier_categories.slug` con su `unique` y su `check`, y los
      `slug` de los fixtures pgTAP (`db_integrity_authz_test.sql`,
      `import_more_fields_test.sql`).
