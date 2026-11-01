# Otras ventas — diseño

Estado: **fases 1–4 implementadas** (2026-11-01). Sigue a
[`separacion-fiscal-interno.md`](separacion-fiscal-interno.md) y su
[plan](plan-separacion-fiscal-interno.md): las invariantes de canal en la DB se
mantienen; lo que cambia es la **vista**. La tesorería se ve compartida (todos
los canales) y el selector global desaparece: el lado lo define la sección del
menú. El rol `fiscal_reader` sigue viendo solo lo fiscal.

## Modelo mental

Jouve opera **dos puntos de venta separados** que solo comparten la tesorería:

| | Ventas (fiscal) | Otras ventas (interno) |
|---|---|---|
| Canal | `jouve_fiscal` | `jouve_internal` |
| Clientes | con CUIT y condición de IVA (AFIP) | sin CUIT ni condición de IVA |
| Comprobantes | Factura A/B, NC, ND con CAE | **Remito interno**, **nota de crédito interna** |
| Cobros | Recibo | **Recibo interno** |
| Precio | neto + IVA | precio final, sin IVA |
| Libros | Libro IVA, ARCA | no van a AFIP |
| Caja / bancos / cheques | compartidos | compartidos |

Un cliente pertenece a **un solo lado** y no se puede cambiar. Si una empresa
compra en los dos, son dos clientes.

**Compras se separa igual** (decidido 2026-11-01): **Compras** (fiscal) y
**Otras compras** (interno), cada una con sus proveedores (los internos sin
CUIT), sus comprobantes de compra, órdenes de pago y aging de proveedores.
Lo único compartido es la tesorería: caja, cuentas, cheques, préstamos, pagos
recurrentes. Sueldos: a confirmar (por ahora compartido).

## Antes de este cambio (relevamiento del 2026-11-01)

- `clients.cuit` era `NOT NULL UNIQUE` e `iva_condition` `NOT NULL`: no había
  forma de cargar un cliente sin CUIT.
- Nada impedía un comprobante o recibo interno a un cliente fiscal ni al revés.
- Listas, pickers y export de clientes no recibían el alcance fiscal/interno.
- El rol `fiscal_reader` veía todos los clientes.

## Cómo quedó

### 1. Base de datos (`20261101174000_counterparty_sides.sql`)

- `clients.is_fiscal` / `suppliers.is_fiscal` (`default true`: los existentes
  quedaron fiscales), inmutable por trigger.
- `cuit` e `iva_condition` nullable con check: fiscal ⇒ ambos; interno ⇒
  ninguno. El `UNIQUE (cuit)` se mantiene completo: los internos tienen CUIT
  NULL y los NULL no chocan (la sync de ARCA sigue haciendo upsert por CUIT).
- `guard_document_side`: comprobantes y recibos (cliente), compras y órdenes de
  pago (proveedor) solo en un canal del lado de su contraparte.
- RLS: `fiscal_reader` solo ve contrapartes fiscales.
- `search_clients` / `search_suppliers` aceptan `p_is_fiscal`.

### 2. Lados en la app

- No hay selector global: la sección del menú (Ventas / Otras ventas / Compras /
  Otras compras) fija el lado en las páginas partidas (`lib/scope.ts`
  `isScopedPath`). Tesorería, dashboard, contabilidad y sueldos leen todo.
- La ficha de un cliente o proveedor usa **su** lado, no el del menú
  (`PageSideProvider`); los formularios de documentos IA quedan del lado fiscal.
- Alta interna: nombre, nombre de fantasía, teléfono, email, domicilio, notas.
  Sin CUIT ni AFIP. Pickers, listas y export filtran por lado.
- Pendiente: la búsqueda global (`search_global`) todavía mezcla los dos lados.

### 3. Remito interno

- En la base sigue siendo `kind = 'factura'` en el canal interno; la app lo
  muestra como **Remito interno** (`X9001-…`) y la NC como **Nota de crédito
  interna**. Punto de venta propio: 9001 (`20261101190000_internal_sales_point.sql`).
- Diálogo de Otras ventas: sin tipo ni letra, sin IVA, "Precio final", botón
  "Guardar". Receptor doc 99 (`voucherReceptor`).
- PDF y ficha sin CUIT ni condición de IVA.
- Cargas y facturación de depósito emiten remito a un cliente interno.
- Pendiente: la creación de facturas desde documentos IA sigue siendo solo fiscal.

### 4. Facturar un remito interno

Botón **Facturar** en un remito interno emitido:

1. Elegís el **cliente de Ventas** y la alícuota (21% por defecto).
2. Se emite una **Factura A/B** con los mismos ítems: el precio del remito es el
   **neto** y se suma el IVA (`invoices.source_remito_id`, una factura viva por
   remito).
3. Con el CAE (o CAEA), el job `credit-billed-remito` corre
   `settle_billed_remito`, en una sola transacción: pasa los cobros (sección 5)
   y crea la **nota de crédito interna** por lo que el remito tenga abierto, con
   motivo "Facturado como A0003-…"; después la emite del lado interno.
4. Mientras la factura está viva, el remito queda **congelado**: no admite
   cobros, ajustes de saldo, NC ni anulación, y la NC de la acreditación no se
   puede anular (`guard_billed_remito_frozen`).
5. Mientras corre, la factura muestra "Acreditando…". Si la acreditación
   falla o queda trabada, muestra "El remito todavía no se acreditó" y el
   botón **Reintentar acreditación**.

Qué impide facturar (`billed_remito_blocker`, se revisa al crear la factura y
otra vez al acreditar): una NC previa, un ajuste de saldo aplicado, o un recibo
interno que no se pueda pasar entero (paga otros comprobantes o un cheque
rechazado, tiene saldo a cuenta, cheques o retenciones, está en otra moneda o
en un período contable cerrado).

### 5. Remito ya cobrado

Cada recibo interno aplicado al remito se **anula** (sus movimientos de caja se
van con él) y se emite un **recibo de Ventas** al cliente de la factura, con las
mismas líneas de pago y la misma fecha, aplicado a la factura. La plata cuenta
una sola vez y el cliente queda debiendo el IVA.

Los casos que no se pasan solos (sección 4) se resuelven a mano: anular el
recibo interno, facturar el remito y cargar el cobro en Ventas.

### 6. Imputar remitos internos de compra

En una **factura de Compras** recibida, el botón **Imputar remitos internos**
elige un proveedor de Otras compras y los remitos que esa factura incluye
(`impute_purchase_remitos`, en una sola transacción; las compras no pasan por
AFIP):

1. Cada remito se cancela con una **nota de crédito interna de compra** por lo
   que tenga abierto, con motivo "Imputado a la factura A00007-…" y vinculada a
   la factura (`purchase_invoices.imputed_to_id`).
2. Cada orden de pago interna aplicada al remito se **anula** (sus movimientos
   de caja se van con ella) y se emite una **orden de pago de Compras** al
   proveedor de la factura, con las mismas líneas y fecha, aplicada a la
   factura.
3. Los remitos no pueden sumar más que la factura.
4. Mientras la NC está viva el remito queda congelado: no admite pagos, saldo
   inicial, NC/ND, cambios de importe ni anulación, y la NC no se puede
   cambiar ni anular. **Anular la factura** (después de anular sus órdenes de
   pago) anula esas NC: los remitos vuelven a deberse en Otras compras.

Qué impide imputar (`purchase_remito_blocker`): una NC/ND previa, saldo
inicial aplicado, otra moneda, o una orden de pago interna que no se pueda
pasar entera (paga otros comprobantes, tiene saldo a cuenta o cheques, o está
en un período contable cerrado). Esos casos se resuelven a mano.

## Decisiones abiertas

1. ~~Remito ya cobrado~~ → el cobro pasa al lado fiscal (sección 5).
2. ~~IVA~~ → el monto del remito es el neto; la factura es remito + IVA.
3. ~~"Todos los canales"~~ → se saca. Siempre se está en Ventas o en Otras
   ventas; tesorería y contabilidad muestran todo porque son compartidas.

## Fases (PRs)

1. Base + clientes **y proveedores** separados (migración, guardas, alta
   interna sin CUIT, listas y pickers por lado, RLS fiscal_reader). El
   selector de alcance desaparece: lo define la sección del menú (Ventas /
   Otras ventas / Compras / Otras compras); tesorería muestra todo.
2. Remito / recibo interno (diálogo, nombres, PDFs, cargas y depósito).
3. Facturar remito interno (ventas).
4. Compras: al cargar una factura fiscal de un proveedor, imputarle remitos
   internos de compra. Cada remito imputado se cancela con una nota de crédito
   interna de compra, vinculada a la factura, para no duplicar la compra. Si el
   remito ya estaba pagado con una orden de pago interna, el pago pasa a la
   factura fiscal (espejo de la sección 5).
