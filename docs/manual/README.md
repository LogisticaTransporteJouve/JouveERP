# Guía de JouveERP (HTML generado)

Guía para el usuario final: cada pantalla, cada tarea paso a paso con los textos exactos de los
botones, quién puede hacerla, qué pasa después y qué hacer con cada error.

**No se edita a mano.** Los `.html` y `assets/search-index.js` se generan desde
`features/guide/manual/content/` con:

```bash
pnpm manual:build
```

CI falla si lo commiteado no coincide con lo generado, y `features/guide/manual/manual.test.ts` falla
si la guía cita un botón, una ruta, un permiso o un mensaje de error que el código ya no tiene. La
decisión completa está en [`docs/decisions/2026-11-05-guia-de-uso.md`](../decisions/2026-11-05-guia-de-uso.md).

## Cómo se abre

- **En la app:** «Guía de uso» en el pie de la barra lateral, o el botón **?** del encabezado de cada
  pantalla (va directo a su sección). La sirve `app/manual/[[...path]]/route.ts` (solo usuarios con
  sesión, con el nonce de la CSP).
- **Quién la ve:** cualquier usuario con un rol que vea el lado interno. El Contador externo (solo
  fiscal) no la ve, porque documenta el canal interno; un usuario sin rol tampoco.
- **Fuera de la app:** son archivos estáticos: `xdg-open docs/manual/index.html`, o
  `python3 -m http.server -d docs/manual 4173`.

## Cómo se escribe

Un capítulo es un `GuidePage` en `features/guide/manual/content/<capítulo>.ts`, registrado en
`content/index.ts`. Cada sección documenta una o más rutas de `app/(dashboard)`; cada tarea:

```ts
{
  id: "emitir-factura",
  title: "Emitir una factura fiscal",
  permission: "invoices:issue",
  prerequisites: ["Un punto de venta habilitado en [[/admin/afip/puntos-de-venta]]."],
  screens: [{ kind: "dialog", title: "Nuevo comprobante", fields: [...], footer: [...] }],
  steps: ["En [[/invoices]], hacé clic en {{Nuevo comprobante}}.", "..."],
  after: ["AFIP devuelve el CAE y ..."],
  errors: [{ message: "No tenés permiso.", fix: "Pedile el permiso al owner." }],
  related: ["anular-factura"],
  keywords: ["facturar", "CAE"],
}
```

- `{{texto}}`: un texto de la UI, tal cual está en el código.
- `[[/ruta]]` y `[[#id]]`: enlaces a la sección de una ruta o a otra tarea.
- En una réplica de pantalla, los textos son de la UI salvo que empiecen con `~` (dato de ejemplo).
- `marker: n` dibuja el número del paso `n` sobre ese control.
- Un error con una parte variable se escribe con «…» en lugar de la variable.

Después de editar: `pnpm manual:build` y `pnpm vitest run features/guide`.

## Capturas reales (opcional)

Las pantallas de la guía son réplicas en HTML/CSS validadas contra el código. Para compararlas con la
app real, con el stack local levantado y sembrado (`pnpm dev:up`, `pnpm seed:all`):

```bash
pnpm manual:screenshots
```

Saca una captura de cada pantalla que documenta la guía (salvo las que piden un registro, como
`/invoices/[id]`) en `test-results/manual-screenshots/`. No se publican en la guía.

## Archivos

```
docs/manual/
├── index.html, <capítulo>.html   # generados
└── assets/
    ├── styles.css                # a mano: tokens de app/globals.css (neutro + índigo Jouve)
    ├── guide.js                  # a mano: búsqueda
    └── search-index.js           # generado
```
