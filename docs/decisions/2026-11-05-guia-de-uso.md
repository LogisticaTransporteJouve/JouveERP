# 2026-11-05 — Guía de uso: contenido tipado, HTML generado y tests contra el código

## Qué se decidió

La guía de usuario (`docs/manual/`, servida en `/manual`) deja de ser HTML escrito a mano y pasa a
generarse desde contenido tipado en `features/guide/manual/content/<capítulo>.ts`:

- **Modelo** (`features/guide/manual/types.ts`): capítulo → secciones (una por pantalla, con sus
  rutas) → tareas. Cada tarea tiene quién puede (un `Permission` de la matriz, así que TypeScript ya
  rechaza uno que no existe), requisitos, pasos, qué pasa después, errores con su mensaje exacto y qué
  hacer, tareas relacionadas, palabras clave y réplicas de pantalla.
- **Marcado inline**: `{{Emitir}}` cita un texto de la UI tal cual, `[[/invoices]]` enlaza la sección
  de una ruta, `[[#tarea]]` otra tarea. Las réplicas de pantalla (`MockScreen`: página, diálogo o
  menú) se dibujan en HTML/CSS con los tokens de la app y marcadores numerados que corresponden a los
  pasos; un texto que empieza con `~` es de ejemplo y no se valida.
- **Generación**: `pnpm manual:build` (vitest `toMatchFileSnapshot`) escribe `docs/manual/*.html` y
  `assets/search-index.js`. En CI el mismo test falla si lo commiteado no coincide con lo que genera el
  contenido. Los archivos siguen siendo HTML estático (se abren sin la app).
- **Exactitud** (`features/guide/manual/manual.test.ts`): cada texto de UI citado existe como string en
  `app/`, `components/`, `features/`, `lib/` o `hooks/`; cada mensaje de error existe en el código o en
  `supabase/migrations/` (la parte variable se escribe «…»); cada ruta citada es una página de
  `app/(dashboard)`; cada página tiene su sección; cada entrada del menú y de la guía del sidebar lleva
  a una sección; cada ancla enlazada existe; los ids son únicos. Las columnas del importador salen de
  `IMPORT_FIELDS` (no se copian).
- **Entradas**: «Guía de uso» en el pie de la barra lateral; el botón **?** del encabezado
  («Ayuda de esta pantalla») abre `/manual/para?ruta=<pantalla>`, que redirige a la sección de esa ruta
  (la más profunda que la cubra; si no hay, al inicio); la guía del sidebar enlaza igual. Búsqueda
  dentro de la guía (`assets/guide.js`, tecla `/`).
- **Pestaña propia**: la guía se usa abierta al lado de la app. Todos los enlaces a la guía (sidebar,
  **?**, guía del sidebar, links del asistente) abren la misma pestaña con nombre (`jouve-manual`,
  `lib/manual/windows.ts`) en vez de apilar pestañas; los enlaces de la guía a la app («Volver a
  JouveERP», «Abrir esta pantalla en JouveERP») van a la pestaña de la app (`jouve-app`, el nombre que
  la app le pone a su pestaña) y no reemplazan la guía. El layout funciona a media pantalla.
- **IA**: `searchGuide` en el registry (permiso `ai:chat`, solo lectura) devuelve las tareas con sus
  pasos, si el usuario puede hacerlas y el link. Ver `docs/ai-cfo.md`.

## Por qué

El pedido es que la guía sea una copia exacta de la app. Escrita a mano en HTML, la única forma de
saber que un botón cambió de nombre era leer todo de nuevo; el manual anterior ya tenía textos que la
app no muestra. Con el contenido tipado, los textos citados se comprueban contra el código en cada CI,
y la misma fuente alimenta el HTML, la búsqueda y el asistente.

## Qué se descartó

- **Capturas reales en CI**: el contenedor de CI no levanta la app con datos. Las réplicas en HTML/CSS
  se validan contra el código; `pnpm manual:screenshots` (Playwright contra el stack local sembrado)
  saca capturas reales para compararlas, sin publicarlas en la guía.
- **Renderizar en cada request**: se perdería el HTML estático que se abre sin la app, y el diff de un
  cambio de guía no se vería en el PR.
- **Embeddings para la IA**: la guía tiene unos cientos de tareas; un puntaje por palabras alcanza y no
  agrega un proveedor ni costo.
- **Que el agente la entregue lista para merge**: siguiendo `AGENTS.md`/`CLAUDE.md`, los PRs quedan en
  draft y los mergea una persona.
