# Límites de rollback (vigentes)

Un rollback de código vuelve a un SHA anterior sin revertir migraciones
(`CONTRIBUTING.md`, "Deploy y rollback"). Estos cambios no tienen
mitigación en el schema: el límite se respeta operando.

- [ ] **SAC** (`20261103050100_payroll_sac_periods`, #315 `f71136f`): no
      crear un período SAC (junio o diciembre) hasta que el deploy quede
      firme. El código anterior busca el período por año y mes, sin `kind`:
      con el SAC creado, la planilla de ese mes falla (`maybeSingle` ve dos
      filas) y el listado muestra el mes dos veces. Con un SAC ya creado, no
      volver a un SHA anterior a #315.
- [ ] **Tarifas de almacenaje migradas** (`20261104080500`, #337 `bf8b975`):
      el código anterior **no** puede editar una fila migrada (el guard
      rechaza precio, vigencia y cliente; la nota de rollback de la migración
      dice lo contrario y está mal). Su "Aumentar %" no filtra las migradas:
      inserta las filas aumentadas (para un cliente migrado no cambia nada,
      el tarifario las pisa), pero el cierre de las viejas va por lotes y el
      guard rechaza el lote entero, también las no migradas: quedan dos
      filas vigentes por cliente y la acción igual avisa que aplicó. Con
      código anterior a #337, no usar "Aumentar %" (aumentar desde el
      tarifario del cliente).
