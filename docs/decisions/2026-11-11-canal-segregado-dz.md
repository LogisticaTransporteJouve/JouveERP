# 2026-11-11 — DZ Instalaciones: un canal segregado

**Decisión.** DZ Instalaciones vuelve como canal fiscal propio (`dz_fiscal`,
mismo CUIT, `dz_sons`) y **segregado**: solo se ve en su bloque de la barra
lateral, el último, con Resumen, Comprobantes de compra, Órdenes de pago, Ventas
y Proveedores. Fuera de ese bloque, ningún listado, selector de canal, valor por
defecto, reporte, resultado de gestión, flujo de caja, aging, tarea, insight ni
herramienta del asistente lo muestra.

- **Un atributo, un predicado.** `invoicing_channels.is_segregated` (no se
  cambia con documentos: `guard_invoicing_channel_config`). En SQL,
  `public.channel_in_main_scope(channel)`; en TS, `isMainChannel` (`lib/scope.ts`).
  Ningún código pregunta por `dz_fiscal`: otro canal segregado sería una fila
  más (con sus cuentas y etiquetas).
- **Etiquetas como datos.** `division_label` (línea de división de los PDF;
  vacía = Logística Jouve) y `short_label` (marca en Tesorería, «DZ»).
- **Sus propias cuentas.** `sales_account_id` / `purchase_account_id`: los
  builders asientan el neto de una venta en la cuenta de ventas del canal y el
  de una compra sin cuenta propia en la de compras del canal, antes del rol
  (`ventas` / `compras`). Una compra con cuenta propia o a cargo de un empleado
  la conserva. Si la cuenta del canal está inactiva, el asiento falla
  (`55006`) en lugar de caer en las cuentas de Jouve, y no se puede desactivar
  una cuenta que usa un canal (`guard_account_channel_reference`). Las cuentas:
  «Venta de productos (Instalaciones)» (4.1.2) y «Costo de mercadería vendida
  (Instalaciones)» (5.1.2); sus nombres se pueden cambiar.
- **El alcance viaja en la URL.** Una página está dentro del bloque cuando su
  URL lleva `?channel=<id>` y ese id es un canal segregado activo (fiscal, para
  un usuario solo fiscal). Lo validan el servidor (`resolveChannelScope`, el
  mismo para páginas y exportaciones) y el cliente (`segregatedChannelFor`). La
  ficha de un documento o proveedor de DZ fija su canal (`PageChannelProvider`)
  aunque se abra desde otro lado.
- **Los formularios toman el canal del bloque.** Adentro ofrecen solo DZ y lo
  traen elegido (una compra, una OP, un proveedor nuevo); afuera, los canales de
  la app principal más el guardado del registro que se edita.

**Excepciones (DZ fuera de su bloque, a propósito).**

- Libros: Libro IVA (uno solo, el CUIT es uno), diario, mayor, balance,
  paquete mensual (sus conteos incluyen DZ) e impuestos.
- Tesorería: saldos, Caja, conciliación y cheques recibidos y propios muestran
  los movimientos de DZ con la marca «DZ»; préstamos los listan sin marca. Las
  cuentas bancarias son compartidas: los saldos no se separan por canal.
- La bandeja de comprobantes recibidos de ARCA sigue en Compras; la aceptación
  masiva manda cada comprobante al canal por defecto de su proveedor (un
  proveedor de DZ va a DZ).

**Segregar no es controlar el acceso.** RLS y permisos no cambian: el bloque se
ve con los mismos permisos de cada pantalla (Resumen pide `management:read`). Lo
segregado es la presentación.

**Por qué.** El dueño decidió (B1–B7) que DZ tenga su propio canal fiscal, que
aparezca solo en su pestaña, con sus cuentas, que los libros y el Libro IVA lo
incluyan y que Tesorería lo muestre marcado.

**Descartado.**

- Un centro de costo o una unidad de negocio aparte: el CUIT y el diario son
  uno; un centro de costo no saca a DZ de listas y selectores.
- Dejar DZ en `jouve_fiscal`: no se puede separar en gestión ni en listados.
- Un árbol de rutas con su propio provider por canal: duplica páginas.
- Una cookie para el canal: se filtraría por los links planos (barra inferior
  del celular, migas, paquete mensual, búsqueda global).

**Límites.** El canal se crea **inactivo** (`20261111205000`); activarlo,
mover las compras de DZ y habilitar el punto de venta 10 son pasos de datos
(ver [`pendientes/2026-11-11-dz-instalaciones.md`](../pendientes/2026-11-11-dz-instalaciones.md)).
Una división con canal fiscal **y** interno necesitaría una clave de agrupación.
