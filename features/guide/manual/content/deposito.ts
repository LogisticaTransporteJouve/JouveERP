import type { GuidePage } from "../types";

// Depósito: warehouses and their areas, the product catalog, pallets (entry,
// dispatch, location, blocking), traceability, storage tariffs and the
// monthly storage billing per client.

export const warehousePage: GuidePage = {
  file: "deposito.html",
  title: "Depósito",
  lead: "El almacenaje de mercadería de los clientes: depósitos y áreas, productos, ingreso y despacho de pallets, bloqueos y su trazabilidad.",
  sections: [
    // ── Depósitos ──────────────────────────────────────────────────────────
    {
      id: "depositos",
      title: "Depósitos y áreas",
      menuPath: "Depósito › Depósitos",
      routes: ["/warehouses"],
      permission: "warehouses:read",
      intro: [
        "Lista los depósitos físicos donde se guarda la mercadería, con su {{Nombre}}, {{Dirección}}, {{Capacidad (pallets)}} y el interruptor {{Activo}}. Primero aparecen los activos, ordenados por nombre.",
        "Cada depósito puede tener **áreas** (cámara de frío, a granel, rack…): al cargar un pallet se elige el área, y una tarifa puede tener un precio distinto por área.",
      ],
      screens: [
        {
          kind: "page",
          title: "Depósitos",
          subtitle: "Depósitos físicos para almacenamiento de mercadería.",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo depósito", variant: "primary" },
          ],
          table: {
            columns: ["Nombre", "Dirección", "Capacidad (pallets)", "Activo"],
            rows: [
              ["Depósito Central", "Av. Siempre Viva 742", "120", "Sí"],
              ["Depósito Norte", "—", "—", "No"],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Activo e inactivo",
          body: [
            "Un depósito inactivo sigue en la lista y conserva sus pallets, pero deja de ofrecerse al cargar o editar un pallet. Lo mismo pasa con un área inactiva: no se ofrece en el selector {{Área}} (salvo para el pallet que ya la tiene).",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-deposito",
          title: "Crear un depósito",
          permission: "warehouses:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo depósito",
              description: "Depósito físico para almacenamiento de mercadería.",
              fields: [
                {
                  label: "Nombre",
                  value: "Depósito Central",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Dirección",
                  value: "Av. Siempre Viva 742",
                  wide: true,
                },
                { label: "Capacidad (pallets)", value: "120", wide: true },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/warehouses]], hacé clic en {{Nuevo depósito}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Nombre}}: obligatorio, hasta 120 caracteres.",
                "{{Dirección}}: opcional.",
                "{{Capacidad (pallets)}}: opcional, un número entero (cuántos pallets entran). Es solo informativo.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "Aparece el aviso {{Depósito creado.}} y el depósito queda activo en la lista, listo para elegirlo al cargar pallets.",
          ],
          errors: [
            {
              message: "Nombre requerido.",
              fix: "Escribí el nombre del depósito.",
            },
            {
              message: "No tenés permiso para crear depósitos.",
              fix: "Pedile la tarea a alguien con rol Depósito, admin u owner (ver [[#roles-y-permisos]]).",
            },
            {
              message: "No se pudo crear el depósito.",
              fix: "Volvé a intentar; si sigue, avisale al administrador.",
            },
          ],
          related: ["agregar-area-deposito", "ingresar-pallet"],
          keywords: ["alta de depósito", "nuevo depósito", "almacén"],
        },
        {
          id: "editar-deposito",
          title: "Editar un depósito",
          permission: "warehouses:write",
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar", marker: 1 },
                { label: "Áreas" },
                { label: "Borrar", destructive: true },
              ],
            },
          ],
          steps: [
            "En [[/warehouses]], en la fila del depósito, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá {{Nombre}}, {{Dirección}}, {{Capacidad (pallets)}} o {{Notas}}.",
            "Hacé clic en {{Guardar}} (se habilita cuando cambiaste algo).",
          ],
          after: ["Aparece el aviso {{Cambios guardados.}}."],
          errors: [
            {
              message: "No tenés permiso para editar depósitos.",
              fix: "Pedile el cambio a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo actualizar el depósito.",
              fix: "Volvé a intentar; si sigue, avisale al administrador.",
            },
          ],
          related: ["activar-desactivar-deposito"],
        },
        {
          id: "activar-desactivar-deposito",
          title: "Desactivar o reactivar un depósito",
          summary:
            "Para dejar de usar un depósito sin perder sus pallets ni su historial.",
          permission: "warehouses:write",
          steps: [
            "En [[/warehouses]], en la fila del depósito, hacé clic en el interruptor de la columna {{Activo}}.",
          ],
          after: [
            "Un depósito inactivo deja de ofrecerse en {{Depósito}} al cargar o editar un pallet. Sus pallets siguen donde están.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar depósitos.",
              fix: "Pedile el cambio a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo cambiar el estado.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["borrar-deposito"],
          keywords: ["dar de baja depósito", "inactivar"],
        },
        {
          id: "borrar-deposito",
          title: "Borrar un depósito",
          permission: "warehouses:write",
          prerequisites: [
            "El depósito no tiene que tener pallets (ni en depósito ni despachados) ni tarifas generales por área de sus áreas. Si los tiene, desactivalo en lugar de borrarlo ([[#activar-desactivar-deposito]]).",
          ],
          steps: [
            "En [[/warehouses]], en la fila del depósito, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}} en el aviso «Esta acción no se puede deshacer.».",
          ],
          after: [
            "Aparece el aviso {{Depósito borrado.}}. Sus áreas se borran con él.",
          ],
          errors: [
            {
              message: "No se pudo borrar el depósito.",
              fix: "Lo más común es que tenga pallets cargados (o tarifas por área): desactivalo en lugar de borrarlo.",
            },
            {
              message: "No tenés permiso para borrar depósitos.",
              fix: "Pedile la baja a alguien con rol Depósito, admin u owner.",
            },
          ],
          related: ["activar-desactivar-deposito"],
          keywords: ["eliminar depósito"],
        },
        {
          id: "agregar-area-deposito",
          title: "Agregar un área a un depósito",
          summary:
            "Las áreas son zonas del depósito (cámara de frío, a granel, rack). Sirven para ubicar cada pallet y para cobrar un precio distinto por zona.",
          permission: "warehouses:write",
          screens: [
            {
              kind: "dialog",
              title: "~Áreas de Depósito Central",
              description:
                "Zonas del depósito (cámara de frío, a granel, rack).",
              fields: [
                {
                  label: "Nombre del área",
                  value: "Cámara de frío",
                  marker: 2,
                  wide: true,
                },
              ],
              footer: [{ label: "Agregar", variant: "primary", marker: 3 }],
            },
          ],
          steps: [
            "En [[/warehouses]], en la fila del depósito, abrí el menú ⋯ y elegí {{Áreas}}.",
            "Escribí el nombre en el campo {{Nombre del área}} (hasta 120 caracteres).",
            "Hacé clic en {{Agregar}} (o apretá Enter).",
          ],
          after: [
            "Aparece el aviso {{Área creada.}} y el área se suma a la lista del diálogo, activa.",
            "Desde ese momento se puede elegir en {{Área (opcional)}} al cargar un pallet de ese depósito.",
            "Si el depósito no tiene áreas, el diálogo dice «Sin áreas. Los pallets quedan en el depósito sin área.».",
          ],
          errors: [
            {
              message: "Ya hay un área con ese nombre.",
              fix: "Usá otro nombre o reactivá el área que ya existe.",
            },
            {
              message: "No tenés permiso para editar áreas de depósito.",
              fix: "Pedile el cambio a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo crear el área.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["desactivar-area-deposito", "borrar-area-deposito"],
          keywords: ["zona", "cámara de frío", "rack", "ubicación"],
        },
        {
          id: "desactivar-area-deposito",
          title: "Desactivar o reactivar un área",
          permission: "warehouses:write",
          steps: [
            "En [[/warehouses]], abrí el menú ⋯ del depósito y elegí {{Áreas}}.",
            "En la fila del área, hacé clic en su interruptor.",
          ],
          after: [
            "Un área inactiva se ve tachada y deja de ofrecerse al cargar pallets y tarifas; los pallets que ya están en ella la conservan.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar áreas de depósito.",
              fix: "Pedile el cambio a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo actualizar el área.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["borrar-area-deposito"],
        },
        {
          id: "borrar-area-deposito",
          title: "Borrar un área",
          permission: "warehouses:write",
          prerequisites: [
            "El área no tiene que tener pallets ni tarifas. Si los tiene, desactivala ([[#desactivar-area-deposito]]).",
          ],
          steps: [
            "En [[/warehouses]], abrí el menú ⋯ del depósito y elegí {{Áreas}}.",
            "En la fila del área, hacé clic en el ícono de tacho.",
            "Confirmá con {{Borrar}}.",
          ],
          after: ["Aparece el aviso {{Área borrada.}}."],
          errors: [
            {
              message:
                "El área tiene pallets o tarifas: desactivala en lugar de borrarla.",
              fix: "Desactivá el área con su interruptor.",
            },
            {
              message: "No tenés permiso para editar áreas de depósito.",
              fix: "Pedile el cambio a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo borrar el área.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["desactivar-area-deposito"],
        },
        {
          id: "exportar-depositos",
          title: "Exportar la lista de depósitos",
          permission: "warehouses:read",
          screens: [
            {
              kind: "dialog",
              title: "Exportar",
              description:
                "Elegí el formato y el rango de fechas. También podés exportar todo el historial.",
              fields: [
                { label: "PDF", kind: "checkbox", value: "✓", marker: 2 },
                { label: "Excel", kind: "checkbox" },
                { label: "Desde", kind: "date", value: "01/11/2026" },
                { label: "Hasta", kind: "date", value: "05/11/2026" },
              ],
              footer: [
                { label: "Todo el historial", variant: "outline", marker: 3 },
                { label: "Descargar período", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/warehouses]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}}.",
            "Para filtrar por fecha de alta, ajustá {{Desde}} y {{Hasta}} (vienen con el mes en curso) y hacé clic en {{Descargar período}}; para todos, hacé clic en {{Todo el historial}}.",
          ],
          after: [
            "El PDF se abre en otra pestaña; el Excel se descarga. El rango filtra por la fecha en que se dio de alta cada depósito.",
          ],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Volvé a intentar o probá con PDF.",
            },
          ],
          keywords: ["descargar", "excel", "pdf", "listado"],
        },
      ],
    },

    // ── Productos ──────────────────────────────────────────────────────────
    {
      id: "productos-deposito",
      title: "Productos",
      menuPath: "Depósito › Productos",
      routes: ["/products"],
      permission: "products:read",
      intro: [
        "El catálogo de productos que cada cliente guarda en los depósitos. Cada producto es de un cliente. Columnas: {{Producto}}, {{Cliente}}, {{SKU}}, {{Unidad}} y el interruptor {{Activo}}.",
        "Al cargar un pallet se puede indicar el producto; solo se ofrecen los productos activos.",
      ],
      screens: [
        {
          kind: "page",
          title: "Productos",
          subtitle: "Catálogo de productos por cliente.",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo producto", variant: "primary" },
          ],
          table: {
            columns: ["Producto", "Cliente", "SKU", "Unidad", "Activo"],
            rows: [
              ["Caño PVC 110mm", "~Construcciones SA", "PVC-110", "m", "Sí"],
            ],
            rowMenu: true,
          },
        },
      ],
      tasks: [
        {
          id: "crear-producto",
          title: "Crear un producto",
          permission: "products:write",
          prerequisites: [
            "El cliente tiene que existir en Clientes.",
            "El rol Depósito ve los productos pero no los crea: lo hacen owner o admin.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo producto",
              description: "Producto del catálogo de un cliente.",
              fields: [
                {
                  label: "Cliente",
                  kind: "select",
                  value: "Construcciones SA",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Producto",
                  value: "Caño PVC 110mm",
                  marker: 2,
                  wide: true,
                },
                { label: "SKU", value: "PVC-110" },
                { label: "Unidad", value: "m" },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/products]], hacé clic en {{Nuevo producto}}.",
            {
              text: "Completá:",
              substeps: [
                "{{Cliente}}: obligatorio, el dueño de la mercadería.",
                "{{Producto}}: el nombre, obligatorio (hasta 160 caracteres).",
                "{{SKU}} (hasta 80) y {{Unidad}} (por ejemplo m, kg, u; hasta 40): opcionales.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: ["Aparece el aviso {{Producto creado.}} y queda activo."],
          errors: [
            {
              message: "Cliente requerido.",
              fix: "Elegí el cliente en {{Cliente}}.",
            },
            {
              message: "Nombre requerido.",
              fix: "Escribí el nombre en {{Producto}}.",
            },
            {
              message: "No tenés permiso para crear productos.",
              fix: "Pedile el alta a un owner o admin.",
            },
            {
              message: "No se pudo crear el producto.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["ingresar-pallet"],
          keywords: ["alta de producto", "artículo", "sku", "mercadería"],
        },
        {
          id: "editar-producto",
          title: "Editar un producto",
          permission: "products:write",
          steps: [
            "En [[/products]], en la fila del producto, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos que necesites.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: ["Aparece el aviso {{Cambios guardados.}}."],
          errors: [
            {
              message: "No tenés permiso para editar productos.",
              fix: "Pedile el cambio a un owner o admin.",
            },
            {
              message: "No se pudo actualizar el producto.",
              fix: "Volvé a intentar.",
            },
          ],
        },
        {
          id: "activar-desactivar-producto",
          title: "Desactivar o reactivar un producto",
          permission: "products:write",
          steps: [
            "En [[/products]], en la fila del producto, hacé clic en el interruptor de {{Activo}}.",
          ],
          after: [
            "Un producto inactivo deja de ofrecerse en {{Producto (opcional)}} al cargar pallets. Los pallets que ya lo tienen no cambian.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar productos.",
              fix: "Pedile el cambio a un owner o admin.",
            },
            {
              message: "No se pudo cambiar el estado.",
              fix: "Volvé a intentar.",
            },
          ],
        },
        {
          id: "borrar-producto",
          title: "Borrar un producto",
          permission: "products:write",
          steps: [
            "En [[/products]], en la fila del producto, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "Aparece el aviso {{Producto borrado.}}. Los pallets que tenían ese producto quedan sin producto (no se borran).",
          ],
          errors: [
            {
              message: "No tenés permiso para borrar productos.",
              fix: "Pedile la baja a un owner o admin.",
            },
            {
              message: "No se pudo borrar el producto.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["activar-desactivar-producto"],
        },
        {
          id: "exportar-productos",
          title: "Exportar el catálogo de productos",
          permission: "products:read",
          steps: [
            "En [[/products]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}} y hacé clic en {{Descargar período}} (filtra por fecha de alta entre {{Desde}} y {{Hasta}}) o en {{Todo el historial}}.",
          ],
          related: ["exportar-depositos"],
          keywords: ["descargar productos", "excel"],
        },
      ],
    },

    // ── Pallets ────────────────────────────────────────────────────────────
    {
      id: "pallets",
      title: "Pallets",
      menuPath: "Depósito › Pallets",
      routes: ["/pallets"],
      permission: "pallets:read",
      intro: [
        "Cada pallet es una unidad física guardada en un depósito para un cliente. La lista muestra {{Código}}, {{Depósito}}, {{Cliente}}, {{Producto}}, {{Área}}, {{Lote}} (con su vencimiento), {{Cant.}}, {{Estado}}, {{Ingreso}} y {{Salida}}, de la entrada más reciente a la más vieja.",
        "Arriba de la tabla, el selector {{Todos los clientes}} filtra los pallets de un cliente; {{Limpiar}} saca el filtro.",
        "Desde acá se registran los **movimientos de stock**: el ingreso de pallets (uno o varios), el despacho, el borrado y los cambios de depósito, estado, cantidad o fechas. Las fechas de ingreso y salida dicen cuántos días estuvo guardado cada pallet ([[#trazabilidad-pallets]]).",
      ],
      screens: [
        {
          kind: "page",
          title: "Pallets",
          subtitle: "Unidades físicas almacenadas por depósito y cliente.",
          actions: [
            { label: "Despachar", variant: "primary" },
            { label: "Exportar", variant: "outline" },
            { label: "Cargar varios", variant: "outline" },
            { label: "Nuevo pallet", variant: "primary" },
          ],
          toolbar: [{ label: "Todos los clientes", kind: "picker" }],
          table: {
            columns: [
              "Código",
              "Depósito",
              "Cliente",
              "Producto",
              "Área",
              "Lote",
              "Cant.",
              "Estado",
              "Ingreso",
              "Salida",
            ],
            rows: [
              [
                "PAL-0012",
                "Depósito Central",
                "~Construcciones SA",
                "Caño PVC 110mm",
                "Rack",
                "L-2026-10",
                "40",
                "En depósito",
                "2026-10-03",
                "—",
              ],
              [
                "PAL-0007",
                "Depósito Central",
                "~Construcciones SA",
                "—",
                "—",
                "—",
                "—",
                "Despachado",
                "2026-09-12",
                "2026-10-20",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Estados de un pallet",
          body: [
            "{{En depósito}}: está guardado; se puede despachar o bloquear.",
            "{{Despachado}}: ya salió. Su {{Salida}} es el último día que estuvo guardado.",
            "{{Bloqueado}} se muestra además del estado: el pallet sigue en depósito pero no se puede despachar ni borrar hasta que alguien lo desbloquee (mercadería dañada, retenida por el cliente, control de calidad…).",
          ],
        },
        {
          title: "Quién puede mover stock",
          body: [
            "Editar datos que no mueven stock (cliente, producto, área, código, lote, notas) y bloquear o desbloquear pide `pallets:write`.",
            "Ingresar, despachar o borrar pallets, y cambiar el depósito, el estado, la cantidad, el ingreso o el egreso, pide además `stock_movements:write`. Sin él, los botones {{Nuevo pallet}}, {{Cargar varios}} y {{Borrar}} y las casillas para despachar no aparecen, y en {{Editar pallet}} esos campos quedan deshabilitados con el aviso «Depósito, estado, cantidad y fechas mueven stock: no tenés permiso para cambiarlos.».",
            "Sin `pallets:write` la lista es de solo lectura: no aparece el menú ⋯ de cada fila.",
          ],
        },
      ],
      tasks: [
        {
          id: "ingresar-pallet",
          title: "Ingresar un pallet",
          summary: "Registra la entrada de un pallet al depósito.",
          permission: ["pallets:write", "stock_movements:write"],
          prerequisites: [
            "Un depósito activo ([[#crear-deposito]]) y el cliente dado de alta.",
            "Opcional: el producto ([[#crear-producto]]) y el área ([[#agregar-area-deposito]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo pallet",
              description:
                "Unidad física almacenada: depósito, cliente y producto.",
              fields: [
                {
                  label: "Depósito",
                  kind: "select",
                  value: "Depósito Central",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Área (opcional)",
                  kind: "select",
                  value: "Rack",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Construcciones SA",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Producto (opcional)",
                  kind: "select",
                  value: "Ninguno",
                  wide: true,
                },
                { label: "Código", value: "P-001", marker: 2 },
                { label: "Estado", kind: "select", value: "En depósito" },
                { label: "Lote (opcional)", value: "L-2026-10" },
                { label: "Vencimiento del lote", kind: "date" },
                { label: "Cantidad", value: "40", wide: true },
                {
                  label: "Ingreso",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 2,
                },
                { label: "Egreso (opcional)", kind: "date" },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/pallets]], hacé clic en {{Nuevo pallet}}.",
            {
              text: "Completá el formulario:",
              substeps: [
                "{{Depósito}}: obligatorio; solo aparecen los depósitos activos.",
                "{{Área (opcional)}}: se habilita al elegir un depósito que tenga áreas activas; {{Sin área}} deja el pallet en el depósito sin área.",
                "{{Cliente}}: obligatorio; podés buscarlo escribiendo.",
                "{{Producto (opcional)}}: un producto activo, o {{Ninguno}}.",
                "{{Código}}: obligatorio (hasta 60 caracteres) y único entre todos los pallets.",
                "{{Estado}}: viene en {{En depósito}}.",
                "{{Lote (opcional)}} y {{Vencimiento del lote}}.",
                "{{Cantidad}}: opcional, un número mayor o igual a 0 (admite decimales).",
                "{{Ingreso}}: obligatorio, la fecha en que entró.",
                "{{Egreso (opcional)}}: solo si el pallet ya salió.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "Aparece el aviso {{Pallet creado.}} y el pallet entra en la lista y en [[/pallets/trazabilidad]].",
          ],
          errors: [
            {
              message: "Depósito requerido.",
              fix: "Elegí el depósito.",
            },
            {
              message: "Cliente requerido.",
              fix: "Elegí el cliente.",
            },
            {
              message: "Código requerido.",
              fix: "Escribí un código para el pallet.",
            },
            {
              message: "Fecha requerida.",
              fix: "Completá la fecha de {{Ingreso}}.",
            },
            {
              message: "Ya existe un pallet con ese código.",
              fix: "Usá otro código: no puede repetirse.",
            },
            {
              message: "El área no es del depósito del pallet.",
              fix: "Elegí un área del depósito seleccionado (o {{Sin área}}).",
            },
            {
              message: "No tenés permiso para crear pallets.",
              fix: "Hace falta `pallets:write` y `stock_movements:write`: pedíselo a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo crear el pallet.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["cargar-varios-pallets", "despachar-pallets"],
          keywords: [
            "ingreso de mercadería",
            "entrada",
            "alta de pallet",
            "recepción",
            "stock",
          ],
        },
        {
          id: "cargar-varios-pallets",
          title: "Ingresar varios pallets de una vez",
          summary:
            "Para una recepción de muchos pallets iguales: se cargan los datos una vez y el sistema genera los códigos.",
          permission: ["pallets:write", "stock_movements:write"],
          prerequisites: ["Un depósito activo y el cliente dado de alta."],
          screens: [
            {
              kind: "dialog",
              title: "Cargar varios pallets",
              description:
                "Datos compartidos una vez + la cantidad. Los códigos se generan automáticamente.",
              fields: [
                {
                  label: "Depósito",
                  kind: "select",
                  value: "Depósito Central",
                  marker: 2,
                  wide: true,
                },
                { label: "Área (opcional)", kind: "select", wide: true },
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Construcciones SA",
                  marker: 2,
                  wide: true,
                },
                { label: "Producto (opcional)", kind: "select", wide: true },
                {
                  label: "Fecha de ingreso",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 2,
                },
                { label: "Cantidad por pallet", value: "40" },
                { label: "Cantidad de pallets", value: "10", marker: 2 },
                { label: "Prefijo de código", value: "PAL", marker: 2 },
                { label: "Lote (opcional)" },
                { label: "Vencimiento del lote", kind: "date" },
                { label: "Notas (opcional)", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/pallets]], hacé clic en {{Cargar varios}}.",
            {
              text: "Completá los datos compartidos y la cantidad:",
              substeps: [
                "{{Depósito}}, {{Cliente}} y {{Fecha de ingreso}}: obligatorios.",
                "{{Área (opcional)}}, {{Producto (opcional)}}, {{Lote (opcional)}}, {{Vencimiento del lote}} y {{Notas (opcional)}}: se aplican a todos.",
                "{{Cantidad por pallet}}: opcional, la cantidad de mercadería de cada uno.",
                "{{Cantidad de pallets}}: cuántos pallets crear, entre 1 y 500.",
                "{{Prefijo de código}}: viene `PAL`; solo letras, números o guion (hasta 40). Debajo se ve un ejemplo de los códigos que se van a generar.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "Se crean todos los pallets, en estado {{En depósito}}, con códigos `PREFIJO-0001`, `PREFIJO-0002`… que continúan la numeración que ya existe para ese prefijo (si ya hay hasta `PAL-0012`, empieza en `PAL-0013`). Si otro usuario carga pallets con el mismo prefijo al mismo tiempo, una carga espera a la otra y sigue su numeración: los códigos no se repiten.",
            "El aviso dice cuántos se crearon, por ejemplo «10 pallets creados.».",
          ],
          errors: [
            {
              message: "Entre 1 y 500.",
              fix: "Cargá como máximo 500 pallets por vez; para más, repetí la carga.",
            },
            {
              message: "Ingresá una cantidad.",
              fix: "Completá {{Cantidad de pallets}} con un número entero.",
            },
            {
              message: "Prefijo requerido.",
              fix: "Escribí un prefijo (por ejemplo `PAL`).",
            },
            {
              message: "Solo letras, números o guion.",
              fix: "Sacá espacios y símbolos del prefijo.",
            },
            {
              message: "El área no es del depósito de los pallets.",
              fix: "Elegí un área del depósito seleccionado.",
            },
            {
              message: "No tenés permiso para crear pallets.",
              fix: "Pedíselo a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudieron crear los pallets.",
              fix: "Volvé a intentar; no se creó ninguno.",
            },
          ],
          related: ["ingresar-pallet"],
          keywords: ["carga masiva", "recepción", "muchos pallets", "lote"],
        },
        {
          id: "editar-pallet",
          title: "Editar un pallet",
          permission: "pallets:write",
          prerequisites: [
            "Para cambiar {{Depósito}}, {{Estado}}, {{Cantidad}}, {{Ingreso}} o {{Egreso (opcional)}} hace falta también `stock_movements:write` (ver [[#pallets]]).",
          ],
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar", marker: 1 },
                { label: "Bloquear" },
                { label: "Borrar", destructive: true },
              ],
            },
          ],
          steps: [
            "En [[/pallets]], en la fila del pallet, abrí el menú ⋯ ({{Acciones}}) y elegí {{Editar}}.",
            "Cambiá los campos que necesites. Si cambiás el {{Depósito}}, el área se vacía: elegila de nuevo.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "Aparece el aviso {{Cambios guardados.}}.",
            "Un cambio de {{Ingreso}} o {{Egreso (opcional)}} cambia los días que estuvo guardado.",
          ],
          errors: [
            {
              message: "No tenés permiso para registrar movimientos de stock.",
              fix: "Cambiaste un campo que mueve stock sin tener `stock_movements:write`: dejalo como estaba o pedile el cambio a alguien con rol Depósito.",
            },
            {
              message:
                "El pallet … está bloqueado (…): desbloquealo antes de darle salida.",
              fix: "Un pallet bloqueado no puede pasar a {{Despachado}} ni tener egreso: desbloquealo primero ([[#desbloquear-pallet]]).",
            },
            {
              message: "Ya existe un pallet con ese código.",
              fix: "Usá otro código.",
            },
            {
              message: "El área no es del depósito del pallet.",
              fix: "Elegí un área del depósito del pallet.",
            },
            {
              message: "El pallet no existe.",
              fix: "Otro usuario lo borró: actualizá la pantalla.",
            },
            {
              message:
                "El pallet cambió mientras lo editabas: volvé a abrirlo.",
              fix: "Sin `stock_movements:write`, otro usuario movió el pallet (depósito, estado, cantidad o fechas) mientras tenías abierto el diálogo: cerralo, abrilo de nuevo y repetí el cambio.",
            },
            {
              message: "No tenés permiso para editar pallets.",
              fix: "Pedile el cambio a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo actualizar el pallet.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["cambiar-ubicacion-pallet", "despachar-pallets"],
          keywords: [
            "modificar pallet",
            "corregir pallet",
            "lote",
            "vencimiento",
          ],
        },
        {
          id: "cambiar-ubicacion-pallet",
          title: "Cambiar un pallet de área o de depósito",
          summary:
            "Mover un pallet a otra área del mismo depósito no es un movimiento de stock; pasarlo a otro depósito sí.",
          permission: "pallets:write",
          prerequisites: [
            "Para cambiar de depósito hace falta también `stock_movements:write`.",
          ],
          steps: [
            "En [[/pallets]], en la fila del pallet, abrí el menú ⋯ y elegí {{Editar}}.",
            "Para cambiar de área, elegí otra en {{Área (opcional)}} (o {{Sin área}}). Para cambiar de depósito, elegilo en {{Depósito}} y después el área.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "La columna {{Área}} (y {{Depósito}}) muestran la nueva ubicación.",
          ],
          errors: [
            {
              message: "El área no es del depósito del pallet.",
              fix: "Elegí un área del depósito del pallet.",
            },
            {
              message: "No tenés permiso para registrar movimientos de stock.",
              fix: "Cambiar de depósito pide `stock_movements:write`.",
            },
          ],
          related: ["agregar-area-deposito"],
          keywords: ["ubicación", "mover pallet", "reubicar", "trasladar"],
        },
        {
          id: "despachar-pallets",
          title: "Despachar pallets",
          summary: "Da salida a uno o varios pallets en una fecha.",
          permission: ["pallets:write", "stock_movements:write"],
          screens: [
            {
              kind: "dialog",
              title: "Despachar pallets",
              description:
                "~Vas a dar salida a 3 pallets en la fecha de salida.",
              fields: [
                {
                  label: "Fecha de salida",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 3,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Despachar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/pallets]], si querés, filtrá por cliente con {{Todos los clientes}}.",
            "Marcá la casilla de cada pallet a despachar (o la del encabezado, {{Seleccionar todos}}). Solo tienen casilla los pallets {{En depósito}} que no están bloqueados.",
            "Hacé clic en {{Despachar}}: el botón aparece arriba recién cuando marcaste alguno y muestra cuántos. Revisá {{Fecha de salida}}: viene con la fecha de hoy.",
            "Hacé clic en {{Despachar}}.",
          ],
          after: [
            "Los pallets pasan a {{Despachado}} con esa fecha en {{Salida}}. El aviso dice cuántos se despacharon.",
            "Si alguno se bloqueó mientras tanto, queda en depósito y un segundo aviso dice cuántos quedaron por estar bloqueados.",
          ],
          errors: [
            {
              message: "Seleccioná al menos un pallet.",
              fix: "Marcá al menos un pallet.",
            },
            {
              message: "Máximo 500 pallets por despacho.",
              fix: "Despachá en tandas de hasta 500.",
            },
            {
              message: "Fecha requerida.",
              fix: "Completá {{Fecha de salida}}.",
            },
            {
              message: "No tenés permiso para despachar pallets.",
              fix: "Pedile el despacho a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudieron despachar los pallets.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["bloquear-pallet"],
          keywords: ["egreso", "salida", "despacho", "retiro de mercadería"],
        },
        {
          id: "bloquear-pallet",
          title: "Bloquear un pallet",
          summary:
            "Un pallet bloqueado queda en el depósito: no se despacha ni se borra hasta que alguien lo desbloquee.",
          permission: "pallets:write",
          prerequisites: [
            "El pallet está {{En depósito}} y sin fecha de salida.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Bloquear pallet PAL-0012",
              description:
                "Un pallet bloqueado no se despacha ni se borra hasta que se desbloquee. Queda registrado quién lo hizo, cuándo y por qué.",
              fields: [
                {
                  label: "Motivo",
                  kind: "textarea",
                  value: "Mercadería dañada",
                  marker: 2,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Bloquear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/pallets]], en la fila del pallet, abrí el menú ⋯ y elegí {{Bloquear}}.",
            "Escribí el {{Motivo}} (obligatorio, hasta 500 caracteres). Debajo ves el {{Historial de bloqueos}} del pallet.",
            "Hacé clic en {{Bloquear}}.",
          ],
          after: [
            "El pallet muestra {{Bloqueado}} junto a su estado (al pasar el mouse se ve el motivo) y pierde su casilla de despacho.",
            "Queda en el historial quién lo bloqueó, cuándo y por qué.",
            "Sigue en el depósito: el bloqueo no le da salida.",
          ],
          errors: [
            {
              message: "Contá el motivo del bloqueo.",
              fix: "Escribí el motivo.",
            },
            {
              message: "El pallet no existe o ya está bloqueado.",
              fix: "Otro usuario ya lo bloqueó o lo borró: actualizá la pantalla.",
            },
            {
              message:
                "Solo se bloquea un pallet en depósito: el pallet … ya salió.",
              fix: "Un pallet despachado no se bloquea.",
            },
            {
              message: "No tenés permiso para bloquear pallets.",
              fix: "Pedíselo a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo bloquear el pallet.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["desbloquear-pallet"],
          keywords: [
            "retener",
            "retenido",
            "dañado",
            "control de calidad",
            "inmovilizar",
          ],
        },
        {
          id: "desbloquear-pallet",
          title: "Desbloquear un pallet",
          permission: "pallets:write",
          steps: [
            "En [[/pallets]], en la fila del pallet bloqueado, abrí el menú ⋯ y elegí {{Desbloquear}}.",
            "Escribí el {{Motivo}} del desbloqueo (obligatorio, hasta 500 caracteres); el diálogo muestra por qué se había bloqueado.",
            "Hacé clic en {{Desbloquear}}.",
          ],
          after: [
            "El pallet vuelve a poder despacharse y borrarse. El desbloqueo, con su motivo, queda en el {{Historial de bloqueos}}.",
          ],
          errors: [
            {
              message: "Contá por qué se desbloquea.",
              fix: "Escribí el motivo.",
            },
            {
              message: "El pallet no existe o no está bloqueado.",
              fix: "Otro usuario ya lo desbloqueó: actualizá la pantalla.",
            },
            {
              message: "No tenés permiso para desbloquear pallets.",
              fix: "Pedíselo a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo desbloquear el pallet.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["bloquear-pallet"],
          keywords: ["liberar pallet"],
        },
        {
          id: "borrar-pallet",
          title: "Borrar un pallet",
          summary:
            "Para un pallet cargado por error. Para registrar una salida real, despachalo.",
          permission: ["pallets:write", "stock_movements:write"],
          steps: [
            "En [[/pallets]], en la fila del pallet, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "Aparece el aviso {{Pallet borrado.}}. Deja de contar en la trazabilidad.",
          ],
          errors: [
            {
              message:
                "El pallet … está bloqueado (…): desbloquealo antes de borrarlo.",
              fix: "Desbloquealo primero ([[#desbloquear-pallet]]).",
            },
            {
              message: "No tenés permiso para borrar pallets.",
              fix: "Pedile la baja a alguien con rol Depósito, admin u owner.",
            },
            {
              message: "No se pudo borrar el pallet.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["despachar-pallets"],
          keywords: ["eliminar pallet", "carga errónea"],
        },
        {
          id: "exportar-pallets",
          title: "Exportar los pallets",
          permission: "pallets:read",
          steps: [
            "En [[/pallets]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}} y hacé clic en {{Descargar período}} (pallets con ingreso entre {{Desde}} y {{Hasta}}) o en {{Todo el historial}}.",
          ],
          after: [
            "El listado incluye código, cliente, depósito, área, producto, lote, cantidad, estado e ingreso. No aplica el filtro de cliente de la pantalla.",
          ],
          related: ["exportar-depositos"],
          keywords: ["stock por cliente", "inventario", "excel"],
        },
      ],
    },

    // ── Trazabilidad ───────────────────────────────────────────────────────
    {
      id: "trazabilidad-pallets",
      title: "Trazabilidad de pallets",
      menuPath: "Depósito › Trazabilidad",
      routes: ["/pallets/trazabilidad"],
      permission: "pallets:read",
      intro: [
        "Historial de ingresos y egresos de todos los pallets: cuándo entró cada uno, cuándo salió y cuántos días estuvo almacenado. Es solo de consulta.",
        "Arriba, cuatro totales sobre lo filtrado: {{Pallets}}, {{En depósito}}, {{Despachados}} y {{Días almacenados}}.",
        "La tabla muestra {{Código}}, {{Cliente}}, {{Depósito}}, {{Área}}, {{Producto}}, {{Lote}}, {{Cant.}}, {{Ingreso}}, {{Salida}}, {{Días}} y {{Estado}}, de a 20 filas por página, del ingreso más reciente al más viejo.",
      ],
      screens: [
        {
          kind: "page",
          title: "Trazabilidad de pallets",
          subtitle:
            "Historial de ingresos y egresos: cuándo entró, cuándo salió y cuántos días estuvo almacenado.",
          stats: [
            { label: "Pallets", value: "42" },
            { label: "En depósito", value: "30" },
            { label: "Despachados", value: "12" },
            { label: "Días almacenados", value: "1.284" },
          ],
          toolbar: [
            { label: "Todos los clientes", kind: "picker" },
            { label: "Todos", kind: "select" },
          ],
          table: {
            columns: [
              "Código",
              "Cliente",
              "Depósito",
              "Área",
              "Producto",
              "Lote",
              "Cant.",
              "Ingreso",
              "Salida",
              "Días",
              "Estado",
            ],
            rows: [
              [
                "PAL-0007",
                "~Construcciones SA",
                "Depósito Central",
                "—",
                "—",
                "—",
                "—",
                "2026-09-12",
                "2026-10-20",
                "39",
                "Despachado",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Cómo se cuentan los días",
          body: [
            "Se cuentan los días corridos desde el ingreso hasta la salida, los dos incluidos. Si el pallet sigue en depósito, se cuenta hasta hoy.",
          ],
        },
      ],
      tasks: [
        {
          id: "consultar-trazabilidad-pallets",
          title: "Consultar la historia de los pallets de un cliente",
          permission: "pallets:read",
          steps: [
            "Entrá en [[/pallets/trazabilidad]].",
            "En {{Todos los clientes}}, elegí el cliente (podés escribir para buscarlo).",
            "En el selector de estado elegí {{Todos}}, {{En depósito}} o {{Despachado}}.",
            "Hacé clic en el título de una columna para ordenar por ella; usá la paginación de abajo para ver más filas.",
          ],
          after: [
            "Los totales de arriba se recalculan con el filtro: por ejemplo, {{Días almacenados}} de un cliente suma los días de todos sus pallets.",
          ],
          related: ["pallets"],
          keywords: [
            "historial de pallets",
            "días de almacenaje",
            "movimientos",
            "ingresos y egresos",
          ],
        },
      ],
    },
  ],
};
