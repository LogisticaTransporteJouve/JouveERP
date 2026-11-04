# 2026-11-04 — Auditoría RRHH y rendiciones: SAC, embargo, compra a cargo de empleado, diferencia de la rendición

**SAC de la liquidación final.** `payroll_sac_suggestion` no cuenta los
extras `Liquidación final:` (el SAC no es remuneración para el SAC, LCT art.
121): aplicar la liquidación de nuevo da el mismo SAC (`20261104095000`).

**Embargo a mano.** `payroll_entries.embargo_override`: un embargo tipeado en
un borrador sobrevive a cualquier alta o cambio de embargo judicial; volver a
"automático" lo recalcula (`20261104095100`).

**Compra a cargo de empleado: se le carga el neto.** En canal fiscal la
empresa toma el IVA crédito y las percepciones, así que al empleado se le carga
`imp_neto` (lo mismo que el asiento debita a anticipos al personal); en canal
interno (sin crédito) sigue `imp_total`. Descartado: cargarle el total y sacar
la compra del IVA crédito, que cambia el Libro IVA (`20261104095200`).

**Diferencia de la rendición: a cargo del chofer o del cliente.** Un faltante
asentado al chofer dejaba también la factura abierta: la deuda quedaba dos
veces. Ahora "Resolver diferencia" elige un solo deudor
(`driver_settlements.difference_charged_to`, `20261104095300`):

- _A cargo del chofer_ (faltante): un recibo al cliente por el faltante,
  imputado a la factura de la carga (el resto a cuenta), entra a una caja de
  la rendición, y de esa misma caja sale un adelanto al chofer
  (`record_employee_account_cash`). La caja queda en cero, el cliente
  saldado y el chofer debe el faltante; el asiento fiscal es anticipos al
  personal contra deudores. Requiere `hr:write`. Se rechaza si el faltante
  es de cargas de distintos canales o si hay cargas con faltante y otras con
  sobrante.
- _A cargo del cliente_: solo registra la elección; la factura sigue
  abierta (faltante) o el sobrante sigue a cuenta en su recibo, y no se toca
  la cuenta del chofer.
- Un sobrante no se acredita al chofer: ya está a cuenta del cliente en el
  recibo y acreditarlo también lo duplicaría.

Idempotente bajo el lock de la rendición (la misma elección devuelve lo
mismo; la otra se rechaza hasta quitar la primera). "Quitar diferencia" y
cancelar la rendición anulan el recibo, borran el adelanto y su movimiento de
caja, y limpian la elección. El recibo que saldó al cliente no se anula ni se
edita desde Recibos. **Sin `hr:write`** ni quitar ni cancelar sacan lo que
está en la cuenta del chofer (la acción manda `p_allow_driver = false` y la
RPC lo rechaza; la UI deshabilita el ítem con el motivo).

**Descuento de planilla sin plan (se mantiene).** Al cerrar, las `deudas` que
superan los planes se escriben como `payroll_discount` sin plan, aunque el
empleado no tenga un cargo abierto: el saldo queda a favor del empleado. Es
deliberado: la plata se le retuvo del sueldo y el saldo a favor muestra la
inconsistencia (falta cargar el cargo, o el descuento sobró). Descartado:
topear al saldo deudor (la retención desaparecería del registro) o inventar un
cargo que nadie cargó.

**Extras de viajes paginados.** Los viajes y las descargas del mes se leen
paginados (`paginateRange`) hasta un tope explícito; pasado el tope, la
sugerencia sale marcada como parcial.
