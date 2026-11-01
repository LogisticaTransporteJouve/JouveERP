# Otras ventas — diseño

Estado: **en curso** (2026-11-01). Sigue a
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

## Hoy (relevamiento)

- `clients.cuit` es `NOT NULL UNIQUE` y `iva_condition` `NOT NULL`
  (`20260508210000_clients.sql`). No hay forma de cargar un cliente sin CUIT.
- Nada en la base impide un comprobante o recibo interno a un cliente fiscal ni
  al revés. Solo hay guardas de mismo cliente + mismo canal en imputaciones y
  NC/ND.
- Listas, buscador, pickers, búsqueda global y export de clientes **no** reciben
  el alcance fiscal/interno. Solo la cuenta corriente lo usa.
- El rol `fiscal_reader` ve todos los clientes.
- El diálogo de comprobante muestra IVA y "CAE" aunque el canal sea interno
  (el servidor ya calcula sin IVA y numera localmente).
- PDFs de recibo y comprobante siempre imprimen "CUIT" y "Condición IVA".
- Cargas, facturación de depósito y documentos IA exigen CUIT para facturar.
- En prod no hay comprobantes ni recibos internos: no hay datos que migrar.

## Diseño

### 1. Base de datos

- `clients.is_fiscal boolean not null default true` — todos los actuales quedan
  fiscales. Inmutable (trigger).
- `cuit` e `iva_condition` pasan a nullable con un check:
  fiscal ⇒ ambos presentes; interno ⇒ ambos nulos.
- El `UNIQUE (cuit)` pasa a índice único parcial `where is_fiscal`.
- Guarda nueva: el canal de un comprobante y de un recibo tiene que coincidir con
  el lado del cliente (`channel.is_fiscal = client.is_fiscal`).
- RLS: `fiscal_reader` solo ve clientes fiscales.
- Índice de búsqueda global: guarda el lado del cliente para filtrar por alcance.

### 2. Clientes en la app

- El alcance del menú manda: **Ventas → Clientes** lista fiscales, **Otras
  ventas → Clientes** lista internos. No existe "Todos los canales".
- Alta interna: nombre, nombre de fantasía, teléfono, email, dirección, notas.
  Sin CUIT, sin AFIP.
- Pickers de cliente (comprobante, recibo) filtran por el lado del canal
  elegido. El buscador global y el export respetan el alcance.

### 3. Remito interno

- En la base sigue siendo `kind = 'factura'` en el canal interno; la app lo
  muestra como **Remito interno** (y NC como **Nota de crédito interna**).
- Diálogo en Otras ventas: sin tipo A/B, sin IVA, "Precio final", botón
  "Guardar". Receptor: `doc_tipo 99`, `doc_nro '0'`.
- PDF interno sin CUIT ni condición de IVA.
- Cargas / depósito / documentos IA: si el cliente es interno usan el canal
  interno en vez de exigir CUIT (fase 2).

### 4. Facturar un remito interno

Botón **Facturar** en un remito interno:

1. Elegís (o creás) el **cliente fiscal**.
2. Se arma una **Factura A/B** con los mismos ítems: el monto del remito es el
   **neto** y se suma el IVA (21% por defecto, editable).
3. Al obtener el CAE se crea automáticamente una **nota de crédito interna**
   por el total del remito, vinculada, con motivo "Facturado como A 0003-…".
   Si AFIP rechaza, no se crea la NC y el remito queda como estaba.
4. Vínculo en las dos puntas: el remito muestra "Facturado en A 0003-…", la
   factura "Origen: Remito interno 0001-…". Un remito se factura una sola vez.

Resultado: la venta interna neta queda en 0 y la venta existe una sola vez, del
lado fiscal, con su IVA.

### 5. Remito ya cobrado (decidido: el cobro pasa al lado fiscal)

Si el remito tiene un recibo interno aplicado, al obtener el CAE además:

- El recibo interno se **anula** (no se borra) y se emite un **recibo fiscal**
  por el mismo importe, al cliente fiscal, aplicado a la factura.
- El recibo fiscal reusa los **mismos medios de pago** (movimiento de caja,
  transferencia, cheques): el dinero no entra dos veces ni se revierte.
- El cliente fiscal queda debiendo la diferencia (el IVA).

Casos a resolver en el diseño fino de la fase 3:

- Un recibo interno que pagó varios remitos (solo se mueve la parte de este).
- Cheques del recibo ya depositados, endosados o rechazados.
- Recibos en otra moneda.

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
