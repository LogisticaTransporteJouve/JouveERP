# DZ Instalaciones (2026-11-11)

Canal segregado `dz_fiscal` con su bloque en la barra lateral (decisión
[`2026-11-11-canal-segregado-dz`](../decisions/2026-11-11-canal-segregado-dz.md)).

- [x] **PR — canal segregado.** Migraciones
      `20261111205000_segregated_channels`,
      `20261111205100_segregated_channel_views`,
      `20261111205200_main_scope_list_rpcs`,
      `20261111205300_main_scope_reports` y `20261111205400_channel_summary`.
- [ ] Aprobar las migraciones con el deploy. `dz_fiscal` queda **inactivo**: sin
      bloque en el menú ni cambios visibles hasta activarlo.
- [ ] **Activar `dz_fiscal`** (paso de datos, después de promover):
      `update public.invoicing_channels set is_active = true where id = 'dz_fiscal';`
      Antes, leer el límite de rollback de DZ en
      [`limites-de-rollback.md`](limites-de-rollback.md).
- [ ] **Mover las compras de DZ** que hoy están en `jouve_fiscal`, con sus
      órdenes de pago, cheques propios y asientos (paso de datos, SQL de una vez;
      `guard_purchase_invoice_edit` no deja cambiar el canal de una compra
      recibida, la OP y sus facturas comparten canal y los períodos cerrados no
      se tocan). Proveedores (dueño, 2026-11-11): REHAU SA (30676575665), ROWA
      S A (30540721722), SUMINOX S.R.L. (30709385336), FEDERICO RAUL DICATARINA
      LOSADA Y MARTIN FITZSIMONS SOCIEDADES LEY 19550 CAPITULO I SECCION IV
      (30716032333) y P E I S A (30579103163). Falta el rango de fechas. Poner
      `default_channel_id = 'dz_fiscal'` a esos proveedores.
- [ ] **Ventas de DZ:** asignar el punto de venta 10 a `dz_fiscal`, habilitarlo y
      dejar que la sincronización de emitidos de ARCA traiga sus comprobantes.
- [ ] Nombres finales de las cuentas «Venta de productos (Instalaciones)» y
      «Costo de mercadería vendida (Instalaciones)» (se cambian en el plan de
      cuentas; nada lee el nombre).
