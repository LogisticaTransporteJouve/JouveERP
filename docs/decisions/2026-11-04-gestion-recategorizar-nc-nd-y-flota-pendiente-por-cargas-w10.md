# 2026-11-04 — Recategorizar una NC/ND a vacío, duplicados diarios y flota pendiente por cargas (auditoría w10)

**«Recategorizar» una NC/ND a «Sin cuenta (Compras)» o «Sin centro de
costo» guarda el vacío** (`20261104170200`). Desde `160200` el trigger de
herencia también corre al cambiar cuenta o centro, y volvía a poner el valor
del origen encima del vacío que acababa de guardar `recategorize_expense`.
La fila y el asiento quedaban con el centro del origen, mientras la
respuesta y la auditoría decían "vacío". Ahora el trigger no toca lo que
escribe `recategorize_expense`: lo reconoce en la pila de llamadas
(`pg_context`, como `guard_document_header`). La herencia del formulario de
edición sigue igual: ahí la opción vacía se llama «La/El del comprobante de
origen» y toma la del origen.

- Consecuencia: si después alguien guarda esa NC/ND desde «Modificar» con el
  campo vacío, se completa con el del origen, porque en el formulario el
  vacío significa eso (decisión w9).
- **Descartado:** dejar el trigger y cambiar el diálogo para que no ofrezca
  el vacío en una NC/ND con origen. El diálogo de recategorizar es el lugar
  donde se elige el rubro a mano, y «Sin cuenta» tiene que poder elegirse.

**«Posible factura duplicada» y los abonos diarios.** Con 5 facturas o más
del mismo importe, la ventana es la mitad de su espaciado habitual, sin
mínimo. Con un proveedor que factura todos los días hábiles (espaciado 1),
solo cuenta una segunda factura el mismo día. Antes el mínimo de un día
marcaba cada semana como un posible doble cargo. Con 3 o 4 facturas se
mantiene el mínimo de un día: tres cargas en días seguidos no se distinguen
de un abono diario y siguen marcándose.

**Flota: "pendiente de facturar" se decide por cantidad de cargas**
(`20261104170201`). Una carga que se cobra por tarifa no tiene flete hasta
que su liquidación se factura, así que el flete sin facturar sumaba 0 y el
viaje parecía cerrado con pérdida. `v_trip_revenue` y `ai_fleet_margin`
traen `uninvoiced_shipments` (cargas sin facturar, no canceladas). Un viaje
con alguna no entra en «Viajes con margen negativo». Las herramientas de
flota del AI CFO, «Rentabilidad de flota» y sus totales usan esa cantidad.
El flete sin facturar se sigue mostrando al lado.

**Viajes sin vehículo en los totales.** Regla única: los totales de flota
cubren todos los viajes listados.

- «Rentabilidad de flota»: los viajes sin vehículo suman en «Facturado»,
  «Manual» y «Neto del rango», y aparecen como fila «Sin vehículo» en la
  tabla por vehículo. Su combustible ya está en el camión de cada carga.
- `ai_fleet_margin` por vehículo: los trae como grupo `none` («Sin
  vehículo»), igual que por chofer y por cliente. El ingreso total por
  vehículo es el mismo que por viaje; el neto por vehículo además descuenta
  el combustible sin viaje y el mantenimiento, que son por vehículo.
- `get_vehicle_margin` y `getVehicleEconomics` ya los traían aparte y no
  los cuentan dos veces.

**Mantenimiento sin costo.** `ai_fleet_margin`, `get_vehicle_margin` y
«Rentabilidad de flota» cuentan los services sin costo cargado
(`maintenance_without_cost`). El AI CFO, «Margen por camión» y la pantalla
dicen que no están en el mantenimiento. No es $0, es un costo desconocido
(#396).

**En «Rentabilidad de flota», un neto negativo con cargas sin facturar dice
«pendiente de facturar»** en vez de mostrarse como pérdida. Es la misma
regla que siguen el insight y el AI CFO. Debajo de «Neto del rango» se ven
los viajes y las cargas sin facturar.
