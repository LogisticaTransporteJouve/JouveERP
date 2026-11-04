# 2026-11-04 — Margen por camión pendiente, NC/ND que siguen a la factura editada y escaneo por permisos (auditoría w11)

**«Margen por camión» (Gestión) marca el neto que no es definitivo**
(`20261104190200`). `get_vehicle_margin` devuelve, como última columna,
`uninvoiced_shipments`: las cargas sin facturar (no canceladas) de los viajes
del camión, o de los viajes sin vehículo en esa fila. Las filas de centros de
costo traen 0. La regla es la misma que en «Rentabilidad de flota», el insight
y el AI CFO: lo pendiente se decide por cantidad de cargas, porque una carga
por tarifa no tiene flete hasta facturarse. Una fila con cargas pendientes
muestra «pendiente de facturar» bajo el neto, y la lista de notas dice
cuántas cargas y en cuántas filas. El margen % se sigue mostrando: es el de lo
facturado hasta ahora.

**«Modificar» una factura de compra mueve sus NC/ND como «Recategorizar»**
(`20261104190201`). Cambiar la cuenta de gasto o el centro de costo de una
factura vigente en el formulario de edición dejaba atrás sus NC/ND: la
factura pasaba al camión B y la NC seguía acreditando al camión A. Ahora un
trigger aplica la regla de `recategorize_expense` en cualquier escritura:

- Siguen a la factura solo sus NC/ND vigentes que todavía tienen el valor
  anterior, campo por campo. Una NC/ND con su propio valor lo conserva, y una
  a cargo de un empleado conserva su cuenta.
- Si alguna de esas NC/ND es de un período contable cerrado (por su fecha o
  por su asiento vivo), se rechaza toda la edición, con el mismo criterio que
  «Recategorizar».
- Lo que hace `recategorize_expense` lo propaga la propia función (y lo
  devuelve y lo audita), así que el trigger no actúa dentro de ella.
- **Descartado:** llamar a `recategorize_expense` desde
  `updatePurchaseInvoiceAction`. Serían dos escrituras separadas (la RPC y el
  resto del encabezado), y un PATCH directo seguiría dejando las NC/ND atrás.
  El trigger corre en la misma transacción que la edición y cubre todos los
  caminos.
- **Descartado:** rechazar el cambio cuando la factura tiene NC/ND y mandar a
  «Recategorizar». Es más fricción para el mismo resultado.

**Insight «Costo por km en suba»: un camión con un service sin costo cargado
queda afuera.** Si en cualquiera de los dos períodos el camión tiene un
service sin costo, su costo de ese período no se conoce (#396: lo
desconocido no es $0). Comparar igual mostraría una suba que puede no
existir, o escondería una real. El camión no entra en la comparación.

**Escaneo de documentos: cada comparación respeta los permisos de quien subió
el archivo.** El job de extracción corre con el cliente de servicio. Antes
comparaba el documento con todo el libro y guardaba el resultado para quien lo
subió, aunque esa persona no pudiera leer esos datos: conciliación del
extracto con Caja, id de un comprobante duplicado, proveedor o cliente por
CUIT. Ahora el paso de match lee el acceso del usuario en ese momento (sus
roles menos sus denegaciones, `loadUserAccess` en `lib/auth/users.ts`, que
arma el `Access` con `resolveAccess`). Cada comparación corre solo con su
permiso:

| Comparación | Permiso |
|---|---|
| Proveedor por CUIT | `suppliers:read` |
| Cliente por CUIT | `clients:read` |
| Duplicado de compra | `purchase_invoices:read` |
| Duplicado de venta | `invoices:read` |
| Extracto contra Caja y Conciliación | `transactions:read` |

Sin el permiso no se compara ni se guarda nada de esa parte. Si no se sabe
quién subió el archivo, no se compara nada. El duplicado de compra necesita
el proveedor para buscar, así que lo busca aunque no lo guarde.

- Un duplicado que no se buscó por falta de permiso queda como «No se pudo
  verificar» (`duplicate_unknown`), no como «no está cargado». Emitir una
  factura de venta desde el escaneo pide un CAE solo si se verificó que no
  existe. La marca no dice nada de los datos: se pone sin leerlos.

- Se decide al escanear, no al leer: una denegación agregada después no borra
  lo que ya se guardó (pendiente).
