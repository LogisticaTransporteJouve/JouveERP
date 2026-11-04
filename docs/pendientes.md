# Pendientes y faltantes — JouveERP

> Lista de trabajo vigente: lo que falta (código, datos y configuración) son
> los ítems `[ ]` de **Antes de promover**, de **Límites de rollback** y de
> todos los archivos fechados de [`pendientes/`](pendientes/). El historial
> de la tanda 2026-07-04 (las antiguas §1–§4) queda como historia: sus cifras
> y su "backlog vacío" son de esa fecha. Cuando se resuelve un punto, se marca
> en su archivo y se sincroniza el roadmap.

> **Tanda 2026-07-04** — surgió de una auditoría docs vs código (roadmap,
> `docs/*`, `features/*`, migraciones, tests). Tanda de cierre (PRs #195–#201): mappers
> crear-desde-escaneo para **todos** los tipos con destino (recibo, OP, factura
> de venta, NC/ND de compra), **asientos manuales** + cuenta RECPAM + aplicación
> RG 4667, **tarifas de storage versionadas** (aumento % + snapshot en cada
> facturación), **flujo de caja con USD** al TC oficial, **L.6 export Libro IVA
> Digital** (TXT posicional) y **L.7 CAEA** de contingencia. Con esto el
> backlog de código quedó **vacío a esa fecha**.

> **pgTAP.** CI (job `database`) aplica todas las migraciones sobre un stack
> fresco y corre `supabase test db` en cada PR: los ítems "sin verificar
> contra datos de producción" de los archivos quieren decir sin datos de
> producción y sin probar en el navegador, no sin pgTAP.

## Fijos

- [`pendientes/antes-de-promover.md`](pendientes/antes-de-promover.md) — lo
  que el owner revisa y aprueba antes de correr **Promote to production**.
- [`pendientes/limites-de-rollback.md`](pendientes/limites-de-rollback.md) —
  cambios cuyo rollback de código no tiene mitigación en el schema.

## Por tema

Ver la carpeta [`pendientes/`](pendientes/): un archivo por tema,
`YYYY-MM-DD-<tema>.md`, con el título de la sección como H1. El nombre
empieza por la fecha, así que el orden de la carpeta es el cronológico (la
más nueva al final). [`pendientes/historial-2026-07-04.md`](pendientes/historial-2026-07-04.md)
guarda el cierre de la tanda 2026-07-04.

## Cómo agregar

Para agregar algo, creá un archivo nuevo en esta carpeta
(`docs/pendientes/YYYY-MM-DD-<tema>.md`, con un H1 que diga el tema y la
fecha); no edites archivos de otros PRs salvo para marcar un ítem. Lo que
haya que revisar antes de promover o un límite de rollback nuevo va como
ítem en [`antes-de-promover.md`](pendientes/antes-de-promover.md) o
[`limites-de-rollback.md`](pendientes/limites-de-rollback.md).

Este índice no lista los archivos por tema a propósito: si cada PR sumara una
línea acá, dos PRs en paralelo chocarían en el mismo lugar, que es justo lo
que esta carpeta evita.
