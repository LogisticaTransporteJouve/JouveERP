# Km recorridos desde Strix (2026-11-06)

- [ ] Cargar el usuario y la clave de Strix en Flota → Km recorridos →
      «Usuario de Strix» (owner o admin) después de promover.
- [ ] Probar el robot contra Strix desde producción: el recorrido sale de la
      grabación del owner y nunca corrió de punta a punta. En particular, que
      `/informe/` acepte los vehículos con solo `thing_id`, `domain` y
      `label` (la página manda también motor, año y device_id, que se leen
      por websocket).
- [ ] La lista de vehículos se toma de los informes «Kmts recorridos»
      anteriores de Strix: un camión nuevo entra recién cuando aparece en uno
      (alcanza con generar el informe una vez a mano en Strix).
- [ ] Ver si Strix limita el largo de un informe: hoy se pide uno por mes.
- [ ] Los 10 vehículos de Strix se cargaron en producción como Camión
      (2026-11-06, directo en la base, sin auditoría): revisar tipo, alias,
      marca y modelo.
