# IA: consultas cruzadas y gráficos (2026-11-03, roadmap 6.1 + 6.2)

- [x] **Margen por cliente** (`getClientMargin`): ingreso neto facturado sin
      IVA menos costo de viajes y combustible imputado; costo directo sin
      cliente y flota no asignada aparte.
- [x] **Cobranza por cliente** (`getClientPaymentBehavior`): días promedio
      de cobro, deuda abierta y vencida, +90 días, cheques rechazados y a
      cuenta.
- [x] **Economía por vehículo** (`getVehicleEconomics`) y **actividad por
      chofer** (`getDriverActivity`): viajes, km (viajes y odómetro), litros,
      ingreso, costos, por km; extras, adelantos y saldo del empleado con
      RRHH. Viajes sin vehículo / sin chofer aparte.
- [x] **Ranking de costos** (`getTopCosts`) por rubro o centro de costo,
      desde el resultado de gestión.
- [x] **Gráficos:** barras apiladas, formato km, `dataset` para elegir la
      lista; `getManagementPnL` con `byMonth`.
- [ ] Aprobar la migración `20261103150000_ai_cross_queries` junto con el
      deploy: sin ella fallan `getClientMargin`, `getVehicleEconomics` y
      `getDriverActivity`.
- [x] **Costos de camión sin vínculo:** `getVehicleEconomics` suma el
      costo del centro de costo del camión (`get_vehicle_margin`,
      `20261104050000`); falta vincular cada camión con su centro (dato, ver
      "Margen por camión").
- [x] `ai_fleet_margin` cuenta viajes cancelados (su costo y su ingreso
      manual); las RPC nuevas de actividad los excluyen. Alinear.
- [ ] Rendiciones por chofer (diferencias de cobranza contra entrega) en
      `getDriverActivity`.
- [x] "Días de pago" va a `getClientPaymentBehavior`: `getClientSalesSummary` ya no
      ofrece días promedio de cobro en su descripción y deriva esas preguntas; casos de
      routing nuevos (días de pago, quién tarda más, facturado por cliente).
- [ ] Los evals en vivo (`pnpm eval:ai`) de esos casos no se corrieron (sin
      `ANTHROPIC_API_KEY` en el entorno del agente).
- [ ] Los evals en vivo (`pnpm eval:ai`) de los casos nuevos no se corrieron:
      `getClientSalesSummary` y `getClientPaymentBehavior` se pisan en "días
      de cobro".
