# 2026-11-04 — Importador, conciliación partida y manual servido

**Decisión.**

- **Referencias del importador:** categoría, cuenta de gasto, centro de
  costo y área se buscan por código o nombre sin mayúsculas ni acentos. Una
  que no existe o es ambigua es **error de la fila**, no un aviso: nada se
  descarta en silencio. Inactivas (categoría, centro, área) dan aviso.
- **Vencimiento de licencia** del chofer importado: un documento
  `fleet_documents` (kind `licencia`) con `import_run_id`, para que el aviso
  de vencimientos lo vea y deshacer la corrida lo borre con su chofer; un
  documento cargado a mano para ese chofer bloquea el deshacer.
- **Tarifas por área:** clave natural cliente + concepto + área + inicio; la
  general y la de un área no se superponen entre sí (igual que el guard).
- **Varias líneas contra un movimiento:** `bank_statement_matches` pasa a
  clave única (línea, movimiento); un guard mantiene cada conciliación como
  estrella (una línea con sus movimientos o un movimiento con sus líneas).
  Repetir una conciliación es no-op; desconciliar una línea libera toda su
  conciliación.
- **Caja:** la marca y el filtro salen de un embed de
  `bank_statement_matches` sobre `v_transactions_tagged` (filtro de nulos de
  PostgREST), sin tocar la vista. El mensaje del guard de movimiento
  conciliado nombra Tesorería › Conciliación, así lo ven Caja y cualquier
  documento que edite ese movimiento.
- **Conciliación de la IA:** un extracto escaneado toma el estado de las
  líneas ya importadas (mismo importe con signo, ±1 día, cuentas ARS); solo
  el resto se compara contra Caja. Una lectura fallida o que pasa el tope da
  "sin resumen", no uno parcial.
- **Manual en `/manual`:** un route handler lee `docs/manual` (solo páginas
  `.html` y `assets/*.css|js`) con sesión iniciada, agrega el nonce de la CSP
  a los scripts y saca Google Fonts. `next.config.ts` traza la carpeta en la
  función.

**Descartado.** Copiar el manual a `public/` en el build: `public/` no pasa
por un gate propio y sus scripts sin nonce no corren bajo `strict-dynamic`.
Varias líneas contra varios movimientos: con los dos lados múltiples la suma
no dice qué explica qué. Actualizar proveedores o empleados existentes desde
la planilla: el importador solo da altas.
