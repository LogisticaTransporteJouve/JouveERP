# Importador, conciliación y manual: follow-ups (2026-11-04)

- [x] **Importador, más datos:** proveedores con categoría, cuenta de gasto
      y centro de costo por defecto (por nombre o código); choferes con
      número, categoría y vencimiento de licencia (el vencimiento es un
      documento `licencia` en Flota › Vencimientos); tarifas por área (columna
      Área, buscada por nombre dentro del Depósito). Una referencia que no
      existe o es ambigua deja la fila con error.
- [x] **Conciliación:** varias líneas contra un movimiento (el banco lo
      partió), con la suma exacta y nunca varias de cada lado; desconciliar
      una libera toda la conciliación. Caja marca los conciliados, filtra
      por conciliados o no, no ofrece borrarlos y bloquea monto y fechas en
      la edición con link a Conciliación; el mensaje de la base nombra
      Tesorería › Conciliación.
- [x] **IA:** el resumen de conciliación de un extracto escaneado lee las
      líneas ya importadas (`bank_statement_lines`) y su estado; solo el
      resto se compara contra Caja.
- [x] **Manual:** formato de cada planilla del importador y sección de
      Conciliación; servido en `/manual` con sesión iniciada; la guía del
      sidebar enlaza la sección de cada pantalla.
- [x] Aprobar las migraciones `20261104070000_import_more_fields` y
      `20261104070100_bank_reconciliation_many_lines` con el deploy (después
      de las de 5.3/5.4; `promote-to-production.yml` las aplica antes del
      código). Sin la primera, la RPC vieja ignora las claves nuevas:
      proveedores y choferes entran sin sus datos nuevos y **una tarifa de
      área entraría como general**, así que no importar tarifas por área
      hasta aplicarla. Sin la segunda falla "Conciliar con varias líneas".
      Rollback del código: llama a las mismas RPC con su firma; una
      conciliación partida sigue bloqueando su movimiento y el código viejo
      la muestra contra una de sus líneas. — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [ ] pgTAP verde en CI (stack fresco: `import_more_fields_test.sql`,
      `bank_reconciliation_many_lines_test.sql`); sin verificar contra datos
      de producción. No se probaron en el navegador `/manual`
      (CSP con nonce), el filtro de Caja (filtro de nulos sobre el embed de
      `bank_statement_matches` en `v_transactions_tagged`) ni el diálogo de
      varias líneas.
- [ ] El importador no actualiza un proveedor o empleado que ya existe: los
      datos nuevos de la planilla solo entran con el alta.
- [ ] Las sugerencias de Conciliación siguen siendo uno a uno; las líneas
      partidas se eligen a mano.
- [ ] El manual servido usa la fuente del sistema (la CSP bloquea Google
      Fonts) y Mermaid por CDN con el nonce.
