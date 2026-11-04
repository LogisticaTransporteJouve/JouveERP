# 2026-11-04 — NC/ND que siguen a la factura con un campo vacío, y margen por cliente con cargas sin flete (auditoría w12)

## Una NC/ND con la cuenta o el centro vacíos a propósito sigue vacía cuando la factura se edita

**Decisión.** Cuando «Modificar» cambia el centro (o la cuenta) de una factura
de compra, sus NC/ND la siguen (`20261104190201`). Si una de ellas tenía la
cuenta (o el centro) vacía a propósito, ese campo queda vacío. Es lo mismo que
hace «Recategorizar» (`20261104170200`). `purchase_nc_nd_inherit_account` ya no
rellena desde la factura los cambios que hace el trigger
`purchase_nc_nd_follow_factura`. Lo detecta en la pila de llamadas, igual que
con `recategorize_expense` (`20261104194200`).

**Por qué.** Los dos caminos que cambian la cuenta o el centro de una factura
tienen que dejar igual a sus NC/ND. Si no, el asiento que se vuelve a generar
y Gestión ponen el crédito de la NC en una cuenta que nadie eligió.

**Descartado.** Que el trigger escriba solo el campo que cambió: el trigger de
herencia se dispara igual con una sola de las columnas en el `SET`, así que el
otro campo vacío se rellenaba de todos modos.

## Margen por cliente: un reparto del costo que todavía no es definitivo se marca, no se rehace

**Decisión.** Por cliente, `ai_fleet_margin` sigue repartiendo el costo de cada
viaje según el flete de cada carga. Puede pasar que otro cliente tenga en el
mismo viaje una carga sin facturar y sin flete (se cotiza por tarifa y su flete
recién aparece al facturar la liquidación). En ese caso, el
`uninvoiced_shipments` de este cliente también cuenta esa carga, así su margen
se lee como no definitivo (`20261104194201`). Cada carga sin flete cuenta una
vez en cada cliente con el que comparte el viaje. `total_uninvoiced_shipments`
sigue contando cada carga una sola vez, el mismo total que por viaje. Una carga
de otro cliente que ya tiene flete pero no está facturada no se cuenta: el
reparto ya es el que va a quedar.

La tarjeta «Margen en baja por cliente» deja afuera a un cliente con cargas
sin facturar en cualquiera de los dos períodos. Es lo mismo que hace el costo
por km con un service sin costo. El AI CFO (`getClientMargin`) devuelve
`uninvoiced_shipments` por cliente y avisa cuántos clientes tienen un margen no
definitivo.

**Por qué.** Es la regla del resto de los lectores de flota (por viaje, chofer,
vehículo y `get_vehicle_margin`): la cifra se mantiene y el grupo dice que no
es definitiva por la cantidad de cargas sin facturar (W10). Repartir por
cantidad mientras haya una carga sin flete también cambiaría el margen del
cliente al facturarse, y sin aviso.

**Descartado.** Repartir el costo del viaje por cantidad de cargas mientras
alguna no tenga flete. Agregar una columna nueva de «reparto no definitivo»:
obliga a un `drop` y a cambiar los tipos, y `uninvoiced_shipments` ya tiene ese
significado («el neto de este grupo no es definitivo»).
