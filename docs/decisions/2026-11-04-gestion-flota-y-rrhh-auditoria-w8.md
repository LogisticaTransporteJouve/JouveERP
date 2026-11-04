# 2026-11-04 — Gestión, flota y RRHH (auditoría w8)

**Centro de una NC/ND de compra.** Una NC/ND sin centro de costo toma el de
su comprobante de origen aunque tenga cuenta propia (`20261104150200`).
Antes el centro se copiaba solo si la cuenta también venía vacía, y una NC
con cuenta elegida y «El del comprobante de origen» como centro quedaba
«Sin centro» en Gestión y fuera del camión en «Margen por camión». Las
NC/ND ya cargadas no se tocan.

**NC/ND escaneada.** El borrador de una NC/ND que sale de un documento no
trae la cuenta ni el centro sugeridos por la IA (son de una factura): la
NC/ND hereda los de su origen. En el formulario, pasar el tipo a NC/ND
limpia la cuenta y el centro que puso el proveedor o el escaneo si el
usuario no los tocó, y volver a factura los repone. Sin proveedor elegido
también se limpian los del proveedor anterior.

**NC/ND de una compra vinculada en «Margen por camión».** Una carga de
combustible o un service vinculado a una compra cuenta el monto o el costo
que tipeó el usuario, y ninguna NC/ND lo cambia. Por eso la NC/ND de esa
compra ahora cuenta en su centro (el del camión, por herencia), como en
Gestión; la compra vinculada sigue sin contarse dos veces
(`20261104150201`). Una NC de $200 contra un service de $1000 deja el
camión en $800.

- **Descartado:** restar la NC/ND del costo del registro de flota.
  Cambiaría `ai_fleet_margin` y el reporte de rentabilidad, y un registro
  puede apuntar a una compra que también tiene otras cosas.

**Ingreso de viajes en el AI CFO.** `getTrips` da como `revenue` el ingreso
de «Rentabilidad de flota» (`v_trip_revenue`: el flete de las cargas
facturadas; sin cargas, el ingreso manual) y el manual aparte
(`manual_revenue`). El total deja afuera los viajes cancelados. Sin
`shipments:read` no da ingreso ni total (el flete sale de las cargas), igual
que `getFleetProfitability`.

**Viajes con cargas sin facturar en el insight.** «Viajes con margen
negativo» no evalúa un viaje con cargas sin facturar (`uninvoiced_freight >
0`) y dice cuántos dejó afuera. Las pantallas de flota toman como ingreso
solo el flete facturado, así que sumar lo pendiente al ingreso habría sido
otra cuenta que la del reporte; dejarlo afuera evita marcar como pérdida un
viaje que todavía no se facturó.

**Lecturas que fallan en RRHH, préstamos y rendiciones.**

- Vacaciones del empleado: si falla la lectura de saldos o de licencias, la
  tarjeta lo dice con «Reintentar» en vez de «Sin saldos» o «Sin licencias
  registradas.». «Cargar saldo» no se ofrece hasta leer los saldos (con 0
  días pendientes pisaba los guardados), y «Nueva licencia» no se ofrece
  hasta leer las licencias.
- Extras de sueldo: si falla la lectura, el diálogo lo dice con
  «Reintentar» y no deja agregar (se podía cargar dos veces).
- Detalle de un préstamo: las cuentas se leen con `useAccountOptions`. Si la
  lectura falla, «Pagar» y «Registrar desembolso» no se ofrecen y la página
  dice por qué, con «Reintentar». Se suma a la lista de
  `2026-11-04-sin-permiso-de-cuentas-se-ocultan-los-selectores-de-cuenta.md`.
- Rendición de chofer: cuando las cuentas llegan después de abrir el
  diálogo, la cuenta por defecto se pone solo en las líneas sin cuenta; lo
  que el usuario ya marcó o tipeó queda.

`components/read-error.tsx` es el mensaje de lectura fallida con
«Reintentar» que usan esos diálogos y el de pagos de sueldo.
