import type { GuidePage } from "../types";

// Depósito: warehouses and their areas, the product catalog, pallets (entry,
// dispatch, location, blocking), traceability, storage tariffs and the
// monthly storage billing per client.

export const warehousePage: GuidePage = {
  file: "deposito.html",
  title: "Depósito",
  lead: "El almacenaje de mercadería de los clientes: depósitos y áreas, productos, ingreso y despacho de pallets, bloqueos, tarifas de almacenaje y la facturación del almacenaje de cada cliente.",
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
                "Zonas del depósito (cámara de frío, a granel, rack). El tarifario del cliente puede tener un precio por área.",
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
            "Desde ese momento se puede elegir en {{Área (opcional)}} al cargar un pallet de ese depósito, y en el tarifario de un cliente para cobrarle un precio por área.",
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
        "Desde acá se registran los **movimientos de stock**: el ingreso de pallets (uno o varios), el despacho, el borrado y los cambios de depósito, estado, cantidad o fechas. Las fechas de ingreso y salida son las que usa la facturación del almacenaje ([[#facturacion-almacenaje]]).",
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
            "{{En depósito}}: está guardado; suma días de almacenaje y se puede despachar o bloquear.",
            "{{Despachado}}: ya salió. Su {{Salida}} corta los días de almacenaje y, si cae en el período que se factura, se cobra la descarga.",
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
                "{{Ingreso}}: obligatorio, la fecha en que entró. Desde ese día cuenta el almacenaje.",
                "{{Egreso (opcional)}}: solo si el pallet ya salió.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "Aparece el aviso {{Pallet creado.}} y el pallet entra en la lista y en [[/pallets/trazabilidad]].",
            "Si su {{Ingreso}} cae dentro del período que se factura, se cobra la carga (por pallet) además de los días de almacenaje ([[#facturacion-almacenaje]]).",
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
            "Se crean todos los pallets, en estado {{En depósito}}, con códigos `PREFIJO-0001`, `PREFIJO-0002`… que continúan la numeración que ya existe para ese prefijo (si ya hay hasta `PAL-0012`, empieza en `PAL-0013`).",
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
              message: "Se generó un código repetido, volvé a intentar.",
              fix: "Otro usuario cargó pallets con el mismo prefijo al mismo tiempo: hacé clic en {{Crear}} de nuevo.",
            },
            {
              message: "El área no es del depósito de los pallets.",
              fix: "Elegí un área del depósito seleccionado.",
            },
            {
              message: "No se pudieron generar los códigos.",
              fix: "Volvé a intentar.",
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
            "Un cambio de {{Ingreso}} o {{Egreso (opcional)}} cambia los días de almacenaje y en qué período se cobran la carga y la descarga.",
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
            "La columna {{Área}} (y {{Depósito}}) muestran la nueva ubicación. El área decide qué precio por área se cobra (el del tarifario del cliente o, si no tiene, una tarifa general de esa área); la facturación usa el área que el pallet tiene al momento de facturar, para todo el período.",
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
          summary:
            "Da salida a uno o varios pallets en una fecha: corta el almacenaje y cobra la descarga.",
          permission: ["pallets:write", "stock_movements:write"],
          screens: [
            {
              kind: "dialog",
              title: "Despachar pallets",
              description:
                "~Vas a dar salida a 3 pallets. Se cobra la descarga y se corta el almacenaje en la fecha de salida.",
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
            "En la facturación, la fecha de salida es el último día de almacenaje del pallet y, si cae en el período, se cobra la descarga.",
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
          related: ["bloquear-pallet", "facturar-almacenaje"],
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
            "Sigue sumando días de almacenaje: el bloqueo no corta la facturación.",
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
            "Aparece el aviso {{Pallet borrado.}}. Deja de contar en la facturación de almacenaje y en la trazabilidad.",
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
          related: ["pallets", "facturacion-almacenaje"],
          keywords: [
            "historial de pallets",
            "días de almacenaje",
            "movimientos",
            "ingresos y egresos",
          ],
        },
      ],
    },

    // ── Tarifas ────────────────────────────────────────────────────────────
    {
      id: "tarifas-almacenaje",
      title: "Tarifas de almacenaje",
      menuPath: "Depósito › Tarifas",
      routes: ["/storage-tariffs"],
      permission: "storage_billing:read",
      intro: [
        "Las tarifas por pallet que usa la facturación del almacenaje, con su vigencia. Una tarifa sin cliente es **general** y aplica a todos los clientes que no tengan una propia.",
        "Columnas: {{Cliente}} (o {{General}}, con el área si la tiene), {{Tarifa}} (por pallet, {{Diario}} o {{Mensual}}), {{Carga}} y {{Descarga}} (por pallet), {{Vigencia}} (desde → hasta), {{Estado}} ({{Vigente}}, {{Vencida}} o {{Futura}} según la fecha de hoy) y el interruptor {{Activo}}.",
        "Las tarifas viejas no se borran al aumentar: quedan como historial con su vigencia cerrada.",
      ],
      screens: [
        {
          kind: "page",
          title: "Tarifas de almacenaje",
          subtitle:
            "Tarifas por pallet con vigencia. Una tarifa sin cliente aplica como general para todos.",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Aumentar %", variant: "outline" },
            { label: "Nueva tarifa", variant: "primary" },
          ],
          table: {
            columns: [
              "Cliente",
              "Tarifa",
              "Carga",
              "Descarga",
              "Vigencia",
              "Estado",
              "Activo",
            ],
            rows: [
              [
                "General",
                "~$1.500/pallet Mensual",
                "~$800",
                "~$800",
                "2026-10-01 → —",
                "Vigente",
                "Sí",
              ],
              [
                "General",
                "~$1.300/pallet Mensual",
                "~$700",
                "~$700",
                "2026-01-01 → 2026-09-30",
                "Vencida",
                "Sí",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Qué tarifa se aplica",
          body: [
            "Primero manda el tarifario del cliente (en el detalle del cliente), día por día: la tarifa del cliente para el área del pallet y, si no, la del cliente para todas las áreas.",
            "Los días, cargas y descargas que el tarifario no cubre se valorizan con una sola tarifa de esta pantalla para todo el período que se factura: la del cliente si tiene; si no, la general del área del pallet; si no, la general para todas las áreas. Entre las de un mismo nivel, la de inicio más reciente que se superponga con el período. Por eso, si un período cruza la fecha de un aumento, todo el período se cobra con la tarifa nueva: facturá hasta el día anterior al aumento y después el resto.",
            "Una tarifa general con área se cobra solo a los pallets de esa área; los pallets de otra área o sin área usan la general para todas las áreas. La vista previa y la factura aplican la misma regla.",
            "Una tarifa de cliente nunca lleva área: los precios por área de un cliente van en su tarifario, en el detalle del cliente.",
            "Una tarifa con el interruptor {{Activo}} apagado no se usa para facturar.",
          ],
        },
        {
          title: "Tarifas pasadas al tarifario del cliente",
          body: [
            "Una fila con la leyenda {{En el tarifario del cliente (se edita ahí)}} ya se copió al tarifario del cliente con los mismos precios y vigencia. Queda como respaldo: su precio y vigencia no se cambian acá, y el aumento masivo la saltea.",
          ],
        },
        {
          title: "Mensual y diaria",
          body: [
            "Una tarifa {{Mensual}} se cobra por día como la tarifa dividida 30; una {{Diario}}, por día tal cual. La carga se cobra una vez, el día de ingreso; la descarga una vez, el día de salida.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-tarifa-almacenaje",
          title: "Crear una tarifa de almacenaje",
          permission: "storage_billing:issue",
          screens: [
            {
              kind: "dialog",
              title: "Nueva tarifa",
              description:
                "Tarifa de almacenaje por pallet con vigencia. Dejá el cliente en general para una tarifa por defecto.",
              fields: [
                {
                  label: "Cliente (opcional)",
                  kind: "select",
                  value: "General (todos)",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Área (opcional)",
                  kind: "select",
                  value: "Todas las áreas",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Tarifa por pallet",
                  kind: "money",
                  value: "1.500",
                  marker: 2,
                },
                {
                  label: "Período",
                  kind: "select",
                  value: "Mensual",
                  marker: 2,
                },
                { label: "Carga (por pallet)", kind: "money", value: "800" },
                { label: "Descarga (por pallet)", kind: "money", value: "800" },
                {
                  label: "Vigente desde",
                  kind: "date",
                  value: "01/11/2026",
                  marker: 2,
                },
                { label: "Vigente hasta (opcional)", kind: "date" },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/storage-tariffs]], hacé clic en {{Nueva tarifa}}.",
            {
              text: "Completá:",
              substeps: [
                "{{Cliente (opcional)}}: un cliente, o {{General (todos)}} para la tarifa por defecto.",
                "{{Área (opcional)}}: aparece solo en una tarifa general. {{Todas las áreas}}, o un área («Depósito · Área»). Con un área, la tarifa se cobra solo a los pallets de esa área (ver [[#tarifas-almacenaje]]).",
                "{{Tarifa por pallet}}: obligatoria, mayor a 0.",
                "{{Período}}: {{Mensual}} o {{Diario}}.",
                "{{Carga (por pallet)}} y {{Descarga (por pallet)}}: vienen en 0; montos de 0 o más.",
                "{{Vigente desde}}: obligatoria. {{Vigente hasta (opcional)}}: vacía = sin fin; no puede ser anterior al inicio.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "Aparece el aviso {{Tarifa creada.}}. La facturación de almacenaje la usa para los días dentro de su vigencia.",
          ],
          errors: [
            {
              message: "La tarifa debe ser mayor a 0.",
              fix: "Cargá un monto positivo en {{Tarifa por pallet}}.",
            },
            {
              message: "Monto inválido.",
              fix: "Revisá {{Carga (por pallet)}} y {{Descarga (por pallet)}}.",
            },
            {
              message: "Fecha requerida.",
              fix: "Completá {{Vigente desde}}.",
            },
            {
              message: "El fin de vigencia no puede ser anterior al inicio.",
              fix: "Corregí {{Vigente hasta (opcional)}} o dejalo vacío.",
            },
            {
              message:
                "La tarifa por área es general: la de un cliente va en su tarifario.",
              fix: "Para un precio por área de un cliente, cargalo en el tarifario del cliente.",
            },
            {
              message: "No tenés permiso para crear tarifas.",
              fix: "Pedíselo a alguien con rol Finanzas, admin u owner.",
            },
            {
              message: "No se pudo crear la tarifa.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["aumentar-tarifas-almacenaje", "facturar-almacenaje"],
          keywords: ["precio por pallet", "tarifa general", "tarifa por área"],
        },
        {
          id: "editar-tarifa-almacenaje",
          title: "Editar una tarifa",
          summary:
            "Para corregir una tarifa. Para un aumento, mejor usá [[#aumentar-tarifas-almacenaje]], que guarda el historial.",
          permission: "storage_billing:issue",
          steps: [
            "En [[/storage-tariffs]], en la fila de la tarifa, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "Aparece el aviso {{Cambios guardados.}}. Las facturas de almacenaje ya emitidas no cambian; los períodos que se facturen después usan el valor nuevo.",
          ],
          errors: [
            {
              message:
                "Esta tarifa pasó al tarifario del cliente: cambiala en el detalle del cliente › Tarifario.",
              fix: "La fila dice {{En el tarifario del cliente (se edita ahí)}}: su precio y vigencia se cambian en el tarifario del cliente (en el detalle del cliente).",
            },
            {
              message: "No se pudo actualizar la tarifa.",
              fix: "Volvé a intentar.",
            },
            {
              message: "No tenés permiso para editar tarifas.",
              fix: "Pedíselo a alguien con rol Finanzas, admin u owner.",
            },
          ],
          related: ["aumentar-tarifas-almacenaje"],
        },
        {
          id: "aumentar-tarifas-almacenaje",
          title: "Aumentar todas las tarifas un porcentaje",
          summary:
            "Aplica un aumento a todas las tarifas vigentes desde una fecha, sin perder las anteriores.",
          permission: "storage_billing:issue",
          screens: [
            {
              kind: "dialog",
              title: "Aumentar tarifas",
              description:
                "Se crea una tarifa nueva por cada vigente (tarifa y carga/descarga ajustadas por el porcentaje) y la anterior se cierra el día anterior. El historial queda en la tabla.",
              fields: [
                { label: "Porcentaje", value: "15", marker: 2 },
                {
                  label: "Vigente desde",
                  kind: "date",
                  value: "01/12/2026",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Aplicar aumento", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/storage-tariffs]], hacé clic en {{Aumentar %}}.",
            "Escribí el {{Porcentaje}} (por ejemplo `15`; admite decimales y negativos para una baja, mayor a -100) y la fecha {{Vigente desde}} (viene con hoy). Debajo se lista a qué tarifas afecta.",
            "Hacé clic en {{Aplicar aumento}}.",
          ],
          after: [
            "Por cada tarifa activa que empezó antes de esa fecha y sigue vigente en ella se crea una nueva, sin fin, con la tarifa, la carga y la descarga multiplicadas por el porcentaje (redondeadas a centavos) y una nota «Aumento 15% s/ $…». La anterior se cierra el día previo y queda como historial.",
            "Las tarifas que empiezan en esa fecha o después se saltean (editalas a mano); el aviso dice cuántas se actualizaron y cuántas se saltearon.",
            "Las tarifas pasadas al tarifario del cliente no se aumentan acá ni aparecen en la lista del diálogo: se aumentan en el tarifario.",
          ],
          errors: [
            {
              message:
                "No hay tarifas vigentes anteriores a esa fecha para aumentar.",
              fix: "Elegí una fecha posterior al inicio de las tarifas vigentes.",
            },
            {
              message: "El porcentaje no puede ser 0.",
              fix: "Escribí un porcentaje distinto de 0.",
            },
            {
              message: "El porcentaje no puede ser -100% o menor.",
              fix: "Para una baja, usá un porcentaje mayor a -100.",
            },
            {
              message: "Porcentaje demasiado alto.",
              fix: "El máximo es 1000%.",
            },
            {
              message: "No tenés permiso para editar tarifas.",
              fix: "Pedíselo a alguien con rol Finanzas, admin u owner.",
            },
            {
              message: "No se pudo aplicar el aumento.",
              fix: "Volvé a intentar: no se cambió ninguna tarifa.",
            },
          ],
          related: ["crear-tarifa-almacenaje"],
          keywords: [
            "actualizar tarifas",
            "aumento",
            "inflación",
            "ajuste de precios",
            "historial de tarifas",
          ],
        },
        {
          id: "activar-desactivar-tarifa-almacenaje",
          title: "Desactivar o reactivar una tarifa",
          permission: "storage_billing:issue",
          steps: [
            "En [[/storage-tariffs]], en la fila de la tarifa, hacé clic en el interruptor de {{Activo}}.",
          ],
          after: [
            "Una tarifa inactiva deja de usarse para facturar y el aumento masivo la saltea. Si no queda otra que cubra esos días, la facturación avisa que hay pallets sin tarifa.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar tarifas.",
              fix: "Pedíselo a alguien con rol Finanzas, admin u owner.",
            },
            {
              message: "No se pudo cambiar el estado.",
              fix: "Volvé a intentar.",
            },
          ],
        },
        {
          id: "borrar-tarifa-almacenaje",
          title: "Borrar una tarifa",
          permission: "storage_billing:issue",
          steps: [
            "En [[/storage-tariffs]], en la fila de la tarifa, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}} («Se elimina la tarifa. No se puede deshacer.»).",
          ],
          after: [
            "Aparece el aviso {{Tarifa borrada.}}. Las facturas ya emitidas no cambian.",
          ],
          errors: [
            {
              message: "No tenés permiso para borrar tarifas.",
              fix: "Pedíselo a alguien con rol Finanzas, admin u owner.",
            },
            {
              message: "No se pudo borrar la tarifa.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["activar-desactivar-tarifa-almacenaje"],
        },
        {
          id: "exportar-tarifas-almacenaje",
          title: "Exportar las tarifas",
          permission: "storage_billing:read",
          steps: [
            "En [[/storage-tariffs]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}} y hacé clic en {{Descargar período}} (tarifas que empiezan entre {{Desde}} y {{Hasta}}) o en {{Todo el historial}}.",
          ],
          related: ["exportar-depositos"],
          keywords: ["lista de precios", "tarifario"],
        },
      ],
    },

    // ── Facturación ────────────────────────────────────────────────────────
    {
      id: "facturacion-almacenaje",
      title: "Facturación de almacenaje",
      menuPath: "Depósito › Facturación",
      routes: ["/storage-billing"],
      permission: "storage_billing:read",
      intro: [
        "Calcula cuánto facturarle a cada cliente por el almacenaje de sus pallets en un rango de fechas y emite la factura. Al abrir, el rango es del 1 del mes a hoy; se cambia con {{Desde}} y {{Hasta}}.",
        "Arriba se ven los totales del rango: {{Almacenaje:}}, {{Carga + descarga:}} y {{Total:}}.",
        "{{Por cliente}}: {{Cliente}}, {{Pallets}}, {{A facturar}}, {{Facturado hasta}} (el último día ya facturado, en cualquier canal) y el botón {{Facturar}}.",
        "{{Detalle por pallet}}: {{Pallet}}, {{Cliente}}, {{Días}}, {{Tarifa/día}}, {{Carga}}, {{Descarga}} y {{Cargo}}. Un cargo con {{(parcial)}} tiene días sin precio; {{sin tarifa}} o {{sin cotización}} indican que no se pudo valorizar.",
      ],
      screens: [
        {
          kind: "page",
          title: "Facturación de almacenaje",
          subtitle:
            "Días-pallet del rango × tarifa vigente (la específica del cliente gana sobre la general), agrupado por cliente.",
          toolbar: [
            { label: "Desde", kind: "date", value: "01/10/2026" },
            { label: "Hasta", kind: "date", value: "31/10/2026" },
          ],
          stats: [
            { label: "Almacenaje:", value: "$450.000" },
            { label: "Carga + descarga:", value: "$32.000" },
            { label: "Total:", value: "$482.000" },
          ],
          table: {
            columns: [
              "Cliente",
              "Pallets",
              "A facturar",
              "Facturado hasta",
              "",
            ],
            rows: [
              [
                "~Construcciones SA",
                "30",
                "$482.000",
                "30/09/2026",
                "Facturar",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Cómo se calcula",
          body: [
            "Por cada pallet: los días que estuvo guardado dentro del rango (desde el ingreso o el inicio del rango, hasta la salida o el fin del rango, inclusive) por la tarifa diaria de cada día (una mensual se divide por 30), más la carga si el ingreso cae en el rango, más la descarga si la salida cae en el rango. El precio de cada día sale de la tarifa que corresponda ese día (ver [[#tarifas-almacenaje]]).",
            "Si hay pallets con días sin tarifa vigente, aparece el aviso «… pallet(s) con días sin tarifa vigente — cargá una tarifa para que se facturen.». Si el cliente tiene tarifas en USD y no hay cotización del dólar al cierre del rango, el aviso lo dice: cargala en [[/accounting/exchange-rates]].",
          ],
        },
        {
          title: "Continuidad: no facturar dos veces ni dejar huecos",
          body: [
            "Cada factura de almacenaje registra el período que facturó. Al facturar, el {{Desde}} se propone en el día siguiente al último facturado del cliente.",
            "Si el {{Desde}} deja días sin facturar después del último período, el diálogo avisa «Te falta facturar del … al …»; podés seguir si es a propósito.",
            "Un período que se superpone con otro ya facturado al cliente en el mismo canal no se puede emitir: el diálogo avisa «Ese período ya fue facturado (total o parcialmente) para este cliente en este canal.» y el botón queda deshabilitado.",
          ],
        },
        {
          title: "Deshacer una factura de almacenaje",
          body: [
            "El período queda libre para facturarlo de nuevo cuando su factura falla, cuando se anula (una interna) o cuando se le emite una nota de crédito por el total (una fiscal: las fiscales no se anulan). Ver [[#liberar-periodo-almacenaje]].",
          ],
        },
      ],
      tasks: [
        {
          id: "consultar-facturacion-almacenaje",
          title: "Ver cuánto facturar a cada cliente",
          permission: "storage_billing:read",
          steps: [
            "Entrá en [[/storage-billing]].",
            "Ajustá {{Desde}} y {{Hasta}} al período que querés ver.",
            "Revisá {{Por cliente}} (lo que va a facturar cada uno y hasta cuándo ya se le facturó) y {{Detalle por pallet}} (días y cargos de cada pallet).",
          ],
          after: [
            "Es un cálculo en el momento: no guarda nada. Al emitir, el total se vuelve a calcular.",
          ],
          errors: [
            {
              message: "No se pudo cargar la facturación de almacenaje.",
              fix: "Hacé clic en reintentar del aviso.",
            },
            {
              message: "No se pudo leer hasta cuándo se facturó cada cliente.",
              fix: "Reintentá: hasta que cargue, {{Facturar}} queda deshabilitado.",
            },
          ],
          related: ["facturar-almacenaje", "consultar-trazabilidad-pallets"],
          keywords: ["días pallet", "cuánto cobrar", "reporte de almacenaje"],
        },
        {
          id: "facturar-almacenaje",
          title: "Facturar el almacenaje de un cliente",
          summary:
            "Emite la factura del almacenaje, carga y descarga de un cliente por un período.",
          permission: ["storage_billing:issue", "invoices:issue"],
          prerequisites: [
            "Una tarifa vigente para los días a facturar ([[#crear-tarifa-almacenaje]]).",
            "Un cliente de Ventas necesita CUIT y condición de IVA cargados; uno de Otras ventas no.",
            "Un punto de venta habilitado para el canal.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Facturar almacenaje",
              description: "~Construcciones SA — facturado hasta 30/09/2026",
              fields: [
                {
                  label: "Desde",
                  kind: "date",
                  value: "01/10/2026",
                  marker: 2,
                },
                {
                  label: "Hasta",
                  kind: "date",
                  value: "31/10/2026",
                  marker: 2,
                },
                {
                  label: "Canal",
                  kind: "select",
                  value: "Logística Jouve (fiscal)",
                  marker: 3,
                  wide: true,
                },
                {
                  label: "Punto de venta",
                  kind: "select",
                  value: "00003",
                  marker: 3,
                  wide: true,
                },
              ],
              table: {
                columns: ["~Concepto", "~Importe"],
                rows: [
                  ["Almacenaje", "$450.000"],
                  ["Carga", "$16.000"],
                  ["Descarga", "$16.000"],
                  ["Total", "$482.000"],
                ],
              },
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Emitir factura", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/storage-billing]], en la fila del cliente en {{Por cliente}}, hacé clic en {{Facturar}}.",
            "Revisá {{Desde}} (propuesto el día siguiente al último facturado) y {{Hasta}} (el fin del rango de la pantalla). Leé los avisos de hueco o superposición si aparecen.",
            "Elegí el {{Canal}} (solo los del lado del cliente: fiscal para un cliente de Ventas, interno para uno de Otras ventas; si hay uno solo, viene elegido) y el {{Punto de venta}}.",
            "Revisá el resumen: {{Almacenaje}}, {{Carga}}, {{Descarga}} y {{Total}} se recalculan con el período.",
            "Hacé clic en {{Emitir factura}}. Se habilita cuando el período es válido, no se superpone con uno facturado, el total es mayor a 0 y elegiste canal y punto de venta.",
          ],
          after: [
            "Aparece el aviso {{Factura de almacenaje emitida.}}. Se crea una factura con fecha de hoy, concepto servicios con el período facturado, en pesos, con hasta tres líneas con IVA 21%: «Almacenaje dd/mm/aaaa–dd/mm/aaaa», «Carga …» y «Descarga …» (solo las que tienen importe).",
            "En un canal fiscal se pide el CAE a AFIP; en uno interno se numera sin AFIP. La factura aparece entre los comprobantes del cliente, como cualquier otra factura.",
            "El período queda registrado: {{Facturado hasta}} se actualiza y ese período ya no se puede facturar de nuevo en el mismo canal. Se guardan las tarifas que se usaron.",
          ],
          errors: [
            {
              message:
                "Ese período ya fue facturado (total o parcialmente) para este cliente en este canal.",
              fix: "Corregí {{Desde}} y {{Hasta}} para que empiecen después de lo ya facturado.",
            },
            {
              message: "No hay nada para facturar en ese período.",
              fix: "El cliente no tiene días, cargas ni descargas con precio en el período: revisá las fechas o las tarifas.",
            },
            {
              message:
                "Falta la cotización del dólar al … (o anterior) para las tarifas en USD del cliente. Cargala en Contabilidad › Cotización USD y volvé a facturar.",
              fix: "Cargá la cotización en [[/accounting/exchange-rates]] y volvé a facturar.",
            },
            {
              message: "El cliente necesita un CUIT para facturar.",
              fix: "Cargá el CUIT en la ficha del cliente.",
            },
            {
              message: "La condición de IVA del cliente es inválida.",
              fix: "Corregí la condición de IVA en la ficha del cliente.",
            },
            {
              message: "El hasta no puede ser anterior al desde.",
              fix: "Corregí las fechas.",
            },
            {
              message:
                "Punto de venta … no está configurado o no pertenece a ….",
              fix: "Elegí otro punto de venta o pedile a un admin que lo habilite para ese canal.",
            },
            {
              message:
                "La fecha no puede ser anterior a la del último comprobante de este tipo en el punto de venta (…).",
              fix: "Ya hay un comprobante posterior en ese punto de venta: usá otro punto de venta o consultalo con el administrador.",
            },
            {
              message: "El cliente está inactivo.",
              fix: "Reactivá el cliente para facturarle.",
            },
            {
              message:
                "Ese período ya está facturado: se registró la factura que había quedado sin vincular. La encontrás entre los comprobantes del cliente: Ventas › Comprobantes, u Otras ventas › Remitos internos si es interna.",
              fix: "No emitas otra: la factura de un intento anterior ya cubre el período y quedó registrada.",
            },
            {
              message:
                "La factura se emitió pero el período no quedó registrado. No la emitas de nuevo: pasados 15 minutos, «Facturar» el mismo período registra esta factura sin emitir otra.",
              fix: "Esperá 15 minutos y volvé a {{Facturar}} el mismo período: se vincula la factura ya emitida.",
            },
            {
              message:
                "La factura falló o se anuló antes de registrar el período: el período quedó libre para facturarlo de nuevo.",
              fix: "Revisá el motivo en el comprobante y volvé a facturar.",
            },
            {
              message: "No tenés permiso para facturar almacenaje.",
              fix: "Hace falta `storage_billing:issue` y `invoices:issue`: pedíselo a alguien con rol Finanzas, admin u owner.",
            },
            {
              message: "No se pudo calcular el almacenaje.",
              fix: "Volvé a intentar.",
            },
          ],
          related: [
            "consultar-facturacion-almacenaje",
            "liberar-periodo-almacenaje",
          ],
          keywords: [
            "facturar depósito",
            "factura mensual",
            "almacenaje del mes",
            "cobrar pallets",
          ],
        },
        {
          id: "liberar-periodo-almacenaje",
          title: "Deshacer una factura de almacenaje",
          summary:
            "Para refacturar un período mal facturado: se libera anulando la factura interna o con una nota de crédito por el total de la fiscal.",
          permission: {
            anyOf: ["invoices:cancel", "credit_debit_notes:issue"],
          },
          steps: [
            "Buscá la factura de almacenaje del cliente en [[/invoices]] (las internas, en remitos internos).",
            "Si es interna, anulala con {{Anular}}. Si es fiscal, emití una nota de crédito por el total de la factura.",
            "Volvé a [[/storage-billing]]: el período ya no cuenta como facturado y {{Facturar}} lo propone de nuevo.",
          ],
          after: [
            "La factura anulada o acreditada por el total deja de cubrir el período. Una nota de crédito por menos del total no libera el período.",
          ],
          related: ["facturar-almacenaje"],
          keywords: [
            "anular factura de almacenaje",
            "nota de crédito almacenaje",
            "refacturar",
            "corregir facturación",
          ],
        },
      ],
    },
  ],
};
