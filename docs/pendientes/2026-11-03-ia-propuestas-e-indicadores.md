# IA: propuestas e indicadores (2026-11-03, roadmap 6.3 + 6.4)

- [x] **Propuestas fuera del chat** (`ai_proposals`): preparar con los permisos de quien hace
      click, Aceptar / Descartar en un Dialog, aceptar idempotente (compare-and-set + guard),
      vencimiento a 24 h, auditoría de aceptar, fallar y descartar.
- [x] **Acciones proponibles nuevas:** tarea, tarifa de cliente, conciliar las sugerencias de un
      extracto y ND por mora (además de licencia, asiento, cotización, tarea IA y escaneo).
- [x] **Ocho indicadores** en el analyst (margen por cliente, costo por km, L/100 km, mora sin
      cobrar, extracto sin conciliar, rendiciones, cuotas de préstamos, caja contra
      financiamiento), con propuesta donde corresponde.
- [x] Aprobar la migración `20261103180000_ai_proposals` junto con el deploy: sin ella falla el
      analyst (columna `ai_insights.proposal`) y las tarjetas nuevas no se ven para finance ni
      operations. pgTAP verde en CI (`ai_proposals_test.sql`); sin verificar
      contra datos de producción. — hecho: aplicada en producción (está en `production-latest`, `bbe08b38`).
- [x] **Recategorizar un gasto** (cuenta de gasto y/o centro de costo de un egreso manual o de
      una compra): `recategorize_expense` + `lib/commands/recategorize-expense.ts`, Dialog
      "Recategorizar" en Caja y Compras, y la propuesta `proposeRecategorizeExpense`.
- [x] **Crecimiento de la mora:** foto diaria del aging (`aging_snapshots`, cron
      `aging-snapshot`) y la tarjeta `receivables_overdue_growth` ("la mora creció X % vs hace
      30 días"). La tarjeta aparece recién cuando hay 30 días de fotos.
- [x] **Conciliación desde el insight de extracto:** si la cuenta con más líneas atrasadas tiene
      sugerencias, la tarjeta propone `proposeBankMatches`; si no, la tarea de siempre.
- [x] **"N conciliadas" en la tarjeta del chat** (`ai_chat_confirmations.result_note`).
- [x] Aprobar las migraciones `20261104060000_recategorize_expense`,
      `20261104060100_aging_snapshots` y `20261104060200_ai_chat_confirmation_note` con el
      deploy. pgTAP verde en CI (`recategorize_expense_test.sql`,
      `aging_snapshots_test.sql`); sin verificar contra datos de producción. — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [x] Recategorizar una factura de compra lleva el cambio a sus NC/ND vigentes que tenían el valor
      anterior (`20261104092300`); una NC/ND con cuenta o centro propios lo conserva, y una a
      cargo de un empleado conserva la cuenta. El audit lista las NC/ND que cambiaron.
- [x] Las compras recategorizadas antes de `20261104092300` dejaron sus NC/ND en el rubro o
      centro anterior; no hay backfill (cambia datos de producción, lo decide el owner):
      recategorizar esas NC/ND una por una (el audit `expense.recategorized` dice cuáles compras). — ya no aplica: «Recategorizar» (`060000`) y `092300` llegaron juntas a producción (las notas de rollback w11 dicen que `production-latest` no tenía «Recategorizar»): en producción ninguna compra se recategorizó antes de `092300`.
- [ ] Una propuesta aceptada cuyo servidor cae entre el claim y la escritura se cierra como
      fallida al volver a prepararla (#346); en el chat queda `accepted` sin `result`.
- [ ] Los evals en vivo (`pnpm eval:ai`) de los casos nuevos no se corrieron (sin
      `ANTHROPIC_API_KEY` en el entorno del agente; los offline pasan).
