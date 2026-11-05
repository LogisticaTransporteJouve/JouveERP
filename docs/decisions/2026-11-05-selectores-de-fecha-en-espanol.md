# Decisiones — Selectores de fecha y de mes en español

La app mezclaba tres selectores de fecha: el calendario de `DatePicker` y del
filtro de períodos de los listados (en inglés: «Su Mo Tu…», semana desde el
domingo), el selector nativo de mes (el navegador lo dibuja en su idioma:
«November 2026», «Clear», «This month») y el selector nativo de fecha (otro
aspecto y otro idioma según el navegador). Ahora hay dos, los dos en español.

## El calendario habla español (Argentina)

`components/ui/calendar.tsx` pasa a react-day-picker el locale `es` del
propio paquete (`react-day-picker/locale`: los textos de date-fns más las
etiquetas de accesibilidad traducidas): semana desde el lunes, encabezado
«Lu Ma Mi Ju Vi Sá Do», «noviembre 2026», meses del desplegable «Ene…Dic» y
etiquetas como «Ir al mes siguiente» o «Elegir el año». Vale para todos los
que lo usan: `DatePicker` y `PeriodFilter` (el filtro «Hoy / Ayer / Esta
semana… / Personalizado»).

Con el desplegable de año, react-day-picker termina en diciembre del año en
curso. Eso impedía elegir un vencimiento del año que viene; ahora el
desplegable llega diez años adelante salvo que el campo ponga su propio
máximo.

## Un solo selector de fecha: `DatePicker`

Todos los `<input type="date">` pasan a `DatePicker`. Sigue guardando
`YYYY-MM-DD` (`""` vacío), así que ni los formularios ni los esquemas Zod
cambian. Se agregaron:

- `min` / `max` (`YYYY-MM-DD`): los días fuera del rango quedan
  deshabilitados y la navegación no pasa de ahí.
- Las props de un campo de react-hook-form y de `FormControl` (`name`,
  `onBlur`, `ref`, `id`, `aria-invalid`, `aria-describedby`), así que
  `<DatePicker {...field} />` funciona igual que `<Input {...field} />`.
- `clearable` solo en los campos donde vacío es un valor válido (los
  «(opcional)», los filtros sin fecha); en los obligatorios no hay cómo
  vaciarlo. Con el foco en el campo, Supr o Retroceso también lo vacían.

## Un selector de mes: `MonthPicker`

`components/ui/month-picker.tsx` reemplaza a los `<input type="month">`:
el mismo botón que `DatePicker` («nov 2026») abre un cambio de año y una
grilla de 4×3 meses («Ene … Dic»), con «Este mes» y, si el campo lo permite,
«Limpiar». Guarda `YYYY-MM` como el nativo. `min` / `max` deshabilitan los
meses fuera del rango: «Traer de ARCA», los viajes históricos y el km
mensual siguen sin dejar elegir meses futuros, como antes con el `max`
nativo. Se maneja con el
teclado: flechas entre meses (cruzan de año), Re Pág / Av Pág cambian el
año, Inicio / Fin van a los extremos de la fila.

## Una diferencia con el nativo

En el campo nativo se podía tipear una fecha fuera de `min` / `max`; el
navegador la marcaba inválida pero la entregaba. Ahora esas fechas no se
pueden elegir. Ningún campo usaba `required` nativo, así que no hubo que
reproducir esa validación.

## Para que no vuelva

`components/date-inputs.test.ts` falla si aparece `type="date"`,
`type="month"` o `type="week"` en `app/`, `components/` o `features/`
fuera de los dos selectores.
