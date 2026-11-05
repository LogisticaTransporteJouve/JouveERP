import type { GuidePage } from "../types";

import { attachmentPermission } from "./attachment-permissions";

// Fleet chapter: drivers, vehicles, trips and their cargas, freight
// liquidaciones, cash-on-delivery rendiciones, fuel, monthly km,
// maintenance, expiring documents and profitability.

export const fleetPage: GuidePage = {
  file: "flota.html",
  title: "Flota",
  lead: "Choferes, vehículos, viajes y cargas; la liquidación del flete a cada cliente, la rendición de lo que cobran los choferes, y los costos de la flota: combustible, km, mantenimiento, vencimientos y rentabilidad.",
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
        "Los viajes, las rendiciones y la documentación vencible se asignan a un chofer de esta lista. La documentación (licencia, ART, libreta sanitaria) no se carga acá sino en [[/fleet-documents]].",
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
          after: [
            "Los cambios se ven en los viajes, cargas y rendiciones del chofer.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar choferes.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
            {
              message: "No se pudo actualizar el chofer.",
              fix: "Volvé a intentar.",
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
            "En [[/drivers]], en la fila del chofer, usá el interruptor {{Activo}}.",
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
            "En [[/drivers]], en la fila del chofer, abrí el menú ⋯ y elegí {{Borrar}}.",
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
        "Cada vehículo se usa en viajes, cargas de combustible, km mensual, mantenimientos y documentación (VTV, seguro). Su {{Tarjeta de combustible}} sirve para reconocerlo al importar el resumen de YPF en Ruta o Axion Card.",
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
                "{{Tipo}}: {{Camión}}, {{Acoplado}}, {{Semi}}, {{Utilitario}}, {{Furgón}}, {{Auto}} u {{Otro}}. Los acoplados y semis no llevan km mensual.",
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
        "Cada viaje de la flota con {{Fecha}}, {{Chofer}}, {{Vehículo}}, {{Origen → Destino}}, {{Estado}} e {{Ingreso manual}}. Un viaje junta las cargas que lleva: desde el menú ⋯ de la fila, {{Ver cargas}} abre la página del viaje.",
        "La página del viaje (`Viaje del <fecha>`) muestra el chofer y la patente, y la tabla {{Cargas del viaje}} con {{Cliente}}, {{Ruta}}, {{Estado}} y {{Flete}} de cada carga.",
        "Un usuario con el rol Chofer vinculado a un chofer ve solo los viajes de ese chofer.",
      ],
      screens: [
        {
          kind: "page",
          title: "Viajes",
          actions: [{ label: "Nuevo viaje", variant: "primary" }],
          table: {
            columns: [
              "Fecha",
              "Chofer",
              "Vehículo",
              "Origen → Destino",
              "Estado",
              "Ingreso manual",
            ],
            rows: [
              [
                "~2026-11-03",
                "~Juan Pérez",
                "~AB123CD",
                "~Rosario → Córdoba",
                "~Completado",
                "~$450.000",
              ],
            ],
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
        {
          title: "Ingreso y costo del viaje",
          body: [
            "{{Ingreso manual}} y {{Costo}} se cargan a mano. Un viaje no tiene cliente: los clientes son de sus cargas. En [[/fleet-reports]], el ingreso de un viaje que tiene cargas es el flete facturado de esas cargas; el {{Ingreso manual}} cuenta solo para los viajes sin cargas.",
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
                "Viaje de la flota: chofer, vehículo, origen/destino y resultado económico.",
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
                {
                  label: "Canal (opcional)",
                  kind: "select",
                  value: "Ninguno",
                  wide: true,
                },
                { label: "Origen", value: "Rosario" },
                { label: "Destino", value: "Córdoba" },
                { label: "Carga", value: "Materiales de obra", wide: true },
                { label: "Km", kind: "money" },
                { label: "Ingreso manual", kind: "money" },
                { label: "Costo", kind: "money" },
                { label: "Notas", kind: "textarea", wide: true },
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
                "{{Canal (opcional)}}, {{Origen}}, {{Destino}} y {{Carga}} (descripción de lo que lleva).",
                "{{Km}} recorridos, e {{Ingreso manual}} y {{Costo}} en pesos: opcionales y no negativos. El {{Ingreso manual}} solo cuenta en la rentabilidad si el viaje no tiene cargas.",
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
              message:
                "El viaje tiene cargas en una rendición: cancelala antes de cambiar el chofer.",
              fix: "Cancelá la rendición del chofer en [[/rendiciones]] o dejá el chofer como estaba.",
            },
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
                    "~Ferretería Norte S.A. · Rosario → Córdoba · 2026-11-03",
                  kind: "checkbox",
                  value: "sí",
                  wide: true,
                  marker: 3,
                },
                {
                  label: "~Agro Sur SRL · Rosario → Villa María",
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
            "Una carga contra entrega se rinde con el chofer de su viaje ([[#flota-rendiciones]]).",
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
            "La carga vuelve a quedar sin viaje y se puede asignar a otro. También se puede mover editándola en [[/cargas]] (campo {{Viaje}}).",
          ],
          errors: [
            {
              message:
                "La carga está en …: sacala o cancelá la rendición para cambiar su cobranza, cliente, viaje o estado.",
              fix: "La carga ya se rindió: sacala de la rendición en borrador o cancelá la rendición en [[/rendiciones]].",
            },
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
              message:
                "La carga está en …: sacala o cancelá la rendición para cambiar su cobranza, cliente, viaje o estado.",
              fix: "Una carga del viaje ya está en una rendición: cancelala en [[/rendiciones]] antes de borrar el viaje.",
            },
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
        "Las cargas a transportar: {{Cliente}} (con el número de remito debajo), {{Ruta}}, {{Fecha programada}}, {{Viaje}} ({{Sin asignar}} si todavía no tiene), {{Estado}} y {{Flete}}. Junto al flete se marca {{Facturado}} cuando la carga ya tiene factura, y «Contra entrega» con el monto cuando el chofer cobra al entregar.",
        "La búsqueda ({{Buscar por remito, cliente o ruta…}}) filtra por número de remito, cliente, origen, destino o descripción. Al abrir una carga desde un remito escaneado, la búsqueda llega cargada con su número.",
        "Sin el permiso de escritura de cargas, la pantalla es de solo lectura: el menú ⋯ muestra solo {{Historial}}.",
      ],
      screens: [
        {
          kind: "page",
          title: "Cargas",
          actions: [{ label: "Nueva carga", variant: "primary" }],
          toolbar: [
            { label: "~Buscar por remito, cliente o ruta…", kind: "input" },
          ],
          table: {
            columns: [
              "Cliente",
              "Ruta",
              "Fecha programada",
              "Viaje",
              "Estado",
              "Flete",
            ],
            rows: [
              [
                "~Ferretería Norte S.A. · Remito 0001-00012345",
                "~Rosario → Córdoba",
                "~03/11/2026",
                "~2026-11-03",
                "~Entregada",
                "~$180.000 Facturado",
              ],
              [
                "~Agro Sur SRL",
                "~Rosario → Villa María",
                "~05/11/2026",
                "~Sin asignar",
                "~No iniciada",
                "~$95.000",
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
            "{{No iniciada}} (al crearla) → {{En progreso}} ({{Iniciar}}) → {{Entregada}} ({{Entregar}}); una carga {{No iniciada}} también se puede entregar directo. Desde {{No iniciada}} o {{En progreso}} también se puede {{Cancelar}} o {{Reprogramar}}; una carga {{Cancelada}} o {{Reprogramada}} solo se puede volver a reprogramar.",
            "Para una carga {{Entregada}} el menú ya no ofrece cambios de estado. Solo las cargas entregadas entran en una liquidación o en una rendición.",
            "Cada cambio de estado queda en el {{Historial}} con su comentario, fecha y hora.",
          ],
        },
        {
          title: "El flete: propio o por tarifa",
          body: [
            "Cada carga puede tener su {{Flete}}. Al crear una carga, si el cliente tiene una tarifa de flete vigente en la fecha programada (o en la de hoy), el campo se completa solo y debajo dice «Tarifa de flete del cliente»; si escribís otro importe, queda el tuyo.",
            "Una carga sin flete propio igual se puede liquidar: la liquidación la precia con la tarifa de flete del cliente vigente en su fecha de entrega. Para facturarla sola con {{Facturar flete}}, en cambio, necesita su propio flete.",
          ],
        },
        {
          title: "Cobranza contra entrega",
          body: [
            "{{Cobranza contra entrega}} es lo que el chofer le cobra al cliente al entregar. Vacío significa que no cobra. Lo cobrado se rinde después en [[/rendiciones]], con el chofer del viaje de la carga.",
          ],
        },
        {
          title: "Qué bloquea una carga",
          body: [
            "**Facturada:** mientras su factura esté vigente no se puede borrar ni cambiar su cliente, canal, ruta o flete. Para liberarla: anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.",
            "**En una liquidación:** no se puede borrar ni cambiar su cliente o su estado, ni facturarla sola; si la liquidación ya está confirmada, tampoco cambia su flete.",
            "**En una rendición:** no se puede borrar ni cambiar su cobranza, cliente, viaje o estado.",
            "**Remito repetido:** el número de remito no se repite entre las cargas vivas de un mismo cliente (se compara sin espacios de más y sin distinguir mayúsculas). Una carga cancelada libera su número.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-carga",
          title: "Crear una carga",
          permission: "shipments:write",
          prerequisites: [
            "El cliente tiene que existir en [[/clients]]; su tarifa de flete se carga en la ficha del cliente.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nueva carga",
              description:
                "Carga a transportar: cliente, ruta y flete. El viaje se asigna después, desde el viaje.",
              fields: [
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Ferretería Norte S.A.",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Remito del cliente",
                  value: "0001-00012345",
                  wide: true,
                  marker: 3,
                },
                { label: "Origen", value: "Rosario" },
                { label: "Destino", value: "Córdoba" },
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
                },
                {
                  label: "Flete",
                  kind: "money",
                  value: "180.000,00",
                  marker: 4,
                },
                {
                  label: "Cobranza contra entrega",
                  kind: "money",
                  wide: true,
                  marker: 5,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            "En [[/cargas]], hacé clic en {{Nueva carga}}.",
            "En {{Cliente}}, buscá por razón social, nombre fantasía o CUIT y elegilo.",
            "En {{Remito del cliente}}, escribí el número del remito (hasta 60 caracteres). Si ya está en otra carga viva del mismo cliente, aparece un aviso con esa carga y no se puede guardar.",
            "Completá {{Origen}}, {{Destino}}, {{Descripción}}, {{Fecha programada}} y {{Flete}} (se completa con la tarifa del cliente si tiene una vigente).",
            "Si el chofer cobra al entregar, escribí el monto en {{Cobranza contra entrega}} (mayor a 0); si no, dejalo vacío.",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "La carga queda {{No iniciada}} y {{Sin asignar}}. Asignala a un viaje desde la página del viaje ([[#asignar-cargas-viaje]]).",
          ],
          errors: [
            {
              message:
                "Ese número de remito ya está en otra carga del cliente.",
              fix: "Revisá el número, o cancelá la otra carga si estaba mal cargada.",
            },
            {
              message: "El monto a cobrar tiene que ser mayor a 0.",
              fix: "Escribí un monto o dejá el campo vacío si no cobra al entregar.",
            },
            {
              message: "No tenés permiso para crear cargas.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: [
            "asignar-cargas-viaje",
            "facturar-flete-carga",
            "crear-liquidacion",
          ],
          keywords: [
            "nueva carga",
            "remito",
            "flete",
            "contra entrega",
            "envío",
          ],
        },
        {
          id: "editar-carga",
          title: "Editar una carga o moverla de viaje",
          permission: "shipments:write",
          steps: [
            "En [[/cargas]], en la fila de la carga, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá los datos. En la edición aparece también {{Viaje}}: elegí otro viaje o {{Sin asignar}} para sacarla del que tiene.",
            "Hacé clic en {{Guardar}}.",
          ],
          errors: [
            {
              message:
                "La carga ya está facturada: para cambiar cliente, canal, ruta o flete, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.",
              fix: "Anulá la factura (interna) o emití la nota de crédito por el total (fiscal) en [[/invoices]] y volvé a editarla.",
            },
            {
              message:
                "La carga está en …: sacala o cancelá la liquidación para cambiar su cliente o su estado.",
              fix: "Sacala de la liquidación en borrador o cancelá la liquidación en [[/liquidaciones]].",
            },
            {
              message: "La carga está en …, ya confirmada: su flete no cambia.",
              fix: "Cancelá la liquidación confirmada si el flete estaba mal, y armala de nuevo.",
            },
            {
              message:
                "La carga está en …: sacala o cancelá la rendición para cambiar su cobranza, cliente, viaje o estado.",
              fix: "Sacala de la rendición en borrador o cancelá la rendición en [[/rendiciones]].",
            },
            {
              message:
                "Ese número de remito ya está en otra carga del cliente.",
              fix: "Revisá el número.",
            },
          ],
          related: ["crear-carga"],
          keywords: ["modificar carga", "cambiar flete", "cambiar viaje"],
        },
        {
          id: "cambiar-estado-carga",
          title: "Iniciar, entregar, cancelar o reprogramar una carga",
          permission: "shipments:write",
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar" },
                { label: "Iniciar", marker: 1 },
                { label: "Entregar", marker: 1 },
                { label: "Cancelar", destructive: true, marker: 1 },
                { label: "Reprogramar", marker: 1 },
                { label: "Facturar flete" },
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
            "En [[/cargas]], en la fila de la carga, abrí el menú ⋯ y elegí la acción: {{Iniciar}}, {{Entregar}}, {{Cancelar}} o {{Reprogramar}}. El menú muestra solo las que permite el estado actual.",
            {
              text: "Completá el diálogo:",
              substeps: [
                "{{Iniciar carga}}: solo un {{Comentario}} opcional.",
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
            "Una carga entregada ya puede entrar en una liquidación ([[#crear-liquidacion]]) y, si es contra entrega, queda pendiente de rendir en [[/rendiciones]].",
            "Al cancelar, el número de remito queda libre para otra carga del cliente; al sacarla de cancelada (reprogramándola) lo vuelve a tomar.",
          ],
          errors: [
            {
              message: "El motivo es obligatorio.",
              fix: "Escribí por qué se cancela.",
            },
            {
              message:
                "La carga está en …: sacala o cancelá la liquidación para cambiar su cliente o su estado.",
              fix: "Sacala de la liquidación o cancelá la liquidación en [[/liquidaciones]].",
            },
            {
              message:
                "La carga está en …: sacala o cancelá la rendición para cambiar su cobranza, cliente, viaje o estado.",
              fix: "Sacala de la rendición o cancelá la rendición en [[/rendiciones]].",
            },
            {
              message:
                "Ese número de remito ya está en otra carga del cliente.",
              fix: "Otra carga viva del cliente tomó el remito mientras esta estaba cancelada: cambiale el número antes.",
            },
            {
              message: "No tenés permiso para cambiar el estado.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["ver-historial-carga"],
          keywords: [
            "entregada",
            "en viaje",
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
          id: "facturar-flete-carga",
          title: "Facturar el flete de una carga suelta",
          summary:
            "Una factura con una sola línea «Flete origen → destino» al 21% de IVA. Para facturar varias cargas juntas, usá una liquidación.",
          permission: ["shipments:write", "invoices:issue"],
          prerequisites: [
            "La carga tiene cliente y flete propio, no está facturada y no está en una liquidación.",
            "Un cliente de Ventas necesita CUIT y condición de IVA ([[/clients]]); uno de Otras ventas se factura con un remito interno.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Facturar flete",
              description: "Generá la factura del flete de esta carga.",
              fields: [
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve fiscal",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Punto de venta",
                  kind: "select",
                  value: "0003",
                  wide: true,
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Facturar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/cargas]], en la fila de la carga, abrí el menú ⋯ y elegí {{Facturar flete}}. El diálogo muestra el cliente y el flete.",
            "En {{Canal}}, elegí el canal: solo se ofrecen los del lado del cliente (Ventas o Otras ventas). Si la carga ya tiene canal, viene fijo.",
            "En {{Punto de venta}}, elegí el punto de venta del canal.",
            "Hacé clic en {{Facturar}}.",
          ],
          after: [
            "Se crea el comprobante en [[/invoices]] con fecha de hoy y período de servicio igual a la fecha de entrega (o la programada). En un canal fiscal es una factura A o B que va a AFIP por el CAE; en el interno, un remito interno.",
            "La carga queda {{Facturado}} y bloqueada para cambios de cliente, canal, ruta o flete mientras la factura esté vigente.",
            "Si la factura falla en AFIP, se anula, o una nota de crédito la acredita por el total, la carga vuelve a quedar libre para facturar.",
          ],
          errors: [
            { message: "Elegí un canal.", fix: "Elegí el canal en {{Canal}}." },
            {
              message: "Elegí un punto de venta.",
              fix: "Elegí el punto de venta.",
            },
            {
              message: "La carga ya tiene una factura o se está facturando.",
              fix: "Otro usuario ya la facturó o la está facturando: actualizá la pantalla.",
            },
            {
              message: "La carga está en …: se factura desde la liquidación.",
              fix: "Facturala desde [[/liquidaciones]], o sacala de la liquidación primero.",
            },
            {
              message:
                "La carga está cargada en otro canal: facturala en el canal de la carga.",
              fix: "Elegí el canal que tiene la carga.",
            },
            {
              message: "La carga necesita un cliente con CUIT.",
              fix: "Cargale el CUIT al cliente en [[/clients]].",
            },
            {
              message: "Cargá un monto de flete primero.",
              fix: "Editá la carga y escribí el flete.",
            },
            {
              message: "La condición de IVA del cliente es inválida.",
              fix: "Corregí la condición de IVA en la ficha del cliente.",
            },
            {
              message:
                "La factura se emitió pero no se vinculó a la carga. En unos minutos volvé a facturar: se vincula la misma factura, sin emitir otra.",
              fix: "Esperá unos minutos y volvé a hacer clic en {{Facturar flete}}.",
            },
            {
              message:
                "La factura falló, se anuló o se acreditó por el total antes de vincularla a la carga: la carga quedó libre para facturarla de nuevo.",
              fix: "Volvé a facturar la carga.",
            },
            {
              message:
                "La carga tiene una factura emitida sin vincular por otro cliente o flete: volvé la carga a esos datos para vincularla.",
              fix: "La carga se editó después de una facturación que no se vinculó: devolvé el cliente y el flete a los de esa factura y volvé a facturar.",
            },
            {
              message: "No tenés permiso para facturar el flete.",
              fix: "Hace falta poder escribir cargas y emitir comprobantes (Admin u Owner).",
            },
          ],
          related: ["crear-liquidacion"],
          keywords: [
            "facturar flete",
            "factura de flete",
            "facturar carga",
            "CAE",
          ],
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
              message:
                "La carga está en …: sacala o cancelá la liquidación antes de borrarla.",
              fix: "Sacala de la liquidación o cancelá la liquidación.",
            },
            {
              message:
                "La carga está en …: sacala o cancelá la rendición antes de borrarla.",
              fix: "Sacala de la rendición o cancelá la rendición.",
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

    // ── Liquidaciones ────────────────────────────────────────────────────
    {
      id: "flota-liquidaciones",
      title: "Liquidaciones de flete",
      menuPath: "Flota › Liquidaciones",
      routes: ["/liquidaciones"],
      permission: "invoices:read",
      intro: [
        "Una liquidación junta las cargas entregadas de un cliente en un período y las cobra con un solo comprobante. La lista muestra {{Número}}, {{Cliente}}, {{Período}}, {{Estado}} y {{Total}}.",
        "Crear, confirmar, facturar y cancelar requiere permiso para emitir comprobantes; sin él la pantalla es de consulta. El contador externo ve solo las liquidaciones del lado fiscal.",
      ],
      screens: [
        {
          kind: "page",
          title: "Liquidaciones",
          actions: [
            { label: "Liquidar período", variant: "outline" },
            { label: "Nueva liquidación", variant: "primary" },
          ],
          table: {
            columns: ["Número", "Cliente", "Período", "Estado", "Total"],
            rows: [
              [
                "~R9002-00000014",
                "~Ferretería Norte S.A.",
                "~01/10/2026 al 31/10/2026",
                "~Facturada · factura emitida",
                "~$1.250.000",
              ],
              [
                "~Borrador",
                "~Agro Sur SRL",
                "~01/10/2026 al 31/10/2026",
                "~Borrador",
                "~$310.000",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Ventas y Otras ventas",
          body: [
            "**Cliente de Ventas (fiscal):** el borrador se confirma con {{Confirmar y emitir remito R}}, que le da un número de Remito R (`R9002-00000001`, correlativo propio). Después, {{Facturar}} emite una sola factura A o B con CAE de AFIP: una línea por carga, con IVA 21%, vinculada al Remito R.",
            "**Cliente de Otras ventas (interno):** no hay Remito R. {{Emitir remito interno}} confirma la liquidación (si estaba en borrador) y emite en un paso un solo remito interno X con una línea por carga, a precio final. Ese remito es el documento final de la liquidación.",
          ],
        },
        {
          title: "Estados",
          body: [
            "{{Borrador}}: se puede editar y cambiar de cargas. {{Confirmada}}: precios congelados, con su Remito R (Ventas); ya no se edita. {{Facturada}}: tiene su factura o su remito interno; el estado agrega {{factura en cola}}, {{emitiendo factura}} o {{factura emitida}} según cómo va la factura en AFIP. {{Cancelada}}: sus cargas quedaron libres.",
            "Si la factura falla en AFIP o se anula, la liquidación vuelve sola a {{Confirmada}} para facturarla de nuevo.",
          ],
        },
        {
          title: "Cómo se precia cada carga",
          body: [
            "Cada carga va con su propio flete ({{Flete de la carga}}) o, si no tiene, con la tarifa de flete del cliente vigente en su fecha de entrega ({{Tarifa del cliente}}). Una carga sin ninguno de los dos no se puede elegir: cargale el flete en [[/cargas]] o la tarifa en la ficha del cliente.",
            "Al confirmar se recalculan los precios con el flete o la tarifa vigente en ese momento.",
            "Entran solo cargas del cliente, {{Entregada}}, con fecha de entrega (o programada) dentro del período, que no estén facturadas solas ni en otra liquidación viva.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-liquidacion",
          title: "Armar una liquidación para un cliente",
          permission: "invoices:issue",
          prerequisites: [
            "Cargas del cliente en estado {{Entregada}} con flete o tarifa ([[#cambiar-estado-carga]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nueva liquidación",
              description:
                "Cargas entregadas del cliente en el período. Cada una va con su flete o, si no tiene, con la tarifa de flete del cliente.",
              fields: [
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Ferretería Norte S.A.",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Desde",
                  kind: "date",
                  value: "01/10/2026",
                  marker: 3,
                },
                {
                  label: "Hasta",
                  kind: "date",
                  value: "31/10/2026",
                  marker: 3,
                },
                {
                  label:
                    "~Rosario → Córdoba · 03/10/2026 · Remito 0001-123 · Flete de la carga — $180.000",
                  kind: "checkbox",
                  value: "sí",
                  wide: true,
                  marker: 4,
                },
                {
                  label:
                    "~Rosario → Villa María · 12/10/2026 · Tarifa del cliente — $95.000",
                  kind: "checkbox",
                  value: "sí",
                  wide: true,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Guardar borrador", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/liquidaciones]], hacé clic en {{Nueva liquidación}}.",
            "En {{Cliente}}, elegí el cliente.",
            "En {{Desde}} y {{Hasta}}, ajustá el período (por defecto, el mes en curso).",
            "En {{Cargas}}, revisá las cargas: todas las que tienen precio vienen marcadas. Desmarcá las que no van, o usá {{Todas}} / {{Ninguna}}. Abajo se ve la cantidad y el total (con «+ IVA» si el cliente es de Ventas).",
            "Opcional: escribí {{Notas}} (hasta 1000 caracteres) y hacé clic en {{Guardar borrador}}.",
          ],
          after: [
            "La liquidación queda en {{Borrador}}, con sus cargas reservadas: no se pueden facturar solas ni entrar en otra liquidación.",
            "Siguiente paso: [[#confirmar-liquidacion]] (Ventas) o [[#emitir-remito-interno-liquidacion]] (Otras ventas).",
          ],
          errors: [
            { message: "Elegí un cliente.", fix: "Elegí el cliente." },
            { message: "Revisá el período.", fix: "Completá las dos fechas." },
            {
              message: "El período termina antes de empezar.",
              fix: "Poné en {{Hasta}} una fecha igual o posterior a {{Desde}}.",
            },
            {
              message: "Elegí al menos una carga.",
              fix: "Marcá al menos una carga.",
            },
            {
              message: "La carga … está fuera del período.",
              fix: "Ampliá el período o desmarcá la carga.",
            },
            {
              message:
                "La carga … no tiene flete ni tarifa de flete vigente: cargá uno de los dos.",
              fix: "Cargale el flete a la carga o la tarifa de flete al cliente.",
            },
            {
              message: "La carga … ya está en ….",
              fix: "La carga ya está en otra liquidación: sacala de esa o cancelala.",
            },
            {
              message:
                "La carga … ya está facturada (o se está facturando) por su cuenta.",
              fix: "Esa carga ya se facturó sola: no puede entrar en la liquidación.",
            },
            {
              message:
                "La carga … no está entregada: solo se liquidan cargas entregadas.",
              fix: "Marcala como entregada en [[/cargas]].",
            },
            {
              message: "No tenés permiso para liquidar fletes.",
              fix: "Pedíselo a alguien de Finanzas, Admin u Owner.",
            },
          ],
          related: ["liquidar-periodo", "confirmar-liquidacion"],
          keywords: [
            "liquidar flete",
            "liquidación",
            "resumen mensual cliente",
            "fletes del mes",
          ],
        },
        {
          id: "liquidar-periodo",
          title: "Liquidar un período para todos los clientes",
          summary:
            "Arma de una vez una liquidación por cliente con sus cargas entregadas del período.",
          permission: "invoices:issue",
          screens: [
            {
              kind: "dialog",
              title: "Liquidar período",
              description:
                "Arma una liquidación por cliente con sus cargas entregadas del período que no están facturadas ni en otra liquidación. Quedan en borrador para revisarlas, o confirmadas si lo elegís.",
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
                  label: "~Confirmarlas",
                  kind: "checkbox",
                  wide: true,
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear borradores", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/liquidaciones]], hacé clic en {{Liquidar período}}.",
            "Ajustá {{Desde}} y {{Hasta}} (por defecto, el mes anterior).",
            "Opcional: marcá la casilla para confirmarlas. Cada cliente de Ventas recibe su Remito R; las de Otras ventas quedan confirmadas para emitir su remito interno X una por una.",
            "Hacé clic en {{Crear borradores}} (o {{Crear y confirmar}} si marcaste la casilla) y, al ver el resultado, en {{Listo}}.",
          ],
          after: [
            "El resultado lista cada liquidación creada con su cantidad de cargas, su total, el Remito R si se confirmó y cuántas cargas sin precio quedaron afuera. Bajo {{Sin liquidación}} aparecen los clientes que no se pudieron liquidar y por qué.",
            "Si el período tiene más de 150 clientes con cargas, no se arma ninguna: hay que liquidar un período más corto.",
          ],
          errors: [
            {
              message:
                "Hay … clientes con cargas: liquidá un período más corto (hasta …).",
              fix: "Achicá el período.",
            },
            {
              message: "El período termina antes de empezar.",
              fix: "Revisá las fechas.",
            },
            {
              message: "No se pudo confirmar: quedó en borrador.",
              fix: "Aparece junto al cliente: confirmala a mano desde su fila.",
            },
          ],
          related: ["crear-liquidacion", "confirmar-liquidacion"],
          keywords: [
            "liquidar mes",
            "liquidación masiva",
            "todos los clientes",
          ],
        },
        {
          id: "editar-liquidacion",
          title: "Editar una liquidación en borrador",
          permission: "invoices:issue",
          steps: [
            "En [[/liquidaciones]], en la fila de la liquidación en {{Borrador}}, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá el período, las cargas marcadas o las notas. El cliente no se puede cambiar.",
            "Hacé clic en {{Guardar borrador}}.",
          ],
          errors: [
            {
              message: "Solo se edita una liquidación en borrador.",
              fix: "Una confirmada no se edita: cancelala y armá otra.",
            },
            {
              message:
                "El cliente de una liquidación no cambia: cancelala y armá otra.",
              fix: "Cancelá la liquidación y armá una nueva para el otro cliente.",
            },
          ],
          related: ["crear-liquidacion"],
          keywords: ["modificar liquidación", "sacar carga de liquidación"],
        },
        {
          id: "confirmar-liquidacion",
          title: "Confirmar una liquidación y emitir el Remito R (Ventas)",
          permission: "invoices:issue",
          prerequisites: [
            "Una liquidación en {{Borrador}} de un cliente de Ventas.",
          ],
          steps: [
            "En [[/liquidaciones]], en la fila de la liquidación, abrí el menú ⋯ y elegí {{Confirmar y emitir remito R}}.",
            "En el aviso {{Confirmar liquidación}}, hacé clic en {{Confirmar}}.",
          ],
          after: [
            "Se recalculan los precios, se le asigna el número de Remito R y la liquidación queda {{Confirmada}}: ya no se edita y el flete de sus cargas queda congelado.",
            "Desde el menú ⋯ aparecen {{Ver remito R (PDF)}} y {{Facturar}}. El remito se puede mandar por email ([[#enviar-remito-liquidacion]]).",
          ],
          errors: [
            {
              message: "La liquidación está cancelada.",
              fix: "No se puede confirmar: armá una nueva.",
            },
            {
              message: "La liquidación no tiene cargas.",
              fix: "Editala y elegí cargas.",
            },
            {
              message:
                "La carga … ya no tiene flete ni tarifa de flete vigente: cargá uno de los dos.",
              fix: "Cargale el flete a la carga o la tarifa al cliente, o sacala del borrador.",
            },
          ],
          related: ["facturar-liquidacion"],
          keywords: ["remito R", "confirmar liquidación"],
        },
        {
          id: "facturar-liquidacion",
          title: "Facturar una liquidación (Ventas)",
          summary:
            "Una sola factura A o B con una línea por carga e IVA 21%, vinculada al Remito R.",
          permission: "invoices:issue",
          prerequisites: [
            "La liquidación está {{Confirmada}}, con su Remito R ([[#confirmar-liquidacion]]).",
            "El cliente tiene CUIT y condición de IVA válida.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Facturar liquidación",
              description:
                "Una sola factura con una línea por carga, con IVA 21%, vinculada al Remito R.",
              fields: [
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve fiscal",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Punto de venta",
                  kind: "select",
                  value: "0003",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Facturar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/liquidaciones]], en la fila de la liquidación, abrí el menú ⋯ y elegí {{Facturar}}. El diálogo muestra el {{Documento}}, el cliente y el {{Neto}}.",
            "Elegí {{Canal}} (solo los fiscales) y {{Punto de venta}}.",
            "Hacé clic en {{Facturar}}.",
          ],
          after: [
            "Se crea la factura en [[/invoices]] con fecha de hoy y el período de la liquidación como período de servicio; va a AFIP por el CAE. La liquidación pasa a {{Facturada}} y sus cargas quedan como {{Facturado}}.",
            "Si AFIP rechaza la factura o se anula, la liquidación vuelve a {{Confirmada}} y se puede facturar de nuevo.",
          ],
          errors: [
            {
              message:
                "Confirmá la liquidación (Remito R) antes de facturarla.",
              fix: "Confirmala primero ([[#confirmar-liquidacion]]).",
            },
            {
              message:
                "Solo se factura una liquidación confirmada y sin factura.",
              fix: "Ya está facturada o cancelada: actualizá la pantalla.",
            },
            {
              message: "El cliente necesita un CUIT para facturar.",
              fix: "Cargale el CUIT en la ficha del cliente.",
            },
            {
              message: "La condición de IVA del cliente es inválida.",
              fix: "Corregila en la ficha del cliente.",
            },
            {
              message:
                "Hay cargas cargadas en otro canal: facturá la liquidación en el canal de sus cargas.",
              fix: "Elegí el canal de las cargas.",
            },
            {
              message: "La liquidación ya se facturó o se está facturando.",
              fix: "Otro usuario la está facturando: actualizá la pantalla.",
            },
            {
              message:
                "La factura se emitió pero no se vinculó a la liquidación. En unos minutos volvé a facturar: se vincula la misma factura, sin emitir otra.",
              fix: "Esperá unos minutos y volvé a {{Facturar}}.",
            },
            {
              message:
                "La liquidación se facturó demasiadas veces sin éxito: revisá sus comprobantes.",
              fix: "Revisá en [[/invoices]] las facturas fallidas del cliente antes de reintentar.",
            },
            {
              message: "No tenés permiso para facturar.",
              fix: "Pedíselo a alguien de Finanzas, Admin u Owner.",
            },
          ],
          related: ["confirmar-liquidacion", "cancelar-liquidacion"],
          keywords: ["facturar liquidación", "factura de fletes", "CAE"],
        },
        {
          id: "emitir-remito-interno-liquidacion",
          title: "Emitir el remito interno de una liquidación (Otras ventas)",
          permission: "invoices:issue",
          prerequisites: [
            "Una liquidación de un cliente de Otras ventas, en {{Borrador}} o {{Confirmada}} sin remito.",
          ],
          steps: [
            "En [[/liquidaciones]], en la fila de la liquidación, abrí el menú ⋯ y elegí {{Emitir remito interno}}.",
            "Elegí {{Canal}} (solo los internos) y {{Punto de venta}}.",
            "Hacé clic en {{Emitir remito interno}}.",
          ],
          after: [
            "Si estaba en borrador, se confirma (recalculando precios). Se emite un solo remito interno X con una línea por carga a precio final, y la liquidación pasa a {{Facturada}} con estado «remito interno».",
            "Desde el menú ⋯, {{Ver remito interno (PDF)}} abre el comprobante.",
          ],
          errors: [
            { message: "Elegí un canal.", fix: "Elegí el canal." },
            {
              message: "Elegí un punto de venta.",
              fix: "Elegí el punto de venta.",
            },
            {
              message: "La liquidación ya se facturó o se está facturando.",
              fix: "Actualizá la pantalla.",
            },
          ],
          related: ["crear-liquidacion"],
          keywords: ["remito interno", "remito X", "otras ventas"],
        },
        {
          id: "ver-liquidacion",
          title: "Ver una liquidación y su PDF",
          permission: "invoices:read",
          steps: [
            "En [[/liquidaciones]], en la fila de la liquidación, abrí el menú ⋯ y elegí {{Ver}}.",
            "En el detalle, {{Ver remito R}} (o {{Ver remito interno}}) abre el PDF; si tiene factura, «ver comprobante» lleva a la factura. {{Cerrar}} vuelve a la lista.",
          ],
          after: [
            "El detalle lista cada carga con su ruta, fecha, remito, origen del precio e importe, el total, las notas y el documento.",
          ],
          keywords: ["detalle liquidación", "PDF remito R"],
        },
        {
          id: "enviar-remito-liquidacion",
          title: "Enviar el remito de una liquidación por email",
          permission: ["email:send", "invoices:read"],
          prerequisites: [
            "La liquidación tiene su Remito R emitido (confirmada o facturada), o es de Otras ventas con su remito interno emitido.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Enviar remito por email",
              description:
                "El cliente recibirá el PDF del remito R de la liquidación adjunto.",
              fields: [
                {
                  label: "Destinatario",
                  value: "cliente@ejemplo.com",
                  wide: true,
                  marker: 2,
                },
                { label: "Asunto", wide: true, marker: 2 },
                { label: "Mensaje (opcional)", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Enviar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "Abrí la liquidación con {{Ver}} y hacé clic en {{Enviar remito por email}} (o {{Enviar remito interno por email}}).",
            "Revisá {{Destinatario}} y {{Asunto}}; el mensaje es opcional (vacío usa el texto por defecto).",
            "Hacé clic en {{Enviar}}.",
          ],
          after: [
            "El cliente recibe el PDF adjunto. La próxima vez, el diálogo muestra la fecha del último envío exitoso.",
          ],
          errors: [
            {
              message:
                "Solo se envía una liquidación con su remito R emitido (confirmada o facturada).",
              fix: "Confirmala primero.",
            },
            { message: "Email inválido.", fix: "Revisá la dirección." },
            {
              message: "No tenés permiso para enviar emails.",
              fix: "Pedíselo a alguien de Finanzas, Admin u Owner.",
            },
            { message: "No se pudo generar el PDF.", fix: "Volvé a intentar." },
          ],
          keywords: ["mandar remito", "email cliente", "enviar liquidación"],
        },
        {
          id: "cancelar-liquidacion",
          title: "Cancelar una liquidación",
          permission: "invoices:issue",
          prerequisites: [
            "Si está facturada: la factura tiene que estar anulada (interna) o acreditada por nota de crédito por el total (fiscal).",
          ],
          steps: [
            "En [[/liquidaciones]], en la fila de la liquidación, abrí el menú ⋯ y elegí {{Cancelar}}.",
            "En el aviso, hacé clic en {{Cancelar liquidación}}.",
          ],
          after: [
            "La liquidación queda {{Cancelada}} y sus cargas quedan libres para otra liquidación o para facturarse solas. Un Remito R queda cancelado con su número.",
          ],
          errors: [
            {
              message:
                "La liquidación está facturada: antes de cancelarla, anulá el remito si es interno, o emití una nota de crédito por el total si la factura es fiscal.",
              fix: "Anulá el remito interno o emití la nota de crédito por el total en [[/invoices]] y volvé a cancelar.",
            },
            {
              message:
                "La liquidación se está facturando: esperá a que termine y volvé a intentar.",
              fix: "Esperá unos minutos.",
            },
            {
              message:
                "La liquidación tiene una factura emitida sin vincular: volvé a facturarla para vincularla antes de cancelar.",
              fix: "Hacé clic en {{Facturar}} para que se vincule la factura ya emitida y después cancelá.",
            },
          ],
          related: ["facturar-liquidacion"],
          keywords: ["anular liquidación", "cancelar remito R"],
        },
      ],
    },

    // ── Rendiciones ──────────────────────────────────────────────────────
    {
      id: "flota-rendiciones",
      title: "Rendiciones de choferes",
      menuPath: "Flota › Rendiciones",
      routes: ["/rendiciones"],
      permission: "receipts:read",
      intro: [
        "La cobranza contra entrega: lo que cada chofer cobró al entregar y lo que entregó después. Arriba, {{Pendientes por chofer}} muestra por chofer las {{Cargas por rendir}}, el monto {{A rendir}} y los {{Borradores}} abiertos. Abajo, la lista de {{Rendiciones}} con {{Número}}, {{Chofer}}, {{Fecha}}, {{Estado}}, {{Entregado}} y {{Diferencia}} (y a cargo de quién quedó). {{Cargar más}} trae las anteriores.",
        "Una carga está por rendir cuando tiene {{Cobranza contra entrega}}, está {{Entregada}} y no está en otra rendición viva. Sale con el chofer del viaje de la carga; las cargas sin viaje o con un viaje sin chofer aparecen como «Sin chofer» y no se pueden rendir hasta asignarles el viaje.",
      ],
      screens: [
        {
          kind: "page",
          title: "Rendiciones",
          table: {
            columns: ["Chofer", "Cargas por rendir", "A rendir", "Borradores"],
            rows: [["~Juan Pérez", "~3", "~$420.000", "~0"]],
          },
        },
      ],
      concepts: [
        {
          title: "Estados y recibos",
          body: [
            "{{Borrador}} (sin número) → {{Confirmada}} (con número `N° 12`) → {{Cancelada}}.",
            "Al confirmar se emiten los recibos de cobranza, uno por cliente (y canal), con lo que entregó el chofer en cada cuenta: entran a caja, bancos o cartera de cheques y se aplican a la factura de cada carga hasta su saldo; el resto queda a cuenta del cliente.",
            "Si después alguien anula o edita uno de esos recibos en Recibos, el estado agrega «recibos anulados» o «recibos cambiados en Recibos»: si se anularon todos, cancelá la rendición; si se editó uno, revisalo.",
          ],
        },
        {
          title: "La diferencia",
          body: [
            "{{Diferencia}} = {{Entregado}} − {{A cobrar}}. Negativa es un faltante (el chofer entregó de menos); positiva, un sobrante.",
            "Una rendición confirmada con diferencia se resuelve con {{Resolver diferencia}}: queda {{A cargo del chofer}} o {{A cargo del cliente}}, nunca de los dos.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-rendicion",
          title: "Registrar la rendición de un chofer",
          permission: "receipts:write",
          prerequisites: [
            "Cargas contra entrega entregadas, en un viaje con ese chofer ([[#asignar-cargas-viaje]], [[#cambiar-estado-carga]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Nueva rendición · Juan Pérez",
              description:
                "Lo que el chofer entrega por las cargas contra entrega, con uno o varios medios de pago por carga. Al confirmarla se emiten los recibos.",
              fields: [
                {
                  label: "Fecha",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 2,
                },
                {
                  label:
                    "~Ferretería Norte S.A. · 03/11/2026 · Remito 0001-123 — $180.000",
                  kind: "checkbox",
                  value: "sí",
                  wide: true,
                  marker: 3,
                },
                {
                  label: "~Caja pesos",
                  kind: "select",
                  value: "Caja pesos",
                  marker: 3,
                },
                {
                  label: "~Importe del pago 1",
                  kind: "money",
                  value: "180.000,00",
                  marker: 3,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Guardar borrador", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/rendiciones]], en {{Pendientes por chofer}}, hacé clic en {{Rendir}} en la fila del chofer.",
            "En {{Fecha}}, elegí la fecha de la rendición (hoy por defecto).",
            {
              text: "Revisá cada carga. Vienen todas marcadas, cobradas por el total en la cuenta de efectivo:",
              substeps: [
                "Desmarcá la carga si el chofer no la rinde ahora.",
                "Elegí la cuenta (caja, banco o cheques en pesos) y el importe que entregó. `0 = no cobró`: una carga marcada sin importe registra que no entregó nada.",
                "{{Otro medio de pago}} agrega otra línea (hasta 10 por carga), con lo que falta como importe sugerido.",
                "En una cuenta de cheques, completá {{N° de cheque}}, la fecha de pago y {{Banco}}.",
                "Si hay diferencia, en {{Motivo de la diferencia}} anotá por qué.",
              ],
            },
            "Mirá el resumen: {{A cobrar}}, {{Entregado}} y {{Diferencia}}.",
            "Hacé clic en {{Guardar borrador}}.",
          ],
          after: [
            "La rendición queda en {{Borrador}} y sus cargas quedan reservadas: no cambian cobranza, cliente, viaje ni estado, y el chofer del viaje no se puede cambiar.",
            "Todavía no se emitió ningún recibo: eso pasa al confirmar ([[#confirmar-rendicion]]).",
          ],
          errors: [
            {
              message: "Elegí al menos una carga.",
              fix: "Marcá al menos una carga.",
            },
            {
              message: "Elegí la cuenta de ….",
              fix: "Elegí la cuenta de cada pago.",
            },
            {
              message: "El cheque de … necesita número, banco y fecha de pago.",
              fix: "Completá los datos del cheque.",
            },
            {
              message:
                "La rendición se asienta en pesos: elegí una cuenta en ARS.",
              fix: "Elegí una cuenta en pesos.",
            },
            {
              message: "La carga … no viajó con este chofer.",
              fix: "Revisá el viaje de la carga en [[/trips]].",
            },
            {
              message:
                "La carga … no está entregada: se rinde lo cobrado al entregar.",
              fix: "Marcala como entregada en [[/cargas]].",
            },
            {
              message: "La carga … no tiene cliente: el recibo necesita uno.",
              fix: "Asignale el cliente a la carga.",
            },
            {
              message: "No tenés permiso para registrar rendiciones.",
              fix: "Pedíselo a alguien de Finanzas, Admin u Owner.",
            },
          ],
          related: ["confirmar-rendicion", "editar-rendicion"],
          keywords: [
            "rendición",
            "contra entrega",
            "cobranza chofer",
            "rendir",
            "lo que cobró el chofer",
          ],
        },
        {
          id: "editar-rendicion",
          title: "Editar una rendición en borrador",
          permission: "receipts:write",
          steps: [
            "En [[/rendiciones]], en la fila de la rendición en {{Borrador}}, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá las cargas incluidas, las cuentas, los importes o las notas. También aparecen las cargas nuevas por rendir del chofer, sin marcar.",
            "Hacé clic en {{Guardar borrador}}.",
          ],
          errors: [
            {
              message: "Solo se edita una rendición en borrador.",
              fix: "Una confirmada no se edita: cancelala (con sus recibos anulados) y armá otra.",
            },
          ],
          related: ["crear-rendicion"],
        },
        {
          id: "confirmar-rendicion",
          title: "Confirmar una rendición y emitir los recibos",
          permission: "receipts:write",
          steps: [
            "En [[/rendiciones]], en la fila de la rendición en {{Borrador}}, abrí el menú ⋯ y elegí {{Confirmar}}.",
            "En el aviso {{Confirmar rendición}}, hacé clic en {{Confirmar}}.",
          ],
          after: [
            "La rendición toma su número y queda {{Confirmada}}: ya no se edita.",
            "Se emite un recibo por cliente (y canal) con lo que entregó el chofer; el dinero entra en las cuentas elegidas y los cheques a cartera. Cada recibo se aplica a la factura de la carga hasta su saldo; lo demás queda a cuenta del cliente. Los recibos se ven en el detalle y en [[/receipts]].",
            "Aparece {{PDF}} en el menú ⋯. Si hay diferencia, queda por resolver ([[#resolver-diferencia-rendicion]]).",
          ],
          errors: [
            {
              message:
                "La carga … ya no es contra entrega: sacala de la rendición.",
              fix: "Editá el borrador y desmarcá esa carga.",
            },
            {
              message: "La rendición no tiene cargas.",
              fix: "Editala y elegí cargas.",
            },
            {
              message: "No hay un canal activo para el recibo del cliente.",
              fix: "Pedile a un administrador que revise los canales de facturación.",
            },
            {
              message:
                "El canal … no tiene un punto de venta habilitado para recibos.",
              fix: "Habilitá un punto de venta del canal en [[/admin/afip/puntos-de-venta]].",
            },
            { message: "La rendición está cancelada.", fix: "Armá una nueva." },
          ],
          related: ["resolver-diferencia-rendicion", "cancelar-rendicion"],
          keywords: ["confirmar rendición", "recibos chofer"],
        },
        {
          id: "resolver-diferencia-rendicion",
          title: "Resolver la diferencia de una rendición",
          summary:
            "Decidir si el faltante o el sobrante queda a cargo del chofer o del cliente.",
          permission: "receipts:write",
          prerequisites: [
            "Una rendición {{Confirmada}} con diferencia, sin resolver y con sus recibos sin cambios.",
            "Para {{A cargo del chofer}} hace falta además permiso de escritura en RRHH y en movimientos (`hr:write` y `transactions:write`), y que el chofer esté vinculado a un empleado.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Resolver diferencia",
              description:
                "~Juan Pérez entregó de menos $20.000. Elegí quién la debe: queda en una sola cuenta.",
              fields: [
                {
                  label: "A cargo del chofer",
                  kind: "checkbox",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "A cargo del cliente",
                  kind: "checkbox",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Volver", variant: "outline" },
                { label: "Confirmar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/rendiciones]], en la fila de la rendición, abrí el menú ⋯ y elegí {{Resolver diferencia}}.",
            {
              text: "Elegí a cargo de quién queda:",
              substeps: [
                "{{A cargo del chofer}} (solo para un faltante): se emite un recibo que salda el faltante en la cuenta del cliente y se carga como adelanto en la cuenta corriente del chofer, pagado desde la cuenta de efectivo. Solo los choferes propios (empleados) tienen cuenta corriente: con un chofer contratado la opción no se puede elegir.",
                "{{A cargo del cliente}}: el faltante queda abierto en la cuenta del cliente, o el sobrante queda a cuenta del cliente. No se toca la cuenta corriente del chofer.",
              ],
            },
            "Hacé clic en {{Confirmar}}.",
          ],
          after: [
            "La columna {{Diferencia}} indica a cargo de quién quedó. Con el chofer, el adelanto aparece en su cuenta corriente de empleado y se descuenta como cualquier adelanto.",
            "El recibo que salda el faltante no se anula desde Recibos: se anula quitando la diferencia ([[#quitar-diferencia-rendicion]]).",
          ],
          errors: [
            {
              message:
                "No tenés permiso para asentar en la cuenta corriente del chofer y mover la caja.",
              fix: "Pedíselo a alguien con permisos de RRHH y movimientos, o dejala a cargo del cliente.",
            },
            {
              message:
                "El chofer … no está vinculado a un empleado: vinculalo en Flota › Choferes.",
              fix: "Un chofer contratado sin legajo no tiene cuenta corriente: dejala a cargo del cliente.",
            },
            {
              message:
                "Un recibo de la rendición se anuló o se editó en Recibos: revisala antes de asentar la diferencia.",
              fix: "Revisá los recibos; si se anularon todos, cancelá la rendición.",
            },
            {
              message:
                "La rendición tiene cargas con faltante y otras con sobrante: dejá la diferencia a cargo del cliente o corregí lo entregado.",
              fix: "Elegí {{A cargo del cliente}}.",
            },
            {
              message:
                "El faltante es de cargas de distintos canales: dejá la diferencia a cargo del cliente.",
              fix: "Elegí {{A cargo del cliente}}.",
            },
            {
              message:
                "No hay una cuenta de efectivo en pesos activa para registrar el faltante.",
              fix: "Activá o creá una caja en pesos en [[/accounts]].",
            },
            {
              message:
                "El sobrante quedó a cuenta del cliente en el recibo de la rendición: dejalo a cargo del cliente, o anulá el recibo, cancelá la rendición y cargá lo que cobró el chofer.",
              fix: "Elegí {{A cargo del cliente}}.",
            },
            {
              message:
                "La diferencia ya quedó a cargo del …: quitala antes de cambiarla.",
              fix: "Quitá la diferencia primero ([[#quitar-diferencia-rendicion]]).",
            },
          ],
          related: ["quitar-diferencia-rendicion"],
          keywords: [
            "faltante",
            "sobrante",
            "diferencia chofer",
            "descontar al chofer",
          ],
        },
        {
          id: "quitar-diferencia-rendicion",
          title: "Quitar la diferencia resuelta",
          permission: "receipts:write",
          prerequisites: [
            "Si la diferencia quedó en la cuenta corriente del chofer, hace falta además permiso de escritura en RRHH y en movimientos: sin él, el ítem aparece deshabilitado.",
          ],
          steps: [
            "En [[/rendiciones]], en la fila de la rendición, abrí el menú ⋯ y elegí {{Quitar diferencia}}.",
            "Confirmá con {{Quitar}}.",
          ],
          after: [
            "A cargo del cliente: la diferencia vuelve a quedar sin resolver. A cargo del chofer: se borra el movimiento de su cuenta corriente, se anula el recibo que saldó al cliente, y la diferencia vuelve a quedar sin resolver.",
          ],
          errors: [
            {
              message:
                "La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH y en movimientos.",
              fix: "Pedíselo a alguien con esos permisos.",
            },
          ],
          related: ["resolver-diferencia-rendicion"],
        },
        {
          id: "ver-rendicion",
          title: "Ver una rendición y su PDF",
          permission: "receipts:read",
          steps: [
            "En [[/rendiciones]], en la fila, abrí el menú ⋯ y elegí {{Ver}}.",
            "En una rendición confirmada, {{PDF}} abre el comprobante de la rendición.",
          ],
          after: [
            "El detalle muestra por carga lo cobrado contra lo esperado, cada medio de pago (cuenta, importe, cheque), la diferencia, los recibos emitidos (con enlace) y a cargo de quién quedó la diferencia.",
          ],
          keywords: ["detalle rendición", "PDF rendición"],
        },
        {
          id: "cancelar-rendicion",
          title: "Cancelar una rendición",
          permission: "receipts:write",
          prerequisites: [
            "Si está confirmada: sus recibos tienen que estar anulados en [[/receipts]] antes.",
            "Si la diferencia quedó en la cuenta corriente del chofer: permiso de escritura en RRHH y en movimientos.",
          ],
          steps: [
            "En [[/rendiciones]], en la fila de la rendición, abrí el menú ⋯ y elegí {{Cancelar}}.",
            "Confirmá con {{Cancelar rendición}}.",
          ],
          after: [
            "La rendición queda {{Cancelada}} y sus cargas vuelven a quedar por rendir. Si la diferencia estaba a cargo del chofer, sale de su cuenta corriente y se anula el recibo que saldó al cliente.",
          ],
          errors: [
            {
              message:
                "La rendición tiene recibos vigentes: anulalos antes de cancelarla.",
              fix: "Anulá los recibos de la rendición en [[/receipts]] y volvé a cancelar.",
            },
            {
              message:
                "La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH y en movimientos.",
              fix: "Pedíselo a alguien con esos permisos.",
            },
          ],
          related: ["crear-rendicion"],
          keywords: ["anular rendición"],
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
        "Cada carga cuenta como costo de su vehículo (y del viaje, si se le asigna) en [[/fleet-reports]]. Si no tiene factura de compra ni movimiento de pago vinculado, figura en «Costos sin comprobante»: no llega a la contabilidad.",
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
          after: [
            "La carga suma al costo de combustible del vehículo en [[/fleet-reports]]. Si quedó sin factura ni movimiento, figura en «Costos sin comprobante».",
          ],
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

    // ── Km mensual ───────────────────────────────────────────────────────
    {
      id: "flota-km-mensual",
      title: "Km mensual",
      menuPath: "Flota › Km mensual",
      routes: ["/vehicle-km"],
      permission: "fleet_km:read",
      intro: [
        "La lectura del odómetro de cada vehículo, una vez por mes. Arriba se elige el mes (por defecto, el actual; no se puede ir a un mes futuro) y se ve cuántos vehículos faltan. La tabla muestra {{Vehículo}}, {{Lectura anterior}} (con su mes), {{Km del mes}} (con la fecha de lectura) y {{Recorrido}}.",
        "Llevan km los vehículos activos que no son acoplado ni semi. Tareas lo recuerda: el día 1 se abre la tarea del mes en [[/tasks]], que vence el día 5; la revisión diaria de tareas (a la mañana) la cierra cuando están todos los km.",
      ],
      screens: [
        {
          kind: "page",
          title: "Km mensual",
          toolbar: [{ label: "~noviembre de 2026", kind: "input" }],
          table: {
            columns: [
              "Vehículo",
              "Lectura anterior",
              "Km del mes",
              "Recorrido",
            ],
            rows: [
              [
                "~AB123CD Chasis 1",
                "~412.300 (oct 2026)",
                "~421.850 05/11/2026",
                "~9.550",
              ],
              ["~AC789GH", "~198.000 (oct 2026)", "~Cargar", "~—"],
            ],
            rowMenu: true,
          },
        },
      ],
      tasks: [
        {
          id: "cargar-km-mensual",
          title: "Cargar el km del mes de un vehículo",
          permission: "fleet_km:write",
          screens: [
            {
              kind: "dialog",
              title: "~Km de AB123CD · noviembre de 2026",
              description: "~Lectura anterior: 412.300 km (octubre de 2026).",
              fields: [
                { label: "Km del odómetro", value: "421850", marker: 2 },
                {
                  label: "Fecha de lectura",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 2,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/vehicle-km]], elegí el mes y hacé clic en {{Cargar}} en la fila del vehículo.",
            "Escribí {{Km del odómetro}} (hasta un decimal) y la {{Fecha de lectura}} (hoy por defecto, no futura). Si es menos que la lectura anterior, aparece un aviso: revisalo y, si se cambió el odómetro, anotalo en {{Notas}}.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "La fila muestra el km y el {{Recorrido}} contra la lectura anterior; si bajó, se marca «(bajó)». Cuando todos los vehículos tienen su km, la tarea del mes se cierra sola en la revisión de la mañana siguiente.",
          ],
          errors: [
            {
              message: "Ingresá los km (hasta un decimal).",
              fix: "Escribí solo números, con un decimal como máximo.",
            },
            {
              message: "No se puede cargar el km de un mes futuro.",
              fix: "Elegí el mes actual o uno anterior.",
            },
            {
              message: "La fecha de lectura no puede ser futura.",
              fix: "Poné la fecha en que leíste el odómetro.",
            },
            {
              message: "No tenés permiso para cargar km.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
            },
          ],
          related: ["editar-km-mensual"],
          keywords: [
            "kilometraje",
            "odómetro",
            "km camión",
            "cuentakilómetros",
          ],
        },
        {
          id: "editar-km-mensual",
          title: "Corregir o borrar el km de un mes",
          permission: "fleet_km:write",
          steps: [
            "En [[/vehicle-km]], elegí el mes; en la fila del vehículo, abrí el menú ⋯.",
            "Elegí {{Editar}} para corregir la lectura y guardá, o {{Borrar}} y confirmá con {{Borrar}} para eliminarla.",
          ],
          after: [
            "Al borrar, el vehículo vuelve a figurar como faltante en ese mes.",
          ],
          errors: [
            {
              message: "La lectura ya no existe.",
              fix: "Actualizá la pantalla.",
            },
            {
              message: "No tenés permiso para borrar km.",
              fix: "Pedíselo a alguien con el rol Operaciones, Admin u Owner.",
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
        "El costo cuenta en la rentabilidad del vehículo ([[/fleet-reports]]). Un mantenimiento sin costo cargado no suma; uno sin factura de compra ni movimiento vinculado figura en «Costos sin comprobante».",
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
            "El costo suma al mantenimiento del vehículo en [[/fleet-reports]]. {{Próx. service}} queda a la vista en la lista.",
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

    // ── Rentabilidad ─────────────────────────────────────────────────────
    {
      id: "flota-rentabilidad",
      title: "Rentabilidad de flota",
      menuPath: "Flota › Rentabilidad",
      routes: ["/fleet-reports"],
      permission: ["trips:read", "shipments:read"],
      intro: [
        "Ingresos menos costos (viaje, combustible, mantenimiento) por vehículo y por viaje, en un rango de fechas. Arriba se ven el total {{Facturado}}, el {{Manual}} y el neto del rango.",
        "Tres bloques: {{Por vehículo}} ({{Viajes}}, {{Ingresos}}, {{Facturado}}, {{Manual}}, {{Combustible}}, {{Mant.}}, {{Costo viaje}}, {{Neto}}, con una fila {{Sin vehículo}} para los viajes sin vehículo), {{Costos sin comprobante}} (combustible y mantenimiento sin factura ni movimiento vinculado) y {{Por viaje}}.",
      ],
      screens: [
        {
          kind: "page",
          title: "Rentabilidad de flota",
          toolbar: [
            { label: "Desde", kind: "date", value: "01/11/2026" },
            { label: "Hasta", kind: "date", value: "05/11/2026" },
          ],
          table: {
            columns: [
              "Vehículo",
              "Viajes",
              "Ingresos",
              "Facturado",
              "Manual",
              "Combustible",
              "Mant.",
              "Costo viaje",
              "Neto",
            ],
            rows: [
              [
                "~AB123CD",
                "~4",
                "~$1.800.000",
                "~$1.800.000",
                "~$0",
                "~$620.000",
                "~$280.000",
                "~$150.000",
                "~$750.000",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Cómo se calcula",
          body: [
            "**Ingreso de un viaje:** si tiene cargas, el flete facturado de esas cargas ({{Facturado}}); si no tiene cargas, el {{Ingreso manual}} del viaje ({{Manual}}).",
            "**Neto de un viaje** = ingreso − costo del viaje − combustible asignado a ese viaje.",
            "**Neto de un vehículo** = ingresos de sus viajes − costo de sus viajes − todo su combustible − todo su mantenimiento del rango.",
            "Un viaje con cargas todavía sin facturar muestra el neto con la nota {{pendiente de facturar}}: ese flete no está en los ingresos y el neto no es definitivo. Arriba se resume cuántos viajes y cargas están en esa situación.",
            "Un mantenimiento sin costo cargado no está en {{Mant.}} ni en el neto; abajo de la tabla se avisa cuántos hay.",
          ],
        },
      ],
      tasks: [
        {
          id: "ver-rentabilidad-flota",
          title: "Ver la rentabilidad de un período",
          permission: ["trips:read", "shipments:read"],
          steps: [
            "Abrí [[/fleet-reports]]. Por defecto muestra desde el 1° del mes hasta hoy.",
            "Cambiá {{Desde}} y {{Hasta}}: las tablas se recalculan solas.",
          ],
          after: [
            "Para bajar los costos sin comprobante, vinculá la factura de compra o el movimiento en cada carga de combustible ([[#editar-carga-combustible]]) o mantenimiento ([[#editar-mantenimiento]]).",
          ],
          errors: [
            {
              message: "No tenés permiso para ver la rentabilidad.",
              fix: "Hace falta poder ver viajes y cargas.",
            },
            {
              message: "No se pudo cargar la rentabilidad de flota.",
              fix: "Hacé clic en {{Reintentar}}.",
            },
          ],
          keywords: [
            "margen",
            "ganancia por camión",
            "rentabilidad",
            "costo por viaje",
          ],
        },
      ],
    },
  ],
};
