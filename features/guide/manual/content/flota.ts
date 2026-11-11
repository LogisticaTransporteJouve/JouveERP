import type { GuidePage } from "../types";

import { attachmentPermission } from "./attachment-permissions";

// Fleet chapter: drivers, vehicles, trips and their cargas, freight
// tariffs, fuel, monthly km, maintenance and expiring documents.

export const fleetPage: GuidePage = {
  file: "flota.html",
  title: "Flota",
  lead: "Choferes, vehículos, viajes y cargas, las tarifas de flete, y los costos de la flota: combustible, km, mantenimiento y vencimientos.",
  sections: [
    // ── Choferes ─────────────────────────────────────────────────────────
    {
      id: "flota-choferes",
      title: "Choferes",
      menuPath: "Flota › Choferes",
      routes: ["/drivers"],
      permission: "drivers:read",
      intro: [
        "La lista de choferes de la flota: los propios (empleados) y los contratados. Muestra {{Nombre}}, {{Tipo}} ({{Empleado}} o {{Contratado}}), {{CUIT}}, {{Licencia}} con su categoría, {{Teléfono}} y el interruptor {{Activo}}. Los activos aparecen primero.",
        "Los viajes y la documentación vencible se asignan a un chofer de esta lista. La documentación (licencia, ART, libreta sanitaria) no se carga acá sino en [[/fleet-documents]].",
        "Un clic en el nombre del chofer (acá, en [[/trips]] o en la página de un vehículo) abre su página: sus viajes día por día con el vehículo y sus km (ver [[#flota-km-mensual]]).",
      ],
      screens: [
        {
          kind: "page",
          title: "Choferes",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo chofer contratado", variant: "primary" },
          ],
          table: {
            columns: [
              "Nombre",
              "Tipo",
              "CUIT",
              "Licencia",
              "Teléfono",
              "Activo",
            ],
            rows: [
              [
                "~Juan Pérez",
                "~Empleado",
                "~20-12345678-9",
                "~12345678 (E1)",
                "~11 5555-0000",
                "~Sí",
              ],
              [
                "~Transportes Gómez",
                "~Contratado",
                "~30-70000000-1",
                "~—",
                "~—",
                "~Sí",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Choferes propios y contratados",
          body: [
            "Un chofer **propio** es un empleado: se da de alta en [[/employees]] con la posición `Chofer / Acompañante`, y el sistema le crea solo su ficha de chofer. Su nombre y CUIT se editan en el legajo; acá se ven en gris y no se pueden cambiar. Si el empleado deja esa posición, su ficha de chofer queda inactiva.",
            "Un chofer **contratado** no tiene legajo: se carga con {{Nuevo chofer contratado}}. En la columna {{Tipo}}, {{Empleado}} es un enlace al legajo del empleado.",
            "Un chofer inactivo no aparece para elegir en viajes nuevos ni en documentos nuevos, pero conserva su historia.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-chofer-contratado",
          title: "Dar de alta un chofer contratado",
          summary:
            "Para un chofer que no es empleado. Los propios se dan de alta desde Personal › Empleados.",
          permission: "drivers:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo chofer contratado",
              description:
                "Chofer sin legajo. Los propios se dan de alta en Personal → Empleados. La documentación vencible (licencia, ART) se carga aparte.",
              fields: [
                {
                  label: "Nombre completo",
                  value: "Juan Pérez",
                  wide: true,
                  marker: 2,
                },
                { label: "CUIT", value: "20-12345678-9" },
                { label: "Teléfono" },
                { label: "N° licencia" },
                { label: "Categoría", value: "E1" },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/drivers]], hacé clic en {{Nuevo chofer contratado}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Nombre completo}}: obligatorio, hasta 120 caracteres.",
                "{{CUIT}}, {{Teléfono}}, {{N° licencia}} y {{Categoría}} (por ejemplo `E1`): opcionales.",
                "{{Notas}}: texto libre.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "El chofer aparece en la lista como {{Contratado}} y activo, y ya se puede elegir en viajes y en documentos de flota.",
            "Para que el chofer use el sistema y vea sus viajes, un administrador le vincula un usuario ([[#vincular-usuario-chofer]]).",
          ],
          errors: [
            {
              message: "Nombre requerido.",
              fix: "Escribí el nombre del chofer.",
            },
            {
              message: "No tenés permiso para crear choferes.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
            {
              message: "No se pudo crear el chofer.",
              fix: "Volvé a intentar; si sigue fallando, avisale al administrador.",
            },
          ],
          related: ["editar-chofer", "crear-documento-flota"],
          keywords: ["alta chofer", "nuevo chofer", "fletero", "tercerizado"],
        },
        {
          id: "editar-chofer",
          title: "Editar un chofer",
          permission: "drivers:write",
          steps: [
            "En [[/drivers]], en la fila del chofer, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos. En un chofer propio, {{Nombre completo}} y {{CUIT}} no se pueden editar: se cambian en su legajo de [[/employees]].",
            "Hacé clic en {{Guardar}} (se habilita cuando cambiaste algo).",
          ],
          after: ["Los cambios se ven en los viajes y cargas del chofer."],
          errors: [
            {
              message: "No tenés permiso para editar choferes.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
            {
              message: "No se pudo actualizar el chofer.",
              fix: "Volvé a intentar.",
            },
            {
              message:
                "El chofer cambió mientras lo editabas. Actualizá la página.",
              fix: "Otra persona lo vinculó o desvinculó de un empleado: recargá y volvé a editarlo.",
            },
          ],
          related: ["crear-chofer-contratado", "activar-desactivar-chofer"],
          keywords: ["modificar chofer", "licencia", "teléfono chofer"],
        },
        {
          id: "activar-desactivar-chofer",
          title: "Desactivar o reactivar un chofer",
          summary:
            "Desactivar es la forma de dar de baja un chofer que ya tiene viajes o documentos.",
          permission: "drivers:write",
          steps: [
            "En [[/drivers]], en la fila del chofer, usá el interruptor {{Activo}}. Solo en los contratados: el de un chofer propio queda deshabilitado, porque sigue a su legajo (se desactiva solo cuando el empleado deja la posición o se da de baja).",
          ],
          after: [
            "Un chofer inactivo deja de ofrecerse en viajes y documentos nuevos y sus documentos ya no generan tareas de vencimiento; su historia queda intacta.",
          ],
          errors: [
            {
              message: "No se pudo cambiar el estado.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["borrar-chofer"],
          keywords: ["baja chofer", "inactivo", "desactivar"],
        },
        {
          id: "vincular-usuario-chofer",
          title: "Vincular un usuario a un chofer",
          summary:
            "Le da al chofer un acceso al sistema que solo ve los viajes asignados a él.",
          permission: "users:assign_role",
          prerequisites: [
            "El usuario tiene que existir en [[/admin/users]].",
            "Solo lo ve quien puede asignar roles (Owner o Admin): sin ese permiso el ítem no aparece en el menú.",
          ],
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar" },
                { label: "Vincular usuario", marker: 1 },
                { label: "Borrar", destructive: true },
              ],
            },
            {
              kind: "dialog",
              title: "~Vincular usuario a Juan Pérez",
              description:
                "El usuario vinculado verá solo los viajes asignados a este chofer. Un login mapea a un solo chofer.",
              fields: [
                {
                  label: "~Usuario",
                  kind: "select",
                  value: "chofer@ejemplo.com",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/drivers]], en la fila del chofer, abrí el menú ⋯ y elegí {{Vincular usuario}} (o {{Cambiar usuario}} si ya tiene uno).",
            "Elegí el email del usuario. Para quitar el vínculo, elegí {{Ninguno (desvincular)}}.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "El usuario vinculado ve solo los viajes de este chofer. Un usuario se vincula a un solo chofer.",
          ],
          errors: [
            {
              message: "Ese usuario ya está vinculado a otro chofer.",
              fix: "Desvinculalo primero del otro chofer o elegí otro usuario.",
            },
            {
              message: "No tenés permiso para vincular usuarios.",
              fix: "Pedíselo a un Owner o Admin.",
            },
          ],
          related: ["crear-chofer-contratado"],
          keywords: ["acceso chofer", "login chofer", "usuario chofer"],
        },
        {
          id: "borrar-chofer",
          title: "Borrar un chofer",
          permission: "drivers:write",
          steps: [
            "En [[/drivers]], en la fila del chofer, abrí el menú ⋯ y elegí {{Borrar}} (solo en los contratados: un chofer propio se da de baja desde su legajo).",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "Se borra el chofer. Solo se puede borrar uno sin viajes, rendiciones ni documentos: si tiene alguno, el borrado falla y hay que desactivarlo.",
          ],
          errors: [
            {
              message:
                "El chofer tiene viajes, documentos o rendiciones. Desactivalo en lugar de borrarlo.",
              fix: "Usá el interruptor {{Activo}} ([[#activar-desactivar-chofer]]).",
            },
            {
              message: "No tenés permiso para borrar choferes.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["activar-desactivar-chofer"],
          keywords: ["eliminar chofer"],
        },
        {
          id: "exportar-listados-flota",
          title: "Exportar un listado de flota a PDF o Excel",
          summary:
            "Choferes, vehículos, combustible, mantenimientos y documentación tienen el botón Exportar.",
          permission: {
            anyOf: [
              "drivers:read",
              "vehicles:read",
              "fuel:read",
              "maintenance:read",
              "fleet_documents:read",
            ],
          },
          prerequisites: [
            "Cada listado se exporta con el permiso de lectura de su pantalla.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Exportar",
              description:
                "Elegí el formato y el rango de fechas. También podés exportar todo el historial.",
              fields: [
                { label: "PDF", kind: "checkbox", value: "sí", marker: 2 },
                { label: "Excel", kind: "checkbox" },
                {
                  label: "Desde",
                  kind: "date",
                  value: "01/10/2026",
                  marker: 3,
                },
                { label: "Hasta", kind: "date", value: "31/10/2026" },
              ],
              footer: [
                { label: "Todo el historial", variant: "outline", marker: 4 },
                { label: "Descargar período", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la pantalla del listado ([[/drivers]], [[/vehicles]], [[/fuel]], [[/maintenance]] o [[/fleet-documents]]), hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}}.",
            "Elegí el rango en {{Desde}} y {{Hasta}} (por defecto, del 1° del mes a hoy). En combustible y mantenimientos filtra por la fecha de la carga o del trabajo; en choferes, vehículos y documentación, por la fecha de alta del registro, así que para la lista completa conviene {{Todo el historial}}.",
            "Hacé clic en {{Descargar período}}, o en {{Todo el historial}} para exportar sin filtro de fechas.",
          ],
          after: ["El PDF se abre en otra pestaña; el Excel se descarga."],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Volvé a intentar con un rango más chico.",
            },
          ],
          keywords: [
            "exportar",
            "excel",
            "pdf",
            "descargar listado",
            "imprimir",
          ],
        },
      ],
    },

    // ── Vehículos ────────────────────────────────────────────────────────
    {
      id: "flota-vehiculos",
      title: "Vehículos",
      menuPath: "Flota › Vehículos",
      routes: ["/vehicles"],
      permission: "vehicles:read",
      intro: [
        "Los camiones, acoplados, semis y demás vehículos de la flota, con {{Patente}}, {{Alias}}, {{Tipo}}, {{Marca/Modelo}}, {{Año}} y el interruptor {{Activo}}.",
        "Cada vehículo se usa en viajes, cargas de combustible, km recorridos, mantenimientos y documentación (VTV, seguro). Su {{Tarjeta de combustible}} sirve para reconocerlo al importar el resumen de YPF en Ruta o Axion Card.",
        "Un clic en la patente abre la página del vehículo: sus datos y los km de cada día según Strix, con el chofer que lo manejó (ver [[#flota-km-mensual]]). Los km se traen para toda la flota desde [[/vehicle-km]], no desde cada vehículo.",
      ],
      screens: [
        {
          kind: "page",
          title: "Vehículos",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo vehículo", variant: "primary" },
          ],
          table: {
            columns: [
              "Patente",
              "Alias",
              "Tipo",
              "Marca/Modelo",
              "Año",
              "Activo",
            ],
            rows: [
              [
                "~AB123CD",
                "~Chasis 1",
                "~Camión",
                "~Scania R450",
                "~2020",
                "~Sí",
              ],
              ["~AC456EF", "~—", "~Semi", "~—", "~2018", "~Sí"],
            ],
            rowMenu: true,
          },
        },
      ],
      tasks: [
        {
          id: "crear-vehiculo",
          title: "Dar de alta un vehículo",
          permission: "vehicles:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo vehículo",
              description:
                "Vehículo de la flota. La documentación vencible (VTV, seguro) se carga aparte.",
              fields: [
                { label: "Patente", value: "AB123CD", marker: 2 },
                { label: "Tipo", kind: "select", value: "Camión", marker: 2 },
                { label: "Alias", value: "Chasis 1", wide: true },
                { label: "Marca", value: "Scania" },
                { label: "Modelo", value: "R450" },
                { label: "Año", value: "2020" },
                { label: "Capacidad (kg)", value: "30000" },
                { label: "Flota", value: "Logística Jouve", wide: true },
                { label: "Tarjeta de combustible", wide: true },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/vehicles]], hacé clic en {{Nuevo vehículo}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Patente}}: obligatoria y única en la flota.",
                "{{Tipo}}: {{Camión}}, {{Acoplado}}, {{Semi}}, {{Utilitario}}, {{Furgón}}, {{Auto}} u {{Otro}}. Los acoplados y semis no llevan km.",
                "{{Alias}}, {{Marca}}, {{Modelo}}, {{Año}} (entre 1950 y 2100), {{Capacidad (kg)}} y {{Flota}}: opcionales.",
                "{{Tarjeta de combustible}}: el número de la tarjeta YPF en Ruta o Axion Card, de 4 a 30 dígitos o letras (se guarda sin espacios ni guiones). No puede repetirse entre vehículos.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "El vehículo queda activo y se puede elegir en viajes, combustible, mantenimiento y documentos. Si es un camión, utilitario, furgón, auto u otro, entra en la lista de [[/vehicle-km]].",
          ],
          errors: [
            { message: "Patente requerida.", fix: "Escribí la patente." },
            {
              message: "Ya existe un vehículo con esa patente.",
              fix: "Buscalo en la lista: puede estar inactivo.",
            },
            {
              message: "Esa tarjeta de combustible ya es de otro vehículo.",
              fix: "Revisá el número o sacáselo primero al otro vehículo.",
            },
            {
              message: "Tarjeta inválida (4 a 30 dígitos o letras).",
              fix: "Escribí solo el número de la tarjeta.",
            },
            {
              message: "No tenés permiso para crear vehículos.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-documento-flota", "importar-resumen-combustible"],
          keywords: [
            "alta camión",
            "nuevo camión",
            "patente",
            "acoplado",
            "semi",
          ],
        },
        {
          id: "editar-vehiculo",
          title: "Editar un vehículo",
          permission: "vehicles:write",
          steps: [
            "En [[/vehicles]], en la fila del vehículo, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos (mismas reglas que al crearlo).",
            "Hacé clic en {{Guardar}} (se habilita cuando cambiaste algo).",
          ],
          errors: [
            {
              message: "Ya existe un vehículo con esa patente.",
              fix: "Revisá la patente.",
            },
            {
              message: "Esa tarjeta de combustible ya es de otro vehículo.",
              fix: "Revisá el número de tarjeta.",
            },
            {
              message: "No tenés permiso para editar vehículos.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-vehiculo"],
          keywords: ["modificar vehículo", "tarjeta combustible"],
        },
        {
          id: "desactivar-vehiculo",
          title: "Desactivar o reactivar un vehículo",
          permission: "vehicles:write",
          steps: [
            "En [[/vehicles]], en la fila del vehículo, usá el interruptor {{Activo}}.",
          ],
          after: [
            "Un vehículo inactivo deja de ofrecerse en viajes, combustible, mantenimiento y documentos nuevos, no se le piden km y sus documentos no generan tareas de vencimiento.",
          ],
          errors: [
            {
              message: "No se pudo cambiar el estado.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["borrar-vehiculo"],
          keywords: ["baja vehículo", "vendido", "fuera de servicio"],
        },
        {
          id: "borrar-vehiculo",
          title: "Borrar un vehículo",
          permission: "vehicles:write",
          steps: [
            "En [[/vehicles]], en la fila del vehículo, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          errors: [
            {
              message:
                "El vehículo tiene cargas de combustible, mantenimientos, documentos o viajes. Desactivalo en lugar de borrarlo.",
              fix: "Desactivalo ([[#desactivar-vehiculo]]).",
            },
            {
              message: "No se encontró el vehículo o no podés borrarlo.",
              fix: "Actualizá la pantalla: puede que otro usuario ya lo haya borrado.",
            },
          ],
          related: ["desactivar-vehiculo"],
          keywords: ["eliminar vehículo"],
        },
      ],
    },

    // ── Viajes ───────────────────────────────────────────────────────────
    {
      id: "flota-viajes",
      title: "Viajes",
      menuPath: "Flota › Viajes",
      routes: ["/trips", "/trips/[id]"],
      permission: "trips:read",
      intro: [
        "Cada viaje de la flota con {{Fecha}}, {{Chofer}}, {{Vehículo}} y {{Estado}}. Un viaje junta las cargas que lleva: desde el menú ⋯ de la fila, {{Ver cargas}} abre la página del viaje.",
        "La página del viaje (`Viaje del <fecha>`) muestra el chofer y la patente, y la tabla {{Cargas del viaje}} con {{Cliente}}, {{Dirección}} y {{Estado}} de cada carga. Quien puede ver la auditoría ve además el {{Historial}} del viaje: quién lo creó o editó y cuándo ({{Ver detalle}} abre cada cambio).",
        "Un usuario con el rol Chofer vinculado a un chofer ve solo los viajes de ese chofer.",
      ],
      screens: [
        {
          kind: "page",
          title: "Viajes",
          actions: [{ label: "Nuevo viaje", variant: "primary" }],
          table: {
            columns: ["Fecha", "Chofer", "Vehículo", "Estado"],
            rows: [["~2026-11-03", "~Juan Pérez", "~AB123CD", "~Completado"]],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Estados del viaje",
          body: [
            "{{Planificado}} (el estado inicial), {{En curso}}, {{Completado}} y {{Cancelado}}. El estado se cambia editando el viaje; es informativo y no cambia el estado de sus cargas.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-viaje",
          title: "Crear un viaje",
          permission: "trips:write",
          prerequisites: [
            "El chofer y el vehículo tienen que estar activos ([[#crear-chofer-contratado]], [[#crear-vehiculo]]); también se puede crear sin ellos y asignarlos después.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo viaje",
              description:
                "Viaje de la flota: fecha, estado, chofer y vehículo.",
              fields: [
                {
                  label: "Fecha",
                  kind: "date",
                  value: "03/11/2026",
                  marker: 2,
                },
                { label: "Estado", kind: "select", value: "Planificado" },
                { label: "Chofer", kind: "select", value: "Juan Pérez" },
                { label: "Vehículo", kind: "select", value: "AB123CD" },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/trips]], hacé clic en {{Nuevo viaje}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Fecha}}: obligatoria.",
                "{{Estado}}: arranca en {{Planificado}}.",
                "{{Chofer}} y {{Vehículo}}: solo se ofrecen los activos; {{Ninguno}} lo deja sin asignar.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "El viaje aparece en la lista. Para sumarle cargas, abrí {{Ver cargas}} y seguí [[#asignar-cargas-viaje]].",
          ],
          errors: [
            { message: "Fecha requerida.", fix: "Elegí la fecha del viaje." },
            {
              message: "No tenés permiso para crear viajes.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["asignar-cargas-viaje", "editar-viaje"],
          keywords: ["nuevo viaje", "programar viaje", "hoja de ruta"],
        },
        {
          id: "editar-viaje",
          title: "Editar un viaje o cambiar su estado",
          permission: "trips:write",
          steps: [
            "En [[/trips]], en la fila del viaje, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos; para cambiar el estado usá {{Estado}}.",
            "Hacé clic en {{Guardar}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar viajes.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-viaje"],
          keywords: ["cambiar chofer", "viaje completado", "cancelar viaje"],
        },
        {
          id: "asignar-cargas-viaje",
          title: "Asignar cargas a un viaje",
          summary:
            "Las cargas se crean sin viaje en Cargas y se suben al viaje desde la página del viaje.",
          permission: ["trips:read", "shipments:write"],
          prerequisites: [
            "Que existan cargas sin viaje, en estado {{No iniciada}} o {{Reprogramada}} ([[#crear-carga]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Asignar cargas",
              description:
                "Cargas sin viaje, pendientes o reprogramadas. Elegí las que van en este viaje.",
              fields: [
                {
                  label:
                    "~Ferretería Norte S.A. · Av. Pellegrini 1500, Rosario · 2026-11-03",
                  kind: "checkbox",
                  value: "sí",
                  wide: true,
                  marker: 3,
                },
                {
                  label: "~Agro Sur SRL · Bv. Lehmann 300, Rafaela",
                  kind: "checkbox",
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Asignar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/trips]], en la fila del viaje, abrí el menú ⋯ y elegí {{Ver cargas}}.",
            "En la página del viaje, hacé clic en {{Asignar cargas}}.",
            "Marcá las cargas que van en el viaje.",
            "Hacé clic en {{Asignar}} (con varias marcadas dice «Asignar N cargas»).",
          ],
          after: [
            "Las cargas pasan a {{Cargas del viaje}} y en [[/cargas]] la columna {{Viaje}} muestra la fecha del viaje.",
            "Si otro usuario asignó alguna al mismo tiempo a otro viaje, el aviso dice cuántas se asignaron: las demás ya estaban en otro viaje.",
          ],
          errors: [
            {
              message: "No tenés permiso para asignar cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
            {
              message: "No se pudieron actualizar las cargas.",
              fix: "Volvé a intentar.",
            },
          ],
          related: ["quitar-carga-viaje", "crear-carga"],
          keywords: ["cargas del viaje", "armar viaje", "subir cargas"],
        },
        {
          id: "quitar-carga-viaje",
          title: "Quitar una carga de un viaje",
          permission: ["trips:read", "shipments:write"],
          steps: [
            "En la página del viaje, en la fila de la carga, hacé clic en la X ({{Quitar del viaje}}).",
          ],
          after: [
            "La carga vuelve a quedar sin viaje y se puede asignar a otro.",
          ],
          related: ["asignar-cargas-viaje"],
          keywords: ["sacar carga", "desasignar"],
        },
        {
          id: "borrar-viaje",
          title: "Borrar un viaje",
          permission: "trips:write",
          steps: [
            "En [[/trips]], en la fila del viaje, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "El viaje se borra y sus cargas quedan sin viaje, listas para asignarse a otro.",
          ],
          errors: [
            {
              message: "No se encontró el viaje o no podés borrarlo.",
              fix: "Actualizá la pantalla.",
            },
          ],
          keywords: ["eliminar viaje"],
        },
      ],
    },

    // ── Cargas ───────────────────────────────────────────────────────────
    {
      id: "flota-cargas",
      title: "Cargas",
      menuPath: "Flota › Cargas",
      routes: ["/cargas"],
      permission: "shipments:read",
      intro: [
        "Las cargas a transportar: {{Cliente}} (con la descripción debajo), {{Fecha programada}}, {{Viaje}} ({{Sin asignar}} si todavía no tiene) y {{Estado}}. Debajo del estado se marca {{Facturada}} cuando la carga ya tiene una factura vigente.",
        "La búsqueda ({{Buscar por cliente, descripción o dirección…}}) filtra por cliente, descripción o dirección. Al abrir una carga desde un remito escaneado, la búsqueda llega cargada con su número de remito.",
        "Sin el permiso de escritura de cargas, la pantalla es de solo lectura: el menú ⋯ muestra solo {{Historial}}.",
      ],
      screens: [
        {
          kind: "page",
          title: "Cargas",
          actions: [{ label: "Nueva carga", variant: "primary" }],
          toolbar: [
            {
              label: "~Buscar por cliente, descripción o dirección…",
              kind: "input",
            },
          ],
          table: {
            columns: ["Cliente", "Fecha programada", "Viaje", "Estado"],
            rows: [
              [
                "~Ferretería Norte S.A. · Materiales de obra",
                "~03/11/2026",
                "~2026-11-03",
                "~Entregada",
              ],
              [
                "~Agro Sur SRL · Semillas",
                "~05/11/2026",
                "~Sin asignar",
                "~No iniciada",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Estados de la carga",
          body: [
            "{{No iniciada}} (al crearla) → {{Entregada}} ({{Entregar}}). Desde {{No iniciada}} también se puede {{Cancelar}} o {{Reprogramar}}; una carga {{Cancelada}} o {{Reprogramada}} solo se puede volver a reprogramar. Una carga que ya estaba {{En progreso}} se puede entregar, cancelar o reprogramar.",
            "Para una carga {{Entregada}} el menú ya no ofrece cambios de estado.",
            "Cada cambio de estado queda en el {{Historial}} con su comentario, fecha y hora.",
          ],
        },
        {
          title: "Qué bloquea una carga",
          body: [
            "**Facturada:** mientras su factura esté vigente no se puede borrar ni cambiar su cliente. Para liberarla: anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-carga",
          title: "Crear una carga",
          permission: "shipments:write",
          prerequisites: ["El cliente tiene que existir en [[/clients]]."],
          screens: [
            {
              kind: "dialog",
              title: "Nueva carga",
              description:
                "Carga a transportar: cliente, descripción, fecha y dirección. El viaje se asigna después, desde el viaje.",
              fields: [
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Ferretería Norte S.A.",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Descripción",
                  kind: "textarea",
                  value: "Materiales de obra",
                  wide: true,
                },
                {
                  label: "Fecha programada",
                  kind: "date",
                  value: "05/11/2026",
                  wide: true,
                },
                {
                  label: "Dirección",
                  value: "Av. Corrientes 1234, CABA",
                  wide: true,
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/cargas]], hacé clic en {{Nueva carga}}.",
            "En {{Cliente}}, buscá por razón social, nombre fantasía o CUIT y elegilo.",
            "Completá {{Descripción}}, {{Fecha programada}} y {{Dirección}} (adónde va la carga).",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "La carga queda {{No iniciada}} y {{Sin asignar}}. Asignala a un viaje desde la página del viaje ([[#asignar-cargas-viaje]]).",
          ],
          errors: [
            {
              message: "No tenés permiso para crear cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["asignar-cargas-viaje"],
          keywords: ["nueva carga", "dirección", "envío"],
        },
        {
          id: "editar-carga",
          title: "Editar una carga",
          permission: "shipments:write",
          steps: [
            "En [[/cargas]], en la fila de la carga, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá {{Cliente}}, {{Descripción}}, {{Fecha programada}} o {{Dirección}}. El viaje se cambia desde la página del viaje ([[#asignar-cargas-viaje]], [[#quitar-carga-viaje]]).",
            "Hacé clic en {{Guardar}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-carga"],
          keywords: ["modificar carga", "cambiar dirección"],
        },
        {
          id: "cambiar-estado-carga",
          title: "Entregar, cancelar o reprogramar una carga",
          permission: "shipments:write",
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar" },
                { label: "Entregar", marker: 1 },
                { label: "Cancelar", destructive: true, marker: 1 },
                { label: "Reprogramar", marker: 1 },
                { label: "Historial" },
                { label: "Borrar", destructive: true },
              ],
            },
            {
              kind: "dialog",
              title: "Entregar carga",
              description: "Registrá la fecha de entrega.",
              fields: [
                {
                  label: "Fecha de entrega",
                  kind: "date",
                  value: "05/11/2026",
                  wide: true,
                  marker: 2,
                },
                { label: "Comentario", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Confirmar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/cargas]], en la fila de la carga, abrí el menú ⋯ y elegí la acción: {{Entregar}}, {{Cancelar}} o {{Reprogramar}}. El menú muestra solo las que permite el estado actual.",
            {
              text: "Completá el diálogo:",
              substeps: [
                "{{Entregar carga}}: {{Fecha de entrega}} (hoy por defecto).",
                "{{Cancelar carga}}: {{Motivo}} obligatorio.",
                "{{Reprogramar carga}}: {{Nueva fecha programada}} y un {{Motivo}} opcional.",
                "En todos, el {{Comentario}} es opcional y queda en el historial.",
              ],
            },
            "Hacé clic en {{Confirmar}}.",
          ],
          after: [
            "La carga cambia de estado y el cambio queda en su {{Historial}}.",
          ],
          errors: [
            {
              message: "El motivo es obligatorio.",
              fix: "Escribí por qué se cancela.",
            },
            {
              message: "No tenés permiso para cambiar el estado.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["ver-historial-carga"],
          keywords: [
            "entregada",
            "cancelar carga",
            "reprogramar",
            "fecha de entrega",
          ],
        },
        {
          id: "ver-historial-carga",
          title: "Ver el historial de estados de una carga",
          permission: "shipments:read",
          steps: [
            "En [[/cargas]], en la fila de la carga, abrí el menú ⋯ y elegí {{Historial}}.",
          ],
          after: [
            "El diálogo {{Historial de estados}} lista cada cambio (estado anterior → nuevo), su comentario y la fecha y hora.",
          ],
          keywords: ["seguimiento", "trazabilidad carga"],
        },
        {
          id: "borrar-carga",
          title: "Borrar una carga",
          permission: "shipments:write",
          steps: [
            "En [[/cargas]], en la fila de la carga, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          errors: [
            {
              message:
                "La carga ya está facturada: para borrarla, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.",
              fix: "Anulá la factura o emití la nota de crédito en [[/invoices]].",
            },
            {
              message: "No se encontró la carga o no podés borrarla.",
              fix: "Actualizá la pantalla.",
            },
          ],
          keywords: ["eliminar carga"],
        },
      ],
    },

    // ── Tarifas ──────────────────────────────────────────────────────────
    {
      id: "flota-tarifas",
      title: "Tarifas de flete",
      menuPath: "Flota › Tarifas",
      routes: ["/fleet-tariffs"],
      permission: "freight_tariffs:read",
      intro: [
        "Los precios de flete tal como se cotizan (general, consumidor final, muebles y los clientes con tarifa propia), por período, para seguir cada aumento. Son de referencia: ninguna carga toma estos precios.",
        "Cada tarifario tiene sus períodos («Noviembre/Diciembre 26»). Al elegir uno se ven sus líneas por sección, con el precio del período anterior y la variación. El {{Historial}} lista los períodos con el aumento de cada uno.",
        "Cargar precios y aplicar aumentos lo hacen el dueño, admin y finanzas; operaciones los consulta.",
      ],
      screens: [
        {
          kind: "page",
          title: "Tarifas de flete",
          actions: [
            { label: "Aplicar aumento", variant: "outline" },
            { label: "Nuevo tarifario", variant: "primary" },
          ],
          table: {
            columns: ["Concepto", "Precio", "Anterior", "Variación", "Nota"],
            rows: [
              ["~1", "~$35.330", "~$32.118", "~+10%", ""],
              ["~Bultos", "—", "—", "—", "~Tarifa + $ 62.600"],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "crear-tarifario-flete",
          title: "Crear un tarifario y cargar sus precios",
          permission: "freight_tariffs:write",
          steps: [
            "En [[/fleet-tariffs]], hacé clic en {{Nuevo tarifario}}.",
            "Escribí el {{Nombre}} (por ejemplo «General», «Muebles» o el del cliente con tarifa propia), el {{Período}} y {{Vigente desde}}, y si querés {{Notas}}. Hacé clic en {{Crear}}.",
            "Con el tarifario y el período elegidos, hacé clic en {{Editar precios}}.",
            "Cargá cada línea con su {{Sección}}, {{Concepto}} y un precio en pesos o un porcentaje (por ejemplo «% x remito»); la {{Nota}} es libre. {{Agregar línea}} suma una fila y el tacho ({{Quitar línea}}) la saca. Hacé clic en {{Guardar}}.",
          ],
          after: [
            "Aviso «Precios guardados.». El lápiz ({{Editar tarifario}}) cambia el nombre y las notas; {{Borrar período}} y {{Borrar tarifario}} piden confirmación.",
          ],
          related: ["aplicar-aumento-flete"],
          keywords: ["tarifa de flete", "lista de precios flete"],
        },
        {
          id: "aplicar-aumento-flete",
          title: "Aplicar un aumento a los tarifarios",
          permission: "freight_tariffs:write",
          steps: [
            "En {{Tarifas de flete}}, hacé clic en {{Aplicar aumento}}.",
            "Poné el {{Aumento %}}, el {{Período nuevo}} y desde cuándo vale, y elegí el {{Redondeo}} (a $1, $10 o $100).",
            "Marcá los tarifarios que aumentan (vienen todos marcados) y hacé clic en {{Aplicar}}.",
          ],
          after: [
            "Cada tarifario elegido tiene un período nuevo con sus precios aumentados; los porcentajes y las notas no cambian, y el período anterior queda para comparar.",
          ],
          keywords: ["aumento de tarifas", "actualizar precios de flete"],
        },
      ],
    },

    // ── Combustible ──────────────────────────────────────────────────────
    {
      id: "flota-combustible",
      title: "Combustible",
      menuPath: "Flota › Combustible",
      routes: ["/fuel"],
      permission: "fuel:read",
      intro: [
        "Las cargas de combustible por vehículo, con {{Fecha}}, {{Vehículo}}, {{Litros}}, {{Importe}} y {{Estación}}. Se cargan una por una o se importan del resumen de la tarjeta (YPF en Ruta, Axion Card u otra planilla).",
        "Cada carga cuenta como costo de combustible de su vehículo (y del viaje, si se le asigna). Si no tiene factura de compra ni movimiento de pago vinculado, no llega a la contabilidad.",
      ],
      screens: [
        {
          kind: "page",
          title: "Cargas de combustible",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Importar resumen", variant: "outline" },
            { label: "Nueva carga", variant: "primary" },
          ],
          table: {
            columns: ["Fecha", "Vehículo", "Litros", "Importe", "Estación"],
            rows: [
              ["~2026-11-02", "~AB123CD", "~320", "~$352.000", "~YPF Ruta 9"],
            ],
            rowMenu: true,
          },
        },
      ],
      tasks: [
        {
          id: "crear-carga-combustible",
          title: "Registrar una carga de combustible",
          permission: "fuel:write",
          screens: [
            {
              kind: "dialog",
              title: "Nueva carga",
              description:
                "Carga de combustible de la flota: vehículo, litros e importe.",
              fields: [
                {
                  label: "Vehículo",
                  kind: "select",
                  value: "AB123CD",
                  marker: 2,
                },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "02/11/2026",
                  marker: 2,
                },
                {
                  label: "Viaje (opcional)",
                  kind: "select",
                  value: "Ninguno",
                  wide: true,
                },
                { label: "Litros", kind: "money", value: "320,00", marker: 2 },
                {
                  label: "Importe",
                  kind: "money",
                  value: "352.000,00",
                  marker: 2,
                },
                { label: "Odómetro (km)", kind: "money" },
                { label: "Estación", value: "YPF" },
                { label: "Tarjeta", wide: true },
                { label: "Notas", kind: "textarea", wide: true },
                {
                  label: "Factura de compra (opcional)",
                  kind: "picker",
                  wide: true,
                  marker: 3,
                },
                {
                  label: "Movimiento de pago (opcional)",
                  kind: "picker",
                  wide: true,
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/fuel]], hacé clic en {{Nueva carga}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Vehículo}}, {{Fecha}}, {{Litros}} (mayor a 0) e {{Importe}}: obligatorios.",
                "{{Viaje (opcional)}}: asigna el costo también a ese viaje.",
                "{{Odómetro (km)}} (con un decimal), {{Estación}}, {{Tarjeta}} y {{Notas}}: opcionales.",
              ],
            },
            "Opcional: vinculá el comprobante. {{Factura de compra (opcional)}} se ve con permiso para leer compras y {{Movimiento de pago (opcional)}} con permiso para leer movimientos.",
            "Hacé clic en {{Crear}}.",
          ],
          after: ["La carga suma al costo de combustible del vehículo."],
          errors: [
            { message: "Vehículo requerido.", fix: "Elegí el vehículo." },
            { message: "Fecha requerida.", fix: "Elegí la fecha." },
            { message: "Importe requerido.", fix: "Escribí el importe." },
            {
              message: "Litros debe ser mayor a 0.",
              fix: "Escribí los litros cargados.",
            },
            {
              message: "No tenés permiso para vincular facturas de compra.",
              fix: "Dejá la factura sin vincular o pedile a alguien de Finanzas que la vincule.",
            },
            {
              message: "No tenés permiso para vincular movimientos.",
              fix: "Dejá el movimiento sin vincular.",
            },
            {
              message: "No tenés permiso para crear cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: [
            "importar-resumen-combustible",
            "adjuntar-ticket-combustible",
          ],
          keywords: ["gasoil", "nafta", "cargar combustible", "litros", "YPF"],
        },
        {
          id: "editar-carga-combustible",
          title: "Editar una carga de combustible",
          permission: "fuel:write",
          steps: [
            "En [[/fuel]], en la fila, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos o vinculá la factura de compra o el movimiento de pago.",
            "Hacé clic en {{Guardar}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-carga-combustible"],
          keywords: ["vincular factura combustible"],
        },
        {
          id: "adjuntar-ticket-combustible",
          title: "Adjuntar el ticket o remito de una carga",
          permission: attachmentPermission("fuel_load"),
          prerequisites: [
            "Para ver el ítem del menú hace falta permiso para leer archivos; para subir, además escribir archivos y combustible.",
          ],
          steps: [
            "En [[/fuel]], en la fila, abrí el menú ⋯ y elegí {{Ticket o remito}}.",
            "En {{Ticket de la carga}}, arrastrá el archivo o elegilo desde el dispositivo. Desde el celular podés sacarle una foto al remito.",
          ],
          after: [
            "El archivo queda adjunto a la carga y también aparece en [[/files]].",
          ],
          keywords: ["foto ticket", "comprobante combustible"],
        },
        {
          id: "importar-resumen-combustible",
          title: "Importar el resumen de la tarjeta de combustible",
          summary:
            "Carga de una vez todas las cargas del resumen de YPF en Ruta, Axion Card u otra planilla (.xlsx o .csv).",
          permission: "fuel:write",
          prerequisites: [
            "Los vehículos tienen que tener su patente o su {{Tarjeta de combustible}} cargada ([[#crear-vehiculo]]) para que cada fila se les asigne.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Importar resumen de combustible",
              description:
                "Subí el resumen de la tarjeta (.xlsx o .csv). Cada fila se asigna a un vehículo por patente o por número de tarjeta; nada se guarda hasta que confirmes.",
              fields: [
                {
                  label: "Tarjeta",
                  kind: "select",
                  value: "YPF en Ruta",
                  marker: 2,
                },
                {
                  label: "Archivo",
                  kind: "input",
                  value: "resumen-octubre.xlsx",
                  marker: 2,
                },
              ],
              table: {
                columns: [
                  "Fila",
                  "Fecha",
                  "Vehículo",
                  "Litros",
                  "Importe",
                  "Estación",
                  "Estado",
                ],
                rows: [
                  [
                    "~2",
                    "~01/10/2026",
                    "~AB123CD",
                    "~300,00",
                    "~$330.000",
                    "~YPF",
                    "~Lista",
                  ],
                  [
                    "~3",
                    "~01/10/2026",
                    "~7090001234",
                    "~150,00",
                    "~$165.000",
                    "~YPF",
                    "~Sin vehículo",
                  ],
                ],
                marker: 5,
              },
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "~Importar 1 carga", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            "En [[/fuel]], hacé clic en {{Importar resumen}}.",
            "En {{Tarjeta}}, elegí {{YPF en Ruta}}, {{Axion Card}} u {{Otra planilla}}; en {{Archivo}}, elegí el .xlsx o .csv (hasta 4 MB).",
            "Hacé clic en {{Leer archivo}}.",
            "En {{Columnas}}, revisá qué columna del archivo corresponde a cada dato. Las que faltan dicen «(falta)»: elegilas y hacé clic en {{Volver a leer con estas columnas}}. Fecha, litros, importe y patente o tarjeta son necesarias.",
            {
              text: "Revisá la vista previa. Arriba se cuentan las filas por estado; cada fila dice el suyo:",
              substeps: [
                "{{Lista}}: se importa (viene marcada).",
                "{{Duplicada}}: ya está cargada (mismo vehículo, fecha, litros e importe) o repetida en el archivo. Viene desmarcada; marcala solo si de verdad es otra carga.",
                "{{Sin vehículo}}: no hay un vehículo con esa patente o tarjeta. Cargale la tarjeta al vehículo y volvé a leer.",
                "{{Con error}}: fecha, litros o importe ilegibles. No se puede importar.",
              ],
            },
            "Hacé clic en el botón **Importar N cargas**.",
          ],
          after: [
            "Se crean las cargas elegidas, con la nota «Importada de <tarjeta>» y el producto si venía. El aviso dice cuántas se importaron y cuántas se salteó porque ya estaban.",
            "Las cargas importadas no tienen comprobante vinculado: vinculá la factura de compra del resumen editándolas.",
          ],
          errors: [
            {
              message: "Elegí el archivo del resumen.",
              fix: "Elegí el archivo.",
            },
            {
              message: "El archivo supera los 4 MB.",
              fix: "Partí el resumen en archivos más chicos.",
            },
            {
              message:
                "No encontramos la fila de títulos (Fecha, Patente, Litros, Importe…).",
              fix: "Revisá que el archivo tenga una fila de títulos, o elegí {{Otra planilla}}.",
            },
            {
              message: "Algún vehículo ya no existe. Volvé a leer el archivo.",
              fix: "Hacé clic en {{Leer archivo}} de nuevo.",
            },
            {
              message: "No tenés permiso para importar cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-vehiculo", "crear-carga-combustible"],
          keywords: [
            "importar combustible",
            "resumen tarjeta",
            "YPF en Ruta",
            "Axion",
            "excel combustible",
          ],
        },
        {
          id: "borrar-carga-combustible",
          title: "Borrar una carga de combustible",
          permission: "fuel:write",
          steps: [
            "En [[/fuel]], en la fila, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para borrar cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          keywords: ["eliminar carga combustible"],
        },
      ],
    },

    // ── Km recorridos ────────────────────────────────────────────────────
    {
      id: "flota-km-mensual",
      title: "Km recorridos",
      menuPath: "Flota › Km recorridos",
      routes: ["/vehicle-km", "/vehicles/[id]", "/drivers/[id]"],
      permission: "fleet_km:read",
      intro: [
        "Los km de cada vehículo según Strix Flotas (el GPS de los camiones), día por día. Arriba se eligen las fechas (por defecto, este mes) y la tabla muestra, para ese rango, {{Vehículo}}, {{Km recorridos}}, {{Días con km}} y {{Último día}}, con el total abajo.",
        "Los km se traen solos todos los días a la mañana (la última semana, para completar el día anterior). Cada patente de Strix se reconoce por la patente del vehículo: si Strix tiene una que no está cargada en [[/vehicles]], sus km no se guardan y la línea de estado la nombra. Llevan km los vehículos activos que no son acoplado ni semi.",
        "Hacé clic en una patente (acá, en [[/vehicles]] o en [[/trips]]) para abrir la página del vehículo: sus km de cada día y el chofer que lo manejó, que sale de los viajes de ese día. Si un día no tiene viaje cargado, dice {{Sin viaje cargado}}.",
        "Hacé clic en el chofer para abrir su página: sus viajes con el vehículo y los km que hizo ese día, y {{Ver legajo de RRHH}} si es empleado. Desde el legajo, {{Ver viajes y km}} vuelve a esa página.",
      ],
      screens: [
        {
          kind: "page",
          title: "Km recorridos",
          toolbar: [{ label: "Este mes", kind: "input" }],
          actions: [{ label: "Traer km", variant: "primary" }],
          table: {
            columns: ["Vehículo", "Km recorridos", "Días con km", "Último día"],
            rows: [
              ["~AF679VY", "~4.580", "~22", "~05/11/2026"],
              ["~AH260UH", "~3.120", "~18", "~05/11/2026"],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "cargar-km-mensual",
          title: "Traer los km de Strix de otras fechas",
          permission: "fleet_km:write",
          steps: [
            "En [[/vehicle-km]], hacé clic en {{Traer km}}.",
            "Elegí {{Desde}} y {{Hasta}} (vienen con las fechas de la pantalla) y hacé clic en {{Traer km}}. Trae todos los vehículos juntos; la línea de estado muestra «Trayendo km de Strix…» mientras corre.",
          ],
          after: [
            "Cuando termina, la tabla se actualiza y la línea de estado dice cuántos vehículos trajo, qué meses no se pudieron leer y qué patentes de Strix no están cargadas. Traer de nuevo un día lo reemplaza.",
          ],
          errors: [
            {
              message:
                "Falta cargar el usuario de Strix: lo carga un owner o admin en Admin → Accesos.",
              fix: "Pedíselo a un owner o admin.",
            },
            {
              message:
                "JouveERP dejó de entrar a Strix con la clave guardada: un owner o admin tiene que volver a cargarla.",
              fix: "Pedile a un owner o admin que cargue la clave en [[/admin/accesos]].",
            },
            {
              message: "No tenés permiso para traer km.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["editar-km-mensual"],
          keywords: ["kilometraje", "km camión", "gps", "strix"],
        },
        {
          id: "editar-km-mensual",
          title: "Cargar el usuario de Strix",
          permission: "fleet_km:admin",
          screens: [
            {
              kind: "dialog",
              title: "Usuario de Strix",
              fields: [
                {
                  label: "Usuario (email)",
                  value: "logistica@empresa.com",
                  marker: 2,
                },
                { label: "Clave", value: "••••••", marker: 2 },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/admin/accesos]], en {{Usuario de Strix para los km de la flota}}, hacé clic en {{Cambiar}} (o {{Configurar}} la primera vez).",
            "Escribí el {{Usuario (email)}} y la {{Clave}} con que se entra a Strix Flotas. Para cambiar solo el usuario, dejá la clave vacía.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "La clave se guarda cifrada y no se vuelve a mostrar. Si Strix la rechaza (o falla dos veces seguidas), JouveERP deja de intentar hasta que se vuelva a cargar.",
          ],
          errors: [
            {
              message: "Falta la clave.",
              fix: "La primera vez hay que escribir la clave.",
            },
            {
              message: "No tenés permiso para configurar Strix.",
              fix: "Lo hace un owner o admin.",
            },
          ],
          related: ["cargar-km-mensual"],
        },
      ],
    },

    // ── Mantenimiento ────────────────────────────────────────────────────
    {
      id: "flota-mantenimiento",
      title: "Mantenimiento",
      menuPath: "Flota › Mantenimiento",
      routes: ["/maintenance"],
      permission: "maintenance:read",
      intro: [
        "Los services y reparaciones de cada vehículo, con {{Fecha}}, {{Vehículo}}, {{Tipo}}, {{Descripción}}, {{Costo}} y {{Próx. service}}.",
        "El costo cuenta como mantenimiento del vehículo. Un mantenimiento sin costo cargado no suma; uno sin factura de compra ni movimiento vinculado no llega a la contabilidad.",
      ],
      screens: [
        {
          kind: "page",
          title: "Mantenimientos",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo mantenimiento", variant: "primary" },
          ],
          table: {
            columns: [
              "Fecha",
              "Vehículo",
              "Tipo",
              "Descripción",
              "Costo",
              "Próx. service",
            ],
            rows: [
              [
                "~2026-10-20",
                "~AB123CD",
                "~Service",
                "~Cambio de aceite y filtros",
                "~$280.000",
                "~2027-01-20",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      tasks: [
        {
          id: "crear-mantenimiento",
          title: "Registrar un mantenimiento",
          permission: "maintenance:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo mantenimiento",
              description:
                "Mantenimiento del vehículo: tipo, fecha, costo y próximo service.",
              fields: [
                {
                  label: "Fecha",
                  kind: "date",
                  value: "20/10/2026",
                  marker: 2,
                },
                { label: "Tipo", kind: "select", value: "Service", marker: 2 },
                {
                  label: "Vehículo",
                  kind: "select",
                  value: "AB123CD",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Descripción",
                  value: "Cambio de aceite y filtros",
                  wide: true,
                  marker: 2,
                },
                { label: "Costo", kind: "money", value: "280.000,00" },
                { label: "Km", kind: "money" },
                { label: "Próx. service", kind: "date" },
                { label: "Próx. km", kind: "money" },
                { label: "Proveedor", value: "Taller Pérez", wide: true },
                { label: "Notas", kind: "textarea", wide: true },
                {
                  label: "Factura de compra (opcional)",
                  kind: "picker",
                  wide: true,
                  marker: 3,
                },
                {
                  label: "Movimiento de pago (opcional)",
                  kind: "picker",
                  wide: true,
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/maintenance]], hacé clic en {{Nuevo mantenimiento}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Fecha}}, {{Vehículo}} y {{Descripción}}: obligatorios.",
                "{{Tipo}}: {{Service}}, {{Reparación}}, {{Neumáticos}}, {{VTV}} u {{Otro}}.",
                "{{Costo}}, {{Km}}, {{Próx. service}} (fecha), {{Próx. km}}, {{Proveedor}} y {{Notas}}: opcionales.",
              ],
            },
            "Opcional: vinculá {{Factura de compra (opcional)}} o {{Movimiento de pago (opcional)}}. Si vinculás alguno, el {{Costo}} es obligatorio.",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "El costo suma al mantenimiento del vehículo. {{Próx. service}} queda a la vista en la lista.",
          ],
          errors: [
            { message: "Vehículo requerido.", fix: "Elegí el vehículo." },
            { message: "Fecha requerida.", fix: "Elegí la fecha." },
            { message: "Descripción requerida.", fix: "Describí el trabajo." },
            {
              message: "Cargá el costo del comprobante vinculado.",
              fix: "Escribí el costo, o quitá la factura o el movimiento vinculado.",
            },
            {
              message: "No tenés permiso para vincular facturas de compra.",
              fix: "Dejá la factura sin vincular.",
            },
            {
              message: "No tenés permiso para crear mantenimientos.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["editar-mantenimiento"],
          keywords: ["service", "reparación", "taller", "neumáticos", "aceite"],
        },
        {
          id: "editar-mantenimiento",
          title: "Editar un mantenimiento",
          permission: "maintenance:write",
          steps: [
            "En [[/maintenance]], en la fila, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos.",
            "Hacé clic en {{Guardar}}.",
          ],
          errors: [
            {
              message: "Cargá el costo del comprobante vinculado.",
              fix: "Si tiene factura o movimiento vinculado, el costo no puede quedar vacío.",
            },
            {
              message: "No tenés permiso para editar mantenimientos.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-mantenimiento"],
        },
        {
          id: "borrar-mantenimiento",
          title: "Borrar un mantenimiento",
          permission: "maintenance:write",
          steps: [
            "En [[/maintenance]], en la fila, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para borrar mantenimientos.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          keywords: ["eliminar mantenimiento"],
        },
      ],
    },

    // ── Vencimientos ─────────────────────────────────────────────────────
    {
      id: "flota-vencimientos",
      title: "Vencimientos de flota",
      menuPath: "Flota › Vencimientos",
      routes: ["/fleet-documents"],
      permission: "fleet_documents:read",
      intro: [
        "La documentación vencible de vehículos y choferes: VTV, seguro, cédula, RTO, licencia, ART, etc. La tabla muestra {{Dueño}} (vehículo o chofer), {{Tipo}}, {{N°}}, {{Vence}} y {{Archivo}}. Lo que vence en 7 días o menos se resalta.",
      ],
      screens: [
        {
          kind: "page",
          title: "Documentación de flota",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo documento", variant: "primary" },
          ],
          table: {
            columns: ["Dueño", "Tipo", "N°", "Vence", "Archivo"],
            rows: [
              ["~Vehículo AB123CD", "~VTV", "~—", "~2026-11-20", "~Ver"],
              [
                "~Chofer Juan Pérez",
                "~Licencia",
                "~12345678",
                "~2027-03-01",
                "~—",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Tareas automáticas de vencimiento",
          body: [
            "Todos los días a la mañana el sistema revisa la documentación: cuando un documento de un vehículo o chofer activo vence dentro de 30 días, abre una tarea automática en [[/tasks]] para renovarlo, con vencimiento en la fecha del documento.",
            "La tarea se cierra sola en la revisión siguiente a que cargues el documento renovado (el mismo tipo, para el mismo vehículo o chofer, con un vencimiento más allá de 30 días). No hace falta borrar el documento viejo: queda como historia.",
            "Los documentos de vehículos o choferes inactivos no generan tareas.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-documento-flota",
          title: "Cargar un documento con vencimiento",
          permission: "fleet_documents:write",
          prerequisites: [
            "Para adjuntar el archivo hace falta también permiso para escribir archivos.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo documento",
              description:
                "Documentación vencible de un vehículo o un chofer (VTV, seguro, licencia, ART, etc.).",
              fields: [
                {
                  label: "Dueño",
                  kind: "select",
                  value: "Vehículo",
                  marker: 2,
                },
                {
                  label: "Vehículo",
                  kind: "select",
                  value: "AB123CD",
                  marker: 2,
                },
                { label: "Tipo", kind: "select", value: "VTV", marker: 3 },
                { label: "N°", value: "Póliza / nro." },
                { label: "Emisión", kind: "date" },
                {
                  label: "Vencimiento",
                  kind: "date",
                  value: "20/11/2027",
                  marker: 3,
                },
                { label: "Notas", kind: "textarea", wide: true },
                {
                  label: "Archivo",
                  kind: "input",
                  value: "Arrastrá el escaneo o elegí un archivo",
                  wide: true,
                  marker: 4,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/fleet-documents]], hacé clic en {{Nuevo documento}}.",
            "En {{Dueño}}, elegí {{Vehículo}} o {{Chofer}}, y después cuál (solo los activos).",
            "Elegí el {{Tipo}} ({{VTV}}, {{Seguro}}, {{Cédula}}, {{RTO/Ruta}}, {{SENASA}}, {{Licencia}}, {{LNH}}, {{ART}}, {{Libreta sanitaria}}, {{Curso}} u {{Otro}}), el {{N°}}, la {{Emisión}} (opcional) y el {{Vencimiento}} (obligatorio).",
            "Opcional: en {{Archivo}}, arrastrá el escaneo o elegí un archivo (PDF o imagen, hasta 10 MB).",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "El documento aparece en la lista. En la revisión diaria de la mañana siguiente: si vence dentro de 30 días, se abre una tarea de renovación en [[/tasks]]; si renueva uno anterior, la tarea del anterior se cierra.",
          ],
          errors: [
            {
              message: "Elegí un vehículo o un chofer.",
              fix: "Elegí a quién pertenece el documento.",
            },
            { message: "Fecha requerida.", fix: "Completá {{Vencimiento}}." },
            {
              message: "Documento guardado, pero el archivo no: …",
              fix: "El documento se creó: editálo y volvé a subir el archivo.",
            },
            {
              message: "No tenés permiso para adjuntar archivos.",
              fix: "Guardá el documento sin archivo y pedile a alguien con permiso para subir archivos que lo adjunte.",
            },
            {
              message: "No tenés permiso para crear documentación.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["editar-documento-flota"],
          keywords: [
            "VTV",
            "seguro",
            "licencia",
            "ART",
            "renovar",
            "vencimiento",
            "RTO",
          ],
        },
        {
          id: "editar-documento-flota",
          title: "Editar un documento o cambiar su archivo",
          permission: "fleet_documents:write",
          steps: [
            "En [[/fleet-documents]], en la fila, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos. Si tiene archivo, subí otro para reemplazarlo o usá la X para quitarlo.",
            "Hacé clic en {{Guardar}}.",
          ],
          errors: [
            {
              message: "Documento guardado, pero el archivo no: …",
              fix: "Volvé a subir el archivo.",
            },
            {
              message: "No tenés permiso para editar documentación.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["crear-documento-flota"],
        },
        {
          id: "ver-archivo-documento-flota",
          title: "Ver el archivo de un documento",
          permission: "fleet_documents:read",
          steps: [
            "En [[/fleet-documents]], en la columna {{Archivo}}, hacé clic en {{Ver}}.",
          ],
          after: ["El archivo se abre en otra pestaña."],
          errors: [
            {
              message: "No se pudo abrir el archivo.",
              fix: "Volvé a intentar.",
            },
          ],
        },
        {
          id: "borrar-documento-flota",
          title: "Borrar un documento",
          permission: "fleet_documents:write",
          steps: [
            "En [[/fleet-documents]], en la fila, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "Si tenía una tarea de renovación abierta, se cierra sola en la próxima revisión.",
          ],
          errors: [
            {
              message: "No tenés permiso para borrar documentación.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
        },
      ],
    },
  ],
};
