# 2026-11-04 — `arca-issued-sync` corre de noche, no cada hora

**Decisión (#366).** La importación de comprobantes emitidos en ARCA por
fuera del ERP (`arca-issued-sync`) pasa de cada hora (`0 * * * *`) a una vez
por noche (03:17, hora de Buenos Aires;
`lib/inngest/functions/arca-issued-sync.ts`). El botón «Traer de ARCA» de
Comprobantes la sigue encolando a demanda. Cada corrida recorre hasta 50
lotes de 100 por punto de venta y tipo, así que un historial largo se pone al
día en pocas noches. La ventana de huecos y la de clientes sin nombre
(`dailyWindow`, `lib/afip/sync-issued.ts`) rotan por día en vez de por hora.

**Por qué.** Cada corrida cuenta varios pasos de Inngest (abrir la corrida,
listar los puntos de venta y uno por lote), y casi todas las corridas horarias
no encontraban nada nuevo: un comprobante emitido fuera del ERP no necesita
verse en la hora, y quien lo necesita antes aprieta el botón. Con el plan
gratis de 50.000 ejecuciones por mes
(`docs/decisions/2026-11-04-presupuesto-de-ejecuciones-de-inngest.md`), las 24
corridas diarias eran gasto sin trabajo.

**Reemplaza** el descarte de "bajar la frecuencia de `arca-issued-sync`" de
`docs/decisions/2026-11-04-presupuesto-de-ejecuciones-de-inngest.md` (ver
`docs/decisions/2026-11-04-presupuesto-de-inngest-descarte-de-arca-issued-sync-reemplazado.md`).
La cifra de "~26.000 por mes" de esa decisión es anterior a este cambio y al
de las tareas de IA por eventos
(`docs/decisions/2026-11-04-tareas-ia-programacion-por-eventos-en-vez-de-polling.md`).

**Descartado.** Dejarla cada hora: el usuario vería antes lo emitido fuera
del ERP, pero el botón ya cubre ese caso.
