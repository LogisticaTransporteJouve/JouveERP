# Manual JouveERP (sitio HTML estático)

Documentación de usuario final — no de desarrolladores — de todos los
módulos del ERP. Pensado para que un operador o jefe de área pueda
abrirlo en el navegador, navegarlo con la misma barra lateral que el
sistema, y leer paso a paso cómo se hace cada operación.

## Cómo abrirlo

Es HTML estático: alcanza con abrir `index.html` en cualquier navegador.

```bash
# desde la raíz del repo
open docs/manual/index.html        # macOS
xdg-open docs/manual/index.html    # Linux
start docs/manual/index.html       # Windows
```

Para servirlo (recomendado, para que carguen bien las fuentes y mermaid
desde CDN sin warnings de CORS):

```bash
npx --yes serve docs/manual -p 4173
# o
python3 -m http.server -d docs/manual 4173
```

Y abrí <http://localhost:4173>.

## Estructura

```
docs/manual/
├── index.html              # Home + grilla de secciones
├── getting-started.html    # Login, sidebar, scope, búsqueda, tema, roles
├── sales.html              # Clientes · Comprobantes · Recibos · Aging
├── purchases.html          # Proveedores · Categorías · Compras · OPs · Aging
├── treasury.html           # Cuentas · Caja · Cheques recibidos · Cheques propios
├── accounting.html         # Plan · Diario · Mayor · IVA · Balance · CC · Inflación
├── hr.html                 # Empleados · Asistencia · Sueldos · Pagos · Vacaciones
├── admin.html              # Usuarios · Padrón · POS · Preview PDF · Backups
├── collaboration.html      # Chat · Búsqueda · Notif · Adjuntos · Perfil
├── README.md               # Este archivo
└── assets/
    ├── styles.css          # Paleta monocromática oklch (igual a globals.css)
    └── manual.js           # Render del sidebar + bootstrap de mermaid
```

## Look & feel

- Paleta monocromática oklch idéntica a `app/globals.css` (sin colores de
  marca). Soporta tema claro/oscuro por `prefers-color-scheme`.
- Tipografía **Geist** + **Geist Mono** desde Google Fonts.
- Sidebar replicado del ERP — mismo orden, mismas etiquetas — para que el
  usuario lo reconozca de inmediato.
- Diagramas con **Mermaid** (vía CDN, `mermaid@10.9.1`) para flujos de
  negocio: ciclo de emisión fiscal, cobro con cheque, mes de sueldos, etc.

## Mantenimiento

Cuando agregás un módulo nuevo al ERP:

1. Sumá su entrada en `assets/manual.js` (constante `NAV`).
2. Si pertenece a una sección existente, agregá una sub‑sección en el
   HTML correspondiente (`sales.html`, `purchases.html`, etc.).
3. Si abre una sección nueva, creá un HTML siguiendo el mismo template
   (header `topbar`, `main`, `<h2 id="...">` con anchors).

Las páginas son intencionalmente standalone (no requieren build): cada
una incluye `assets/styles.css`, `assets/manual.js` y mermaid por CDN.
