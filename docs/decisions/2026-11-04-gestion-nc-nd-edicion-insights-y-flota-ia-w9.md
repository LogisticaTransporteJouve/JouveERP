# 2026-11-04 — NC/ND editada, factura duplicada y flete sin facturar en el AI CFO (auditoría w9)

**Una NC/ND de compra editada sigue a su origen** (`20261104160200`).
«La/El del comprobante de origen» ahora vale también en «Modificar»:

- Dejar vacía la cuenta o el centro de una NC/ND toma los de su origen.
  Antes se guardaba vacío: el neto revertía «Compras» y el crédito caía en
  «Sin centro».
- Cambiarle el origen pasa al nuevo lo que había heredado del anterior (lo
  que todavía tiene el valor del origen viejo y no se cambió en esa
  edición). Lo que el usuario elige en la misma edición se respeta.
- Un campo que ya estaba vacío se completa al guardar, salvo mientras el
  período de la NC/ND (su fecha o un asiento vigente) está cerrado. Ahí
  queda como está, para que guardar solo las notas no tenga que re-asentar
  un período cerrado (el motivo por el que `20261102230100` heredaba solo
  con origen nuevo).
- En el formulario, pasar a NC/ND una factura en edición vacía la cuenta y
  el centro que todavía tienen el valor por defecto del proveedor y nadie
  tocó, igual que al cargarla; volver a factura los repone.
- **Descartado:** cambiar el texto de la opción vacía en edición a «Sin
  cuenta» / «Sin centro». Era más chico, pero dejaba la NC/ND editada
  distinta de la cargada y fuera de su factura en Gestión y en «Margen por
  camión».

**«Posible factura duplicada» compara de a pares.** Las facturas de un
proveedor con el mismo importe se miran de a una con la anterior: dos que
están cerca son un posible doble cargo, aunque el proveedor tenga el mismo
importe todo el año. Antes, el grupo del año entero tenía que entrar en 30
días, y un abono mensual cargado dos veces nunca aparecía. "Cerca" es hasta
30 días; con 3 o más facturas del mismo importe, menos de la mitad de su
espaciado habitual (el cuartil superior de las distancias, al menos un
día). Así un abono mensual o semanal sin duplicados no se marca. Cada tramo
de facturas cercanas es una tarjeta.

**Flete sin facturar en el AI CFO** (`20261104160201`). Un viaje con cargas
sin facturar no tiene su ingreso definitivo, la misma regla del insight
«Viajes con margen negativo» (w8). `getTrips`, `getFleetProfitability`,
`getFleetMargin`, `getVehicleEconomics` y `getDriverActivity` traen ese
flete aparte (`uninvoiced_freight`; en `ai_fleet_margin`, por grupo y total)
y avisan que esos netos no son definitivos. El ingreso y el neto no
cambian: son los de «Rentabilidad de flota» y «Margen por camión». Esto
reemplaza la decisión w8 de que `getTrips` contaba lo pendiente como 0 sin
decirlo.

- **Descartado:** sacar esos viajes del neto. El neto de la herramienta
  dejaría de coincidir con el de las pantallas de flota.

**`getMaintenance`** cuenta los services sin costo cargado y dice que no
están en el total.
