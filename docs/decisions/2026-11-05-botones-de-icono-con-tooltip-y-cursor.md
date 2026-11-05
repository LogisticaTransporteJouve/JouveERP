# Decisiones — Botones de ícono con tooltip y cursor de mano

## Todo lo clickeable muestra la mano, desde un solo lugar

Tailwind v4 sacó el `cursor: pointer` de los botones, así que en muchos
botones el cursor no cambiaba. En vez de agregar `cursor-pointer` botón por
botón:

- `app/globals.css` (`@layer base`) pone la mano en `button` habilitado,
  `[role="button"]`, `[role="menuitem"]` (y sus variantes checkbox/radio),
  `[role="option"]`, `[role="tab"]`, `summary`, `label[for]` y `select`
  habilitado. Así lo heredan los triggers de Select, los Tabs, Checkbox,
  Switch, los días del calendario y los encabezados ordenables de las tablas.
- `components/ui/button.tsx` lleva `cursor-pointer` en la base y
  `disabled:cursor-not-allowed`, para que también lo tenga un `Button asChild`
  que renderiza un link.
- Los ítems de `DropdownMenu`, `Select` y `Command` (también los del Combobox)
  traían `cursor-default` de shadcn, que le gana a la regla base: ahora dicen
  `cursor-pointer`.
- Una utilidad `cursor-*` en un componente sigue mandando (por ejemplo,
  `cursor-grab` en el asa para mover widgets del dashboard).

## Un botón que solo tiene un ícono es un `IconButton` con `label`

`components/ui/icon-button.tsx` envuelve `Button` con un `label` obligatorio:
lo muestra como tooltip (al pasar el mouse y al enfocar con teclado) y lo usa
como `aria-label`. El texto describe la acción en castellano: «Ver detalle»,
«Editar», «Recategorizar», «Anular», «Descargar PDF», «Acciones» para los
menús de tres puntos.

- **Deshabilitado:** un botón deshabilitado no recibe eventos, así que el
  tooltip va en un `span` enfocable que lo envuelve. Por eso el motivo de un
  botón bloqueado (por ejemplo, el permiso de caja en la cuenta del empleado)
  ahora va en el `label` y no en un `title`.
- **Solo con mouse encima o foco de teclado:** al cerrar un diálogo o un
  menú, el foco vuelve al botón que lo abrió; Radix abriría el tooltip ahí.
  `IconButton` lo abre solo si el mouse está encima o si el foco es de
  teclado (`:focus-visible`), así no queda un «Editar» flotando después de
  cerrar el diálogo con el mouse.
- **Provider propio:** cada `IconButton` trae su `TooltipProvider`, así se
  renderiza en cualquier árbol (tests, portales) sin depender del layout. El
  layout raíz también tiene uno para el resto de los tooltips.
- **Dentro de triggers:** funciona como hijo de `DropdownMenuTrigger`,
  `DialogTrigger` o `PopoverTrigger` con `asChild`, y con `asChild` propio
  para un `Link` o un `<a>`.
- Se sacaron los `title` y los `sr-only` que repetían el texto: el tooltip y
  el `aria-label` los reemplazan.

## Una prueba impide que vuelva un botón de ícono sin tooltip

`components/icon-buttons.test.ts` recorre `app/`, `components/` y `features/`
y falla si encuentra un `Button` con `size="icon…"` o un `Button`/`<button>`
cuyo único contenido es un ícono (también dentro de un `Link`/`<a>` con
`asChild`, o junto a un `sr-only`). La única excepción es
`components/ui/calendar.tsx`: sus días son `Button` de tamaño ícono, pero
muestran el número del día, no un ícono.
