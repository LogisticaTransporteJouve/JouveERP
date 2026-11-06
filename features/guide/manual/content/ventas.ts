import { attachmentPermission } from "./attachment-permissions";

import type { GuidePage } from "../types";

// Sales chapter: clients (list, ficha, cuenta corriente, opening balance,
// tariffs, attachments), comprobantes (fiscal with CAE, remitos internos,
// NC/ND, cancel, bill a remito), receipts, aging and late interest. The
// sidebar opens these same pages from "Ventas" (fiscal) and "Otras ventas"
// (internal); the first section explains the split.

export const salesPage: GuidePage = {
  file: "ventas.html",
  title: "Ventas",
  lead: "Clientes, comprobantes, recibos, aging y mora: cómo se factura con CAE de AFIP, cómo se cargan los remitos internos y cómo se cobra.",
  sections: [
    // ── Ventas / Otras ventas ──────────────────────────────────────────────
    {
      id: "ventas-y-otras-ventas",
      title: "Ventas y Otras ventas",
      menuPath: "Ventas / Otras ventas",
      routes: [],
      permission: null,
      intro: [
        "En la barra lateral hay dos secciones con las mismas cuatro pantallas: {{Ventas}} ({{Clientes}}, {{Comprobantes}}, {{Recibos}}, {{Aging clientes}}) y {{Otras ventas}} ({{Clientes}}, {{Remitos internos}}, {{Recibos internos}}, {{Aging clientes}}). Son las mismas páginas: lo que cambia es el lado que muestran.",
        "Al abrir una pantalla desde {{Ventas}} el sistema queda del lado fiscal; desde {{Otras ventas}}, del lado interno. Cada lista, cada formulario nuevo y cada exportación usan ese lado.",
      ],
      concepts: [
        {
          title: "Lado fiscal (Ventas)",
          body: [
            "Los clientes tienen CUIT y condición frente al IVA, que se traen del padrón de AFIP.",
            "Los comprobantes son facturas A o B, notas de crédito y notas de débito: se emiten con CAE de AFIP, llevan IVA, generan su asiento contable y entran en el Libro IVA Ventas. Una vez emitidos no se modifican ni se anulan: se corrigen con una nota de crédito o de débito.",
            "Los recibos pueden llevar retenciones y percepciones sufridas.",
          ],
        },
        {
          title: "Lado interno (Otras ventas)",
          body: [
            "Los clientes no tienen CUIT ni condición de IVA: solo un nombre, contacto y notas.",
            "Los comprobantes son remitos internos: no van a AFIP ni llevan IVA (el precio es final), se numeran en el sistema, su PDF dice «Documento no fiscal» y no generan asiento contable. Un remito interno sí se puede anular, y también se puede facturar en Ventas (ver [[#facturar-remito-interno]]).",
            "Los recibos se llaman recibos internos y solo cancelan remitos internos.",
          ],
        },
        {
          title: "Un cliente vive en un solo lado",
          body: [
            "Un cliente creado desde {{Ventas}} es de Ventas, y uno creado desde {{Otras ventas}} es de Otras ventas; el lado no se cambia después. Un comprobante o un recibo solo se puede hacer a un cliente de su mismo lado.",
            "La ficha de un cliente siempre muestra su lado, sin importar desde qué menú llegaste.",
            "El contador externo solo ve {{Ventas}}: la sección {{Otras ventas}} no le aparece.",
          ],
        },
      ],
      tasks: [],
    },

    // ── Clientes (lista) ───────────────────────────────────────────────────
    {
      id: "clientes",
      title: "Clientes",
      menuPath: "Ventas › Clientes / Otras ventas › Clientes",
      routes: ["/clients"],
      permission: "clients:read",
      intro: [
        "Lista de los clientes del lado elegido. En Ventas muestra {{Razón social}}, {{CUIT}}, {{Condición IVA}}, {{Estado}} y {{Actualizado}}; en Otras ventas, {{Nombre}}, {{Estado}} y {{Actualizado}}. El nombre abre la ficha del cliente ([[/clients/[id]]]).",
        "La búsqueda filtra por razón social, nombre fantasía o CUIT (en Otras ventas, por nombre o nombre fantasía). Con {{Solo activos}} tildado (así arranca) se ocultan los clientes desactivados. {{Limpiar}} vuelve a los filtros de inicio. La lista carga más filas al bajar.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Ventas › Clientes",
          title: "Clientes",
          subtitle: "Clientes de Ventas: con CUIT y condición de IVA (AFIP).",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo cliente", variant: "primary" },
          ],
          toolbar: [
            {
              label: "Buscar por razón social, nombre fantasía o CUIT",
              kind: "input",
            },
            { label: "Solo activos", kind: "checkbox", value: "sí" },
          ],
          table: {
            columns: [
              "Razón social",
              "CUIT",
              "Condición IVA",
              "Estado",
              "Actualizado",
              "Acciones",
            ],
            rows: [
              [
                "~Transportes del Sur S.A.",
                "~30714637432",
                "~Responsable Inscripto",
                "~Activo",
                "~03/11/2026",
                "~✎ 🗑",
              ],
              [
                "~Pérez Juan",
                "~20123456786",
                "~Monotributo",
                "~Activo",
                "~28/10/2026",
                "~✎ 🗑",
              ],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "crear-cliente",
          title: "Crear un cliente",
          summary:
            "En Ventas los datos fiscales se traen del padrón de AFIP con el CUIT; en Otras ventas solo se escribe el nombre.",
          permission: "clients:write",
          prerequisites: [
            "En Ventas, para traer los datos de AFIP hace falta además el permiso `padron:lookup` (lo tienen Owner, Admin y Finanzas). La razón social y la condición de IVA no se escriben a mano: sin verificar el CUIT no se puede crear un cliente de Ventas.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Ventas › Clientes › Nuevo cliente",
              title: "Nuevo cliente",
              description:
                "Ingresá el CUIT y verificá AFIP para autocompletar los datos.",
              fields: [
                {
                  label: "CUIT",
                  kind: "input",
                  value: "30-71463743-2",
                  marker: 2,
                },
                { label: "Razón social", kind: "input", value: "(de AFIP)" },
                { label: "Nombre fantasía", kind: "input", marker: 4 },
                {
                  label: "Condición frente al IVA",
                  kind: "select",
                  value: "Responsable Inscripto",
                },
                { label: "Email", kind: "input", marker: 4 },
                { label: "Teléfono", kind: "input" },
                {
                  label: "Domicilio fiscal (AFIP)",
                  kind: "input",
                  wide: true,
                },
                { label: "Domicilio real", kind: "input", wide: true },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Crear cliente", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "Abrí [[/clients]] desde {{Ventas}} (cliente con CUIT) o desde {{Otras ventas}} (cliente interno) y hacé clic en {{Nuevo cliente}}.",
            {
              text: "En Ventas: escribí el {{CUIT}} (con o sin guiones) y hacé clic en {{Verificar AFIP}}.",
              substeps: [
                "Se completan solos {{Razón social}}, {{Condición frente al IVA}} y {{Domicilio fiscal (AFIP)}}; esos campos no se editan a mano.",
                "Si ya hay un cliente con ese CUIT, el sistema avisa «Ya existe un cliente con ese CUIT.» y muestra un enlace a su ficha: usá ese en lugar de crear otro.",
                "Si el CUIT ya se consultó en las últimas 24 horas, o si AFIP no responde y hay una consulta anterior, se usan los datos guardados: el aviso dice «Cargado desde caché» y, cuando AFIP no respondió, agrega «(datos viejos)».",
              ],
            },
            "En Otras ventas no hay CUIT ni AFIP: escribí el {{Nombre}} (mínimo 2 caracteres).",
            {
              text: "Completá lo opcional:",
              substeps: [
                "{{Nombre fantasía}}: cómo lo conocen; también sirve para buscarlo.",
                "{{Email}}: se propone como destinatario al enviar comprobantes y recibos por email.",
                "{{Teléfono}}.",
                "{{Domicilio real}} (en Otras ventas, {{Domicilio}}): solo si difiere del fiscal.",
                "{{Notas}}.",
              ],
            },
            "Hacé clic en {{Crear cliente}}.",
          ],
          after: [
            "El aviso dice «Cliente creado.», el diálogo se cierra y el cliente queda activo en la lista. Creado desde {{Nuevo}} en el formulario de un comprobante o un recibo, queda elegido en ese formulario.",
            "Queda registrado en el historial de auditoría.",
          ],
          errors: [
            {
              message:
                "CUIT inválido — debe tener 11 dígitos y empezar con 2 o 3.",
              fix: "Revisá el CUIT: 11 números que empiezan con 20, 23, 24, 27, 30, 33 o 34.",
            },
            {
              message: "CUIT inválido (dígito verificador incorrecto).",
              fix: "Hay un número mal tipeado: compará el CUIT con la constancia del cliente.",
            },
            {
              message: "El CUIT … no existe en el padrón de AFIP.",
              fix: "Revisá el número con el cliente: AFIP no lo encuentra.",
            },
            {
              message: "AFIP no emite constancia para el CUIT …: …",
              fix: "AFIP no da la constancia (por ejemplo, el CUIT no tiene impuestos activos). Pedile al cliente que regularice su situación en AFIP.",
            },
            {
              message:
                "El padrón de AFIP no respondió (HTTP …). Probá de nuevo en un rato.",
              fix: "AFIP está caído o lento: esperá unos minutos y volvé a hacer clic en «Verificar AFIP».",
            },
            {
              message: "No tenés permiso para consultar el padrón.",
              fix: "Pedile a un usuario de Finanzas, Admin u Owner que cree el cliente.",
            },
            {
              message: "Ya existe un cliente con ese CUIT.",
              fix: "Buscalo en la lista (destildá «Solo activos» si no aparece: puede estar desactivado).",
            },
            {
              message: "Razón social requerida.",
              fix: "Verificá el CUIT con AFIP para que se complete la razón social.",
            },
            {
              message: "Nombre requerido.",
              fix: "Escribí un nombre de al menos 2 caracteres.",
            },
            {
              message: "Email inválido.",
              fix: "Escribí un email completo (nombre@dominio.com) o dejalo vacío.",
            },
            {
              message: "No tenés permiso para crear clientes.",
              fix: "Pedile el alta a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["editar-cliente", "ventas-y-otras-ventas"],
          keywords: [
            "alta de cliente",
            "nuevo cliente",
            "padrón",
            "CUIT",
            "verificar AFIP",
            "constancia",
          ],
        },
        {
          id: "editar-cliente",
          title: "Editar los datos de un cliente",
          permission: "clients:write",
          steps: [
            "En [[/clients]], en la fila del cliente, hacé clic en el lápiz ({{Editar}}). También podés abrir la ficha del cliente y entrar a la pestaña {{Datos}}.",
            {
              text: "Cambiá lo que haga falta:",
              substeps: [
                "En Ventas se pueden cambiar {{Nombre fantasía}}, {{Email}}, {{Teléfono}}, {{Domicilio real}} y {{Notas}}. El {{CUIT}}, la {{Razón social}}, la {{Condición frente al IVA}} y el {{Domicilio fiscal (AFIP)}} quedan fijos.",
                "En Otras ventas también se puede cambiar el {{Nombre}}.",
              ],
            },
            "Hacé clic en {{Guardar cambios}} (se habilita cuando cambiaste algo).",
          ],
          after: [
            "Los comprobantes ya emitidos no cambian: conservan los datos del cliente con que se emitieron.",
          ],
          errors: [
            {
              message: "Email inválido.",
              fix: "Escribí un email completo o dejalo vacío.",
            },
            {
              message: "No tenés permiso para editar clientes.",
              fix: "Pedile el cambio a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["crear-cliente"],
          keywords: ["modificar cliente", "cambiar email", "datos del cliente"],
        },
        {
          id: "eliminar-cliente",
          title: "Eliminar, desactivar o reactivar un cliente",
          summary:
            "Un cliente con movimientos no se borra: se desactiva para que deje de aparecer en las listas, y se puede reactivar después.",
          permission: "clients:write",
          screens: [
            {
              kind: "dialog",
              caption: "Clientes › tacho de la fila",
              title: "Eliminar cliente",
              description: "Transportes del Sur S.A. · CUIT 30714637432",
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Desactivar", variant: "outline", marker: 3 },
                { label: "Eliminar", variant: "destructive", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/clients]], en la fila del cliente, hacé clic en el tacho ({{Eliminar}}).",
            "El sistema revisa si el cliente tiene movimientos asociados (comprobantes, recibos, etc.) y los lista.",
            {
              text: "Elegí:",
              substeps: [
                "Si tiene movimientos, solo se ofrece {{Desactivar}}: queda guardado pero deja de aparecer en las listas activas.",
                "Si no tiene movimientos, podés {{Desactivar}} o {{Eliminar}} definitivamente (no se puede deshacer).",
              ],
            },
          ],
          after: [
            "Un cliente desactivado solo aparece en [[/clients]] destildando {{Solo activos}}, y no se le pueden emitir comprobantes. Para volver a usarlo, hacé clic en {{Reactivar}} (el ícono de encendido) en su fila: aviso «Cliente reactivado.».",
          ],
          errors: [
            {
              message:
                "El cliente tiene movimientos asociados. Desactivalo en lugar de eliminarlo.",
              fix: "Usá «Desactivar».",
            },
            {
              message: "No se pudo verificar si tiene movimientos asociados.",
              fix: "Hacé clic en reintentar dentro del diálogo; si sigue, recargá la página.",
            },
            {
              message: "No tenés permiso para eliminar clientes.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          keywords: [
            "borrar cliente",
            "dar de baja",
            "inactivo",
            "reactivar cliente",
          ],
        },
        {
          id: "exportar-clientes",
          title: "Exportar la lista de clientes",
          permission: "clients:read",
          steps: [
            "En [[/clients]], hacé clic en {{Exportar}}.",
            "Elegí el formato: {{PDF}} o {{Excel}}.",
            "Hacé clic en {{Todo el historial}}, o elegí {{Desde}} y {{Hasta}} y hacé clic en {{Descargar período}}.",
          ],
          after: [
            "El PDF se abre en otra pestaña; el Excel se descarga. Exporta los clientes del lado en que estás (Ventas u Otras ventas); el rango de fechas filtra por la fecha de alta del cliente.",
          ],
          keywords: ["excel", "listado de clientes", "descargar"],
        },
      ],
    },

    // ── Ficha del cliente ──────────────────────────────────────────────────
    {
      id: "ficha-del-cliente",
      title: "Ficha del cliente",
      menuPath: "Ventas › Clientes › (cliente)",
      routes: ["/clients/[id]"],
      permission: "clients:read",
      intro: [
        "Se abre haciendo clic en el nombre del cliente. Arriba muestra el CUIT y la condición de IVA (o «Sin CUIT · interno»). Tiene cuatro pestañas: {{Cuenta corriente}}, {{Datos}}, {{Tarifario}} (solo con el permiso de facturación de almacenaje) y {{Adjuntos}}.",
        "{{Cuenta corriente}} muestra el saldo del cliente en su lado y sus movimientos, del más nuevo al más viejo: facturas, notas de crédito y débito, remitos internos, recibos, cheques recibidos sin recibo, cheques rechazados y el ajuste de saldo. Columnas: {{Fecha}}, {{Tipo}}, {{Documento}}, {{Debe}}, {{Haber}}, {{Saldo}} y {{Acciones}}. Una factura saldada lleva la marca {{Pagada}}; una cobrada en parte, {{Parcial}} y lo que falta en el {{Debe}}.",
        "{{Saldo}} es el saldo acumulado después de cada movimiento, del lado del cliente (Ventas u Otras ventas) y por moneda. Sin ajuste de saldo, acumula desde el primer movimiento; con un ajuste de saldo en 0, antes del ajuste dice «—», en el ajuste es 0 y desde ahí acumula. Si el ajuste es distinto de 0, la columna no aparece: ese saldo no dice cuánto le toca a cada lado.",
        "El filtro de período achica la lista, pero el saldo de arriba siempre es el de todas las fechas. Si el cliente tiene movimientos en dólares, el saldo se muestra en pesos y en dólares por separado.",
        "Desde la cuenta corriente también se puede emitir un comprobante ({{Nuevo comprobante}} o {{Nuevo remito}}) o un recibo ({{Nuevo recibo}} o {{Nuevo recibo interno}}) con el cliente ya elegido.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Ficha del cliente › Cuenta corriente",
          title: "~Transportes del Sur S.A.",
          subtitle: "CUIT 30714637432 · Responsable Inscripto",
          tabs: {
            labels: ["Cuenta corriente", "Datos", "Tarifario", "Adjuntos"],
            active: 0,
          },
          actions: [
            { label: "Exportar resumen", variant: "outline" },
            { label: "Ajustar saldo", variant: "outline" },
            { label: "Nuevo comprobante", variant: "outline" },
            { label: "Nuevo recibo", variant: "primary" },
          ],
          stats: [{ label: "El cliente nos debe", value: "$1.250.000,00" }],
          table: {
            columns: [
              "Fecha",
              "Tipo",
              "Documento",
              "Debe",
              "Haber",
              "Saldo",
              "Acciones",
            ],
            rows: [
              [
                "~04/11/2026",
                "~Recibo",
                "~0001-00000045",
                "",
                "~$500.000,00",
                "~$1.250.000,00",
                "~👁 📄 ⬇",
              ],
              [
                "~20/10/2026",
                "~Factura A",
                "~A0003-00000123 · Parcial",
                "~$1.750.000,00",
                "",
                "~$1.750.000,00",
                "~👁 📄 ⬇",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Qué saldo muestra",
          body: [
            "Es lo que deben los comprobantes abiertos del lado del cliente (facturas, notas de débito y cheques rechazados) menos lo que el cliente pagó a cuenta sin imputar. Debajo dice {{El cliente nos debe}}, {{Le debemos al cliente}} o {{Saldo en cero}}.",
            "Es la misma cuenta que usa el aging ([[/aging]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "ver-cuenta-corriente",
          title: "Ver y exportar la cuenta corriente de un cliente",
          permission: "clients:read",
          steps: [
            "Abrí la ficha del cliente desde [[/clients]] (o con el nombre del cliente en las listas de comprobantes, de recibos o en el aging).",
            "En {{Cuenta corriente}}, elegí un período en el filtro de fechas si querés ver solo una parte ({{Todas las fechas}} muestra todo).",
            {
              text: "En la columna {{Acciones}} de cada movimiento:",
              substeps: [
                "{{Ver comprobante}} o {{Ver recibo}} abre el documento.",
                "{{Ver PDF}} lo muestra sin salir de la pantalla.",
                "{{Descargar PDF}} lo baja.",
              ],
            },
            "Para mandarle el resumen al cliente, hacé clic en {{Exportar resumen}}, elegí {{PDF}} o {{Excel}} y el rango ({{Descargar período}}) o {{Todo el historial}}.",
          ],
          keywords: [
            "estado de cuenta",
            "resumen de cuenta",
            "cuánto debe",
            "saldo del cliente",
          ],
        },
        {
          id: "ajustar-saldo-cliente",
          title: "Ajustar el saldo de un cliente (saldo de apertura)",
          summary:
            "Fija la deuda real del cliente a una fecha de corte, por ejemplo al empezar a usar el sistema con facturas históricas cargadas como impagas.",
          permission: "opening_balances:write",
          prerequisites: [
            "Solo el owner. El botón {{Ajustar saldo}} aparece a quien puede emitir comprobantes, pero para los demás está deshabilitado con el aviso «Solo el owner puede tocar el ajuste de saldo.»",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Cuenta corriente › Ajustar saldo",
              title: "Ajustar saldo",
              description:
                "Fijá la deuda real del cliente a una fecha. El sistema reconcilia el saldo al valor ingresado e imputa FIFO contra las facturas anteriores. Editable: re-correr sobrescribe.",
              fields: [
                {
                  label: "Fecha de corte",
                  kind: "date",
                  value: "31/12/2025",
                  marker: 2,
                },
                {
                  label: "Saldo real al corte ($)",
                  kind: "money",
                  value: "850.000,00",
                  marker: 3,
                },
                {
                  label: "Saldo en dólares al corte (US$, opcional)",
                  kind: "money",
                  wide: true,
                },
                {
                  label: "Notas (opcional)",
                  kind: "textarea",
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Registrar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la ficha del cliente, pestaña {{Cuenta corriente}}, hacé clic en {{Ajustar saldo}}.",
            "En {{Fecha de corte}}, elegí la fecha a la que conocés el saldo real.",
            "En {{Saldo real al corte ($)}}, escribí lo que el cliente debía ese día, en pesos (0 o más).",
            "Si el cliente tiene facturas en dólares, en {{Saldo en dólares al corte (US$, opcional)}} escribí cuántos dólares debía ese día (0 o más). Si lo dejás vacío, se vuelve a aplicar el saldo en dólares que ya tenía el ajuste; si no tenía, los comprobantes en dólares quedan como están.",
            "Agregá una nota si querés y hacé clic en {{Registrar}} (si ya había un ajuste, el botón dice {{Actualizar}} y lo reemplaza).",
          ],
          after: [
            "El sistema calcula lo que figuraba abierto en pesos hasta la fecha de corte (facturas y notas de débito, menos las notas de crédito de esas facturas y los cobros) y, si es más que el saldo real, da por saldada la diferencia, aplicándola a las facturas más viejas primero. Si el saldo real es igual o mayor que lo abierto, no salda nada: el ajuste no agrega deuda.",
            "Con saldo en dólares, hace lo mismo con los comprobantes en dólares, en dólares y aparte de los pesos. Sin saldo en dólares, los comprobantes en dólares no entran en el ajuste.",
            "En la cuenta corriente aparece un movimiento {{Ajuste de saldo}} por moneda ajustada: ahí el saldo de esa moneda pasa a ser el que ingresaste.",
            "Las notas de crédito sin factura de origen con fecha hasta el corte quedan dentro del ajuste (las de dólares, si el ajuste tiene saldo en dólares): no saldan facturas posteriores. Las demás se siguen aplicando a las facturas abiertas de su moneda, de la más vencida a la más nueva.",
            "Volver a registrarlo reemplaza el ajuste anterior completo.",
          ],
          errors: [
            {
              message: "Ingresá un saldo válido (no negativo).",
              fix: "Escribí un importe de 0 o más.",
            },
            {
              message: "Ingresá un saldo en dólares válido (no negativo).",
              fix: "Escribí un importe de 0 o más, o dejá el campo vacío.",
            },
            {
              message: "Ingresá la fecha de corte.",
              fix: "Elegí la fecha en «Fecha de corte».",
            },
            {
              message: "No tenés permiso para ajustar saldos de cliente.",
              fix: "Pedile el ajuste al owner.",
            },
            {
              message: "El saldo de apertura no puede ser negativo",
              fix: "Escribí un saldo de 0 o más.",
            },
          ],
          related: ["borrar-ajuste-de-saldo"],
          keywords: [
            "saldo inicial",
            "saldo de apertura",
            "migración",
            "conciliar saldo",
          ],
        },
        {
          id: "borrar-ajuste-de-saldo",
          title: "Editar o borrar el ajuste de saldo",
          permission: "opening_balances:write",
          prerequisites: ["Solo el owner."],
          steps: [
            "En {{Cuenta corriente}}, buscá la fila {{Ajuste de saldo}}.",
            "Para cambiarlo, hacé clic en el lápiz ({{Editar ajuste de saldo}}): se abre {{Ajustar saldo}} con los valores actuales; cambialos y hacé clic en {{Actualizar}}.",
            "Para quitarlo, hacé clic en el tacho ({{Borrar ajuste de saldo}}) y confirmá con {{Borrar}} en {{¿Borrar el ajuste de saldo?}}. También se puede borrar con {{Borrar}} desde el diálogo {{Ajustar saldo}}.",
          ],
          after: [
            "Las imputaciones del ajuste a facturas anteriores se revierten y el saldo vuelve al calculado por el sistema.",
          ],
          errors: [
            {
              message: "Solo el owner puede borrar el ajuste de saldo.",
              fix: "Pedíselo al owner.",
            },
          ],
          related: ["ajustar-saldo-cliente"],
          keywords: ["quitar saldo inicial", "deshacer ajuste"],
        },
        {
          id: "crear-tarifa-cliente",
          title: "Cargar una tarifa propia del cliente",
          summary:
            "Precios de almacenaje, carga, descarga o flete solo para este cliente, con vigencia.",
          permission: "storage_billing:issue",
          prerequisites: [
            "La pestaña {{Tarifario}} se ve con el permiso `storage_billing:read`; cargar, editar o borrar tarifas pide `storage_billing:issue`.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Ficha del cliente › Tarifario › Nueva tarifa",
              title: "Nueva tarifa",
              description:
                "Precio del cliente para un concepto. Las vigencias de un mismo concepto no se pueden superponer: para cambiar el precio, cerrá la tarifa anterior el día antes.",
              fields: [
                {
                  label: "Concepto",
                  kind: "select",
                  value: "Almacenaje",
                  marker: 2,
                },
                {
                  label: "Unidad",
                  kind: "select",
                  value: "Por pallet por mes",
                  marker: 2,
                },
                {
                  label: "Área del depósito",
                  kind: "select",
                  value: "Todas las áreas",
                  wide: true,
                  marker: 3,
                },
                {
                  label: "Precio",
                  kind: "money",
                  value: "4.500,00",
                  marker: 4,
                },
                { label: "Moneda", kind: "select", value: "ARS", marker: 4 },
                { label: "Vigente desde", kind: "date", marker: 5 },
                { label: "Hasta (opcional)", kind: "date", marker: 5 },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            "En la ficha del cliente, pestaña {{Tarifario}}, hacé clic en {{Nueva tarifa}}.",
            {
              text: "Elegí el {{Concepto}} y su {{Unidad}}:",
              substeps: [
                "{{Almacenaje}}: {{Por pallet por mes}} o {{Por pallet por día}}.",
                "{{Carga (ingreso)}} y {{Descarga (egreso)}}: {{Por pallet}}.",
                "{{Flete}}: {{Por carga}}, siempre en pesos y sin área. Precia en las liquidaciones las cargas que no tienen flete propio.",
              ],
            },
            "Si la tarifa vale solo para un área, elegila en {{Área del depósito}}; si no, dejá {{Todas las áreas}}.",
            "Escribí el {{Precio}} y elegí la {{Moneda}} (ARS o USD).",
            "Elegí {{Vigente desde}} y, si tiene fin, {{Hasta (opcional)}}.",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "En los días que cubre, la tarifa del cliente pisa a las tarifas de almacenaje; fuera de ellos se usa la tarifa de almacenaje del cliente o la general.",
            "Una tarifa en dólares se convierte con la cotización oficial del último día del período facturado (o la anterior más cercana). Una tarifa de un área pisa, para los pallets de esa área, a la de todas las áreas.",
            "La columna {{Estado}} la marca {{Vigente}}, {{Vencida}} o {{Futura}}.",
          ],
          errors: [
            {
              message:
                "Ya hay una tarifa de ese concepto vigente del … al …: cerrala antes o elegí otras fechas.",
              fix: "Editá la tarifa anterior y poné en «Hasta (opcional)» el día antes del inicio de la nueva.",
            },
            {
              message: "El fin de vigencia no puede ser anterior al inicio.",
              fix: "Corregí las fechas.",
            },
            {
              message: "Ingresá un precio (0 o más).",
              fix: "Escribí el precio.",
            },
            {
              message: "No tenés permiso para editar tarifarios.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["editar-tarifa-cliente"],
          keywords: [
            "tarifa",
            "precio de almacenaje",
            "precio por pallet",
            "flete",
            "lista de precios",
          ],
        },
        {
          id: "editar-tarifa-cliente",
          title: "Editar o borrar una tarifa del cliente",
          permission: "storage_billing:issue",
          screens: [
            {
              kind: "menu",
              caption: "Tarifario › menú de la fila",
              trigger: "⋯",
              items: [
                { label: "Editar", marker: 2 },
                { label: "Borrar", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la pestaña {{Tarifario}}, abrí el menú ⋯ ({{Acciones}}) de la fila.",
            "{{Editar}} abre {{Editar tarifa}} con los mismos campos que al crearla; cambiá lo necesario y hacé clic en {{Guardar}}.",
            "{{Borrar}} pide confirmación; confirmá con {{Borrar}}.",
          ],
          after: [
            "Al borrar una tarifa de almacenaje, carga o descarga, en los días que cubría se vuelve a usar la tarifa de almacenaje. Las facturas ya emitidas no cambian.",
            "Al borrar una de flete, las cargas sin flete de esos días quedan sin precio para liquidar. Las liquidaciones ya confirmadas no cambian.",
          ],
          errors: [
            {
              message:
                "Ya hay una tarifa de ese concepto vigente del … al …: cerrala antes o elegí otras fechas.",
              fix: "Ajustá las fechas para que no se superpongan con otra tarifa del mismo concepto.",
            },
            {
              message: "No se encontró la tarifa.",
              fix: "Otro usuario la borró: recargá la página.",
            },
          ],
          related: ["crear-tarifa-cliente"],
          keywords: ["cambiar precio", "cerrar tarifa"],
        },
        {
          id: "adjuntar-archivo-cliente",
          title: "Adjuntar documentos al cliente",
          permission: attachmentPermission("client"),
          steps: [
            "En la ficha del cliente, entrá a la pestaña {{Adjuntos}}.",
            "En {{Tipo:}}, elegí {{Constancia de inscripción}}, {{Contrato}} u {{Otro}}.",
            "Arrastrá el archivo a la zona {{Arrastrá un archivo o elegí desde el dispositivo}} o hacé clic para elegirlo.",
            "Para verlo, hacé clic en {{Ver adjunto}}; para quitarlo, en {{Borrar adjunto}} y confirmá con {{Borrar}}.",
          ],
          after: ["El archivo queda en la ficha y en [[/files]]."],
          keywords: ["constancia", "contrato", "subir archivo"],
        },
      ],
    },

    // ── Comprobantes (lista) ───────────────────────────────────────────────
    {
      id: "comprobantes",
      title: "Comprobantes y remitos internos",
      menuPath: "Ventas › Comprobantes / Otras ventas › Remitos internos",
      routes: ["/invoices"],
      permission: "invoices:read",
      intro: [
        "Desde {{Ventas}} se llama {{Comprobantes}} y lista facturas, notas de crédito y notas de débito fiscales. Desde {{Otras ventas}} se llama {{Remitos internos}}: no van a AFIP ni llevan IVA.",
        "Columnas: {{Número}}, {{Cliente}}, {{Fecha}}, {{Total}}, {{Estado}} y {{Acciones}} (el ojo, {{Ver detalle}}, y el sobre para enviarlo por email; el PDF está en el detalle). Filtros: búsqueda por cliente o número, período ({{Todas las fechas}}, {{Hoy}}, {{Este mes}}, {{Personalizado}}…), tipo ({{Todos los tipos}} o una combinación de {{Factura A}}, {{Factura B}}, {{Nota de Crédito}}, {{Nota de Débito}}) y estado. {{Lista}}, {{Por día}}, {{Por semana}} y {{Por mes}} agrupan las filas con un subtotal por grupo.",
        "La lista se actualiza sola cuando otro usuario emite o cuando AFIP devuelve el CAE.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Ventas › Comprobantes",
          title: "Comprobantes",
          subtitle: "Facturas, notas de crédito y débito por canal.",
          actions: [
            { label: "Traer de ARCA", variant: "outline" },
            { label: "Lista", variant: "outline" },
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo", variant: "primary" },
          ],
          toolbar: [
            { label: "Buscar por cliente o número", kind: "input" },
            { label: "Todas las fechas", kind: "select" },
            { label: "Todos los tipos", kind: "select" },
            { label: "Cualquier estado", kind: "select" },
          ],
          table: {
            columns: [
              "Número",
              "Cliente",
              "Fecha",
              "Total",
              "Estado",
              "Acciones",
            ],
            rows: [
              [
                "~A0003-00000124",
                "~Transportes del Sur S.A.",
                "~04/11/2026",
                "~$1.210.000,00",
                "~Emitido",
                "~👁 ✉",
              ],
              [
                "~NC0003-00000008",
                "~Pérez Juan",
                "~03/11/2026",
                "~$60.500,00",
                "~Esperando CAE",
                "~👁",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Estados de un comprobante",
          body: [
            "{{Borrador}}: guardado, esperando que el sistema lo procese. {{Esperando CAE}}: se está pidiendo el CAE a AFIP (o el número, si es interno). Los dos se resuelven solos en segundos; el detalle se actualiza solo.",
            "{{Emitido}}: tiene número y CAE (o número interno). Ya tiene PDF, cuenta en la cuenta corriente y el aging, y no se puede modificar.",
            "{{Fallido}}: AFIP lo rechazó o no se pudo emitir. No tiene número ni CAE y no cuenta para nada; el motivo está en {{Observaciones AFIP}} del detalle (ver [[#revisar-comprobante-fallido]]).",
            "{{Cancelado}}: un remito interno anulado. Solo existe en {{Otras ventas}}: un comprobante fiscal con CAE no se cancela, se anula con una nota de crédito, por eso el filtro de estado de {{Ventas}} no lo ofrece.",
          ],
        },
        {
          title: "Letra de la factura",
          body: [
            "La letra la decide la condición de IVA del cliente: **A** para Responsable Inscripto y Monotributo, **B** para el resto. Las notas de crédito y débito llevan la letra de su factura.",
          ],
        },
      ],
      tasks: [
        {
          id: "emitir-factura",
          title: "Emitir una factura (con CAE de AFIP)",
          permission: "invoices:issue",
          prerequisites: [
            "Un cliente de Ventas activo ([[#crear-cliente]]; también se puede crear desde el formulario con {{Nuevo}}).",
            "Un punto de venta habilitado para el canal fiscal (se configura en [[/admin/afip/puntos-de-venta]]).",
            "El mes de la fecha no puede estar cerrado en contabilidad ([[#periodos-cerrados]]).",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Ventas › Comprobantes › Nuevo",
              title: "Nuevo comprobante",
              description:
                "Se emite con CAE de AFIP. Una vez emitido no se puede modificar.",
              fields: [
                { label: "Tipo", kind: "select", value: "Factura", marker: 2 },
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve fiscal",
                  marker: 2,
                },
                { label: "Fecha de emisión", kind: "date", marker: 2 },
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Transportes del Sur S.A.",
                  wide: true,
                  marker: 3,
                },
              ],
              table: {
                columns: [
                  "Descripción",
                  "Cantidad",
                  "Precio unitario",
                  "IVA",
                  "Subtotal",
                ],
                rows: [
                  [
                    "~Flete Buenos Aires – Rosario",
                    "~1",
                    "~1.000.000,00",
                    "~21%",
                    "~$1.210.000,00",
                  ],
                  [
                    "~Seguro (1%)",
                    "~0,01",
                    "~5.000.000,00",
                    "~21%",
                    "~$60.500,00",
                  ],
                ],
                marker: 4,
              },
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar y cargar otra", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 7 },
              ],
            },
          ],
          steps: [
            "Abrí [[/invoices]] desde {{Ventas}} y hacé clic en {{Nuevo}}. (También desde la ficha del cliente con {{Nuevo comprobante}}: el cliente ya viene elegido.)",
            {
              text: "Revisá el encabezado:",
              substeps: [
                "{{Tipo}}: dejá {{Factura}}.",
                "{{Canal}}: si hay un solo canal fiscal activo ya viene elegido.",
                "Punto de venta: no se elige. Cada canal tiene un solo punto de venta habilitado y la factura sale por ese. Si dice «Sin POS habilitados», hay que configurar uno antes.",
                "{{Fecha de emisión}}: hoy por defecto. AFIP la acepta hasta 10 días antes o después de hoy, y no puede ser anterior a la última factura de la misma letra en ese punto de venta.",
              ],
            },
            {
              text: "En {{Cliente}}, buscá por razón social, nombre fantasía o CUIT y elegilo.",
              substeps: [
                "Si no existe, {{Nuevo}} al lado de la búsqueda abre el alta de cliente sin salir del formulario.",
                "La cruz ({{Cambiar cliente}}) lo quita para elegir otro.",
              ],
            },
            {
              text: "Cargá los {{Ítems}}: {{Descripción}}, {{Cantidad}}, {{Precio unitario}} (sin IVA) e {{IVA}} (21% por defecto). El {{Subtotal}} ya incluye el IVA.",
              substeps: [
                "{{Agregar ítem}} suma una fila; {{Quitar ítem}} la saca.",
                "Tildá {{Venta de bien de uso}} si el ítem es la venta de un bien de la empresa (un camión, por ejemplo): se usa en el Resultado de gestión.",
              ],
            },
            "La fila {{Seguro}} siempre queda última: elegí el porcentaje (1%, 2%, 3%, 5% u {{Otro…}}) y escribí el {{Valor declarado}}. Si dejás el valor vacío, la fila no se incluye.",
            "Revisá Neto, IVA y Total al pie. Si querés, escribí {{Notas internas (no van a AFIP)}}.",
            "Hacé clic en {{Guardar}}. Con {{Guardar y cargar otra}} (o Ctrl/⌘ + Enter) se emite y el formulario queda listo para otra factura.",
          ],
          after: [
            "El aviso dice «Comprobante en cola — esperando CAE.» y se abre el detalle con el estado {{Borrador}} → {{Esperando CAE}} → {{Emitido}}. AFIP asigna el número; mientras tanto se muestra el número esperado como «(provisorio, lo confirma AFIP)».",
            "Con el CAE: el detalle muestra {{CAE}} y {{Vencimiento CAE}}, se habilita el {{PDF}} (con código QR), la factura suma a la cuenta corriente y al aging del cliente y se registra el asiento contable (Deudores por ventas al Debe; Ventas e IVA débito fiscal al Haber). Entra en el Libro IVA Ventas.",
            "Si AFIP la rechaza queda {{Fallido}}: ver [[#revisar-comprobante-fallido]].",
            "Un mismo formulario no emite dos veces aunque hagas doble clic.",
          ],
          errors: [
            {
              message: "Verificá un cliente antes de emitir.",
              fix: "Elegí el cliente en «Cliente».",
            },
            {
              message: "Elegí un punto de venta.",
              fix: "El canal no tiene un punto de venta habilitado: configurá uno en [[/admin/afip/puntos-de-venta]].",
            },
            {
              message: "Cada ítem necesita una descripción.",
              fix: "Completá la descripción de cada ítem o quitá las filas vacías.",
            },
            {
              message: "El total tiene que ser mayor a cero.",
              fix: "Cargá cantidad y precio.",
            },
            {
              message:
                "La fecha del comprobante tiene que estar dentro de los … días de hoy.",
              fix: "Usá una fecha más cercana a hoy.",
            },
            {
              message:
                "La fecha no puede ser anterior a la del último comprobante de este tipo en el punto de venta (…).",
              fix: "Usá esa fecha o una posterior: AFIP no acepta fechas hacia atrás en el mismo punto de venta.",
            },
            {
              message:
                "La condición de IVA del cliente no admite comprobantes …. Revisá la condición de IVA del cliente.",
              fix: "La condición de IVA del cliente no corresponde a esa letra: revisala con AFIP.",
            },
            {
              message: "Los comprobantes A requieren el CUIT del cliente.",
              fix: "Verificá que el cliente tenga CUIT.",
            },
            {
              message:
                "El período contable … está cerrado: usá una fecha de un período abierto o pedí que lo reabran en Contabilidad.",
              fix: "Cambiá la fecha a un mes abierto o pedí que reabran el período ([[#reabrir-periodo]]).",
            },
            {
              message: "El cliente está inactivo.",
              fix: "Elegí un cliente activo.",
            },
            {
              message:
                "Un comprobante de Ventas necesita un cliente de Ventas.",
              fix: "Elegí un cliente creado en Ventas (con CUIT).",
            },
            {
              message: "El canal está inactivo.",
              fix: "Elegí otro canal o pedí que lo reactiven.",
            },
            {
              message:
                "Punto de venta … no está configurado o no pertenece a ….",
              fix: "Ese punto de venta ya no está habilitado para el canal: pedile a un owner o admin que lo revise en [[/admin/afip/puntos-de-venta]].",
            },
            {
              message: "No tenés permiso para emitir comprobantes.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: [
            "revisar-comprobante-fallido",
            "emitir-nota-de-credito",
            "enviar-comprobante-por-email",
          ],
          keywords: [
            "facturar",
            "factura A",
            "factura B",
            "CAE",
            "emitir",
            "AFIP",
            "seguro",
          ],
        },
        {
          id: "emitir-remito-interno",
          title: "Emitir un remito interno",
          summary:
            "Comprobante de Otras ventas: no va a AFIP ni lleva IVA; el precio es final.",
          permission: "invoices:issue",
          prerequisites: [
            "Un cliente de Otras ventas activo ([[#crear-cliente]] desde {{Otras ventas}}).",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Otras ventas › Remitos internos › Nuevo",
              title: "Nuevo remito interno",
              description: "No va a AFIP ni lleva IVA: el precio es final.",
              fields: [
                { label: "Canal", kind: "select", value: "Jouve interno" },
                { label: "Fecha de emisión", kind: "date" },
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Pérez Juan",
                  wide: true,
                  marker: 2,
                },
              ],
              table: {
                columns: [
                  "Descripción",
                  "Cantidad",
                  "Precio final",
                  "Subtotal",
                ],
                rows: [["~Flete local", "~1", "~150.000,00", "~$150.000,00"]],
                marker: 3,
              },
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar y cargar otra", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "Abrí [[/invoices]] desde {{Otras ventas}} ({{Remitos internos}}) y hacé clic en {{Nuevo}}. (O desde la ficha de un cliente interno, con {{Nuevo remito}}.)",
            "En {{Cliente}}, buscá por nombre o nombre fantasía; {{Nuevo}} crea un cliente interno si no existe.",
            "Cargá los ítems con {{Descripción}}, {{Cantidad}} y {{Precio final}}. Opcional: la fila {{Seguro}} con su porcentaje y {{Valor declarado}}.",
            "Hacé clic en {{Guardar}} (o {{Guardar y cargar otra}}).",
          ],
          after: [
            "El aviso dice «Remito interno guardado.». El sistema le da el número siguiente de su punto de venta y lo marca {{Emitido}}; su PDF dice «Documento no fiscal».",
            "Suma a la cuenta corriente y al aging del lado Otras ventas. No genera asiento contable ni entra en el Libro IVA.",
          ],
          errors: [
            {
              message: "Verificá un cliente antes de emitir.",
              fix: "Elegí el cliente.",
            },
            {
              message:
                "Un comprobante de Otras ventas necesita un cliente de Otras ventas.",
              fix: "Elegí un cliente creado desde Otras ventas.",
            },
            {
              message: "El total tiene que ser mayor a cero.",
              fix: "Cargá cantidad y precio.",
            },
          ],
          related: [
            "anular-remito-interno",
            "facturar-remito-interno",
            "ventas-y-otras-ventas",
          ],
          keywords: [
            "remito",
            "venta sin factura",
            "comprobante interno",
            "en negro",
          ],
        },
        {
          id: "buscar-comprobantes",
          title: "Buscar y filtrar comprobantes",
          permission: "invoices:read",
          steps: [
            "En [[/invoices]], escribí parte del nombre del cliente o del número en {{Buscar por cliente o número}}.",
            "Elegí el período (por defecto {{Todas las fechas}}); con {{Personalizado}} elegís {{Desde}} y {{Hasta}} en dos calendarios.",
            "En {{Todos los tipos}} tildá uno o varios tipos ({{Factura A}}, {{Factura B}}, {{Nota de Crédito}}, {{Nota de Débito}}).",
            "En {{Cualquier estado}} elegí un estado si querés ver, por ejemplo, solo los {{Fallido}}.",
            "Para ver subtotales, cambiá {{Lista}} por {{Por día}}, {{Por semana}} o {{Por mes}}. {{Limpiar}} saca todos los filtros.",
          ],
          after: [
            "Los filtros quedan en la dirección de la página: podés guardarla o compartirla.",
          ],
          keywords: ["filtrar facturas", "buscar factura", "facturas del mes"],
        },
        {
          id: "descargar-pdf-comprobante",
          title: "Ver o descargar el PDF de un comprobante",
          permission: "invoices:read",
          steps: [
            "En [[/invoices]], en la fila del comprobante emitido, hacé clic en el ojo ({{Ver detalle}}).",
            "En el detalle, el botón {{PDF}} lo abre en otra pestaña; desde ahí lo imprimís o lo bajás.",
          ],
          after: [
            "Solo los comprobantes {{Emitido}} tienen PDF. El fiscal lleva CAE y código QR de AFIP; el remito interno, la leyenda de documento no fiscal.",
          ],
          keywords: ["imprimir factura", "pdf", "bajar factura"],
        },
        {
          id: "enviar-comprobante-por-email",
          title: "Enviar un comprobante por email",
          permission: ["email:send", "invoices:read"],
          screens: [
            {
              kind: "dialog",
              title: "Enviar comprobante por email",
              description: "El cliente recibirá el PDF adjunto.",
              fields: [
                {
                  label: "Destinatario",
                  kind: "input",
                  value: "pagos@transportesdelsur.com",
                  wide: true,
                  marker: 2,
                },
                { label: "Asunto", kind: "input", wide: true, marker: 2 },
                {
                  label: "Mensaje (opcional)",
                  kind: "textarea",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Enviar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/invoices]], en la fila del comprobante emitido, hacé clic en el sobre ({{Enviar por email}}).",
            "Revisá {{Destinatario}} (viene el email del cliente o, si no tiene, el del último envío), {{Asunto}} y, si querés, un {{Mensaje (opcional)}}; vacío usa el texto por defecto. Si ya se envió antes, arriba dice cuándo fue el último envío.",
            "Hacé clic en {{Enviar}}. Se habilita con un destinatario y un asunto, aunque no cambies lo propuesto.",
          ],
          after: [
            "El cliente recibe el email con el PDF adjunto. Un remito interno sale a nombre de la división, no del emisor fiscal.",
          ],
          errors: [
            {
              message: "Solo se pueden enviar comprobantes en estado emitido.",
              fix: "Esperá a que el comprobante tenga CAE.",
            },
            {
              message:
                "Email no configurado. Pedile al administrador que setee RESEND_API_KEY y EMAIL_FROM.",
              fix: "Avisale al administrador del sistema.",
            },
            {
              message: "Email inválido.",
              fix: "Corregí el destinatario.",
            },
            {
              message: "No tenés permiso para enviar emails.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          keywords: ["mandar factura", "mail", "correo"],
        },
        {
          id: "exportar-comprobantes",
          title: "Exportar comprobantes",
          permission: "invoices:read",
          steps: [
            "En [[/invoices]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}}, el rango {{Desde}}–{{Hasta}} (por defecto el mes actual) y hacé clic en {{Descargar período}}, o {{Todo el historial}}.",
          ],
          after: ["Se exportan los comprobantes del lado en que estás."],
          keywords: ["excel de facturas", "listado de ventas"],
        },
        {
          id: "traer-emitidos-de-arca",
          title: "Traer de ARCA los comprobantes emitidos fuera del sistema",
          summary:
            "Importa los comprobantes que figuran emitidos en ARCA y no están en el sistema (por ejemplo, los hechos en el sitio de AFIP). Es el mismo proceso que corre solo cada noche.",
          permission: "afip:admin",
          steps: [
            "En [[/invoices]] desde {{Ventas}}, hacé clic en {{Traer de ARCA}}.",
            "Esperá: un aviso muestra «Importando comprobantes de ARCA…» con la cantidad importada hasta el momento. Podés seguir trabajando o recargar la página.",
          ],
          after: [
            "Al terminar, el aviso dice cuántos comprobantes se importaron o «No había comprobantes nuevos en ARCA.», y la lista se actualiza.",
          ],
          errors: [
            {
              message: "La importación no arrancó. Probá de nuevo en un rato.",
              fix: "Volvé a hacer clic en unos minutos.",
            },
            {
              message: "La importación de ARCA falló: …",
              fix: "El mensaje dice el motivo (por lo general AFIP no respondió): probá más tarde.",
            },
            {
              message: "No tenés permiso para administrar AFIP.",
              fix: "Lo hace un owner o admin.",
            },
          ],
          keywords: ["sincronizar AFIP", "importar facturas", "ARCA"],
        },
      ],
    },

    // ── Detalle del comprobante ────────────────────────────────────────────
    {
      id: "detalle-comprobante",
      title: "Detalle de un comprobante",
      menuPath: "Ventas › Comprobantes › (comprobante)",
      routes: ["/invoices/[id]"],
      permission: "invoices:read",
      intro: [
        "Se abre con {{Ver detalle}} (el ojo) en la lista. Arriba: tipo y número, canal y fecha, el estado (se actualiza solo mientras se emite) y los botones de lo que se puede hacer según el estado y tu permiso.",
        "Debajo: {{Cliente}}, {{Operación}} (fechas de servicio y vencimiento, concepto, moneda y, en una NC o ND con notas internas, sus {{Observaciones}}), {{Ítems}}, {{Totales}}, {{Datos AFIP}} ({{CAE}}, {{Vencimiento CAE}}, {{Emitido el}} y, si hay, {{Observaciones AFIP}}) o {{Documento no fiscal}} en un remito interno, {{Adjuntos}} y, con permiso de auditoría, el {{Historial}} de cambios.",
        "En una factura B el IVA no se discrimina; se informa aparte como {{IVA contenido (Ley 27.743)}}.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Detalle de una factura fiscal emitida",
          title: "Factura",
          subtitle: "Jouve fiscal · 2026-11-04",
          actions: [
            { label: "PDF", variant: "outline" },
            { label: "Cobrar", variant: "primary" },
            { label: "~Emitir NC", variant: "outline" },
            { label: "~Emitir ND", variant: "outline" },
          ],
        },
      ],
      tasks: [
        {
          id: "emitir-nota-de-credito",
          title: "Emitir una nota de crédito",
          summary:
            "Anula o ajusta a la baja una factura fiscal emitida. Es la única forma de corregir una factura con CAE.",
          permission: ["invoices:issue", "credit_debit_notes:issue"],
          prerequisites: [
            "Una factura fiscal {{Emitido}} con saldo abierto: la nota de crédito no puede superar lo que la factura todavía debe.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Detalle de la factura › Emitir NC",
              title: "Nota de Crédito",
              description:
                "Anula o ajusta a la baja la factura. Los ítems se prellenan con la factura origen — editá para reflejar el monto que estás acreditando.",
              fields: [
                { label: "Fecha", kind: "date", marker: 2 },
                {
                  label: "Motivo",
                  kind: "input",
                  value: "Devolución parcial del servicio",
                  marker: 2,
                },
                {
                  label: "Observaciones (opcional)",
                  kind: "textarea",
                  wide: true,
                  marker: 2,
                },
              ],
              table: {
                columns: ["Descripción", "Cant.", "Precio unitario", "IVA"],
                rows: [
                  [
                    "~Flete Buenos Aires – Rosario",
                    "~1",
                    "~200.000,00",
                    "~21%",
                  ],
                ],
                marker: 3,
              },
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "~Emitir NC", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "Abrí el detalle de la factura y hacé clic en **Emitir NC**. (Alternativa: en [[/invoices]] → {{Nuevo}}, {{Tipo}} {{Nota de Crédito}} y elegí la {{Factura origen}}; el resto es igual.)",
            "Revisá la {{Fecha}} y escribí el {{Motivo}} (obligatorio). Si la factura es en dólares, aparece un campo de cotización que viene con la de la factura: cambiala por la del día.",
            "Si querés, escribí {{Observaciones (opcional)}}: son notas internas, no van a AFIP ni al PDF; se ven en el detalle de la nota. Solo están en el formulario de **Emitir NC**, no en el de {{Nuevo}}.",
            "Los ítems vienen copiados de la factura: dejá solo lo que acreditás y ajustá {{Cant.}} o {{Precio unitario}} (sin IVA). {{Agregar ítem}} y {{Quitar ítem}} suman o sacan filas. Revisá Neto, IVA y Total.",
            "Hacé clic en **Emitir NC** (en el formulario de {{Nuevo}}, {{Guardar}}).",
          ],
          after: [
            "El aviso dice «Nota de Crédito en cola — esperando CAE.» y se abre el detalle de la nota. Lleva la misma letra, punto de venta y cliente que la factura (RG 1415).",
            "Con el CAE: la nota descuenta el saldo de la factura en la cuenta corriente y el aging, y su asiento revierte el de la venta (Ventas e IVA débito al Debe, Deudores por ventas al Haber).",
            "Si la factura facturaba una carga, una liquidación o un período de almacenaje, una nota de crédito por el total lo vuelve a dejar para facturar.",
          ],
          errors: [
            {
              message: "El motivo de la nota es obligatorio.",
              fix: "Escribí el motivo.",
            },
            {
              message: "El motivo es obligatorio para NC/ND.",
              fix: "Escribí el motivo.",
            },
            {
              message: "Elegí la factura origen.",
              fix: "En «Factura origen», buscá y elegí la factura.",
            },
            {
              message:
                "La nota de crédito (…) supera el saldo abierto del comprobante de origen (…).",
              fix: "Bajá el importe: la factura ya está cobrada o acreditada en parte.",
            },
            {
              message:
                "Una nota de crédito no se puede emitir sobre otra nota de crédito.",
              fix: "Elegí la factura original como origen.",
            },
            {
              message: "El comprobante de origen no está emitido.",
              fix: "Esperá a que la factura tenga CAE.",
            },
            {
              message:
                "La fecha del comprobante tiene que estar dentro de los … días de hoy.",
              fix: "Usá una fecha más cercana a hoy.",
            },
            {
              message:
                "No tenés permiso para emitir notas de crédito o débito.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["emitir-nota-de-debito", "emitir-factura"],
          keywords: [
            "NC",
            "nota de crédito",
            "anular factura",
            "acreditar",
            "devolución",
          ],
        },
        {
          id: "emitir-nota-de-debito",
          title: "Emitir una nota de débito",
          summary:
            "Ajusta a la suba una factura fiscal: diferencias de tarifa, intereses, cargos extra.",
          permission: ["invoices:issue", "credit_debit_notes:issue"],
          prerequisites: ["Una factura fiscal {{Emitido}}."],
          steps: [
            "Abrí el detalle de la factura y hacé clic en **Emitir ND**. (O en [[/invoices]] → {{Nuevo}}, {{Tipo}} {{Nota de Débito}} y elegí la {{Factura origen}}.)",
            "Revisá la {{Fecha}} y escribí el {{Motivo}} (obligatorio). Si querés, agregá {{Observaciones (opcional)}}: notas internas que no van a AFIP ni al PDF (solo en el formulario de **Emitir ND**).",
            "Reemplazá los ítems copiados por el cargo extra: {{Descripción}}, {{Cant.}}, {{Precio unitario}} sin IVA e {{IVA}}.",
            "Hacé clic en **Emitir ND** (en el formulario de {{Nuevo}}, {{Guardar}}).",
          ],
          after: [
            "Con el CAE, la nota de débito suma a la deuda del cliente en la cuenta corriente y el aging, y se puede cobrar como una factura.",
            "Para intereses por mora conviene [[#generar-nd-mora]], que calcula el interés y evita cobrar dos veces el mismo período.",
          ],
          errors: [
            {
              message: "El motivo de la nota es obligatorio.",
              fix: "Escribí el motivo.",
            },
            {
              message: "Cada ítem necesita una descripción.",
              fix: "Completá la descripción.",
            },
            {
              message:
                "No tenés permiso para emitir notas de crédito o débito.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["emitir-nota-de-credito", "generar-nd-mora"],
          keywords: [
            "ND",
            "nota de débito",
            "cargo extra",
            "diferencia de tarifa",
          ],
        },
        {
          id: "revisar-comprobante-fallido",
          title: "Qué hacer con un comprobante fallido",
          summary:
            "AFIP rechazó la emisión: el comprobante no tiene número ni CAE y no cuenta para nada.",
          permission: "invoices:issue",
          steps: [
            "Abrí el detalle: en {{Datos AFIP}} dice {{Falló: revisá observaciones}}.",
            "Desplegá {{Observaciones AFIP}}: el texto trae el código y el mensaje de AFIP (por ejemplo `[10015] …`).",
            "Corregí la causa (datos del cliente, fecha, punto de venta) y emití un comprobante nuevo con [[#emitir-factura]]. El comprobante fallido no se edita ni se reintenta.",
          ],
          after: [
            "El comprobante fallido queda en la lista con estado {{Fallido}}, sin número. Si facturaba una carga, una liquidación o un período de almacenaje, ese ítem vuelve a quedar para facturar.",
            "Si AFIP no contestó (en lugar de rechazar), el comprobante queda {{Esperando CAE}} y el sistema vuelve a consultar solo hasta resolverlo: no emitas otro mientras tanto, porque AFIP podría haberlo autorizado.",
            "Un punto de venta de contingencia (CAEA) necesita un CAEA vigente para la fecha: si no lo hay, falla con «No hay CAEA vigente para la fecha del comprobante — solicitalo desde AFIP admin antes de emitir por contingencia.»",
          ],
          keywords: [
            "rechazo AFIP",
            "error AFIP",
            "sin CAE",
            "factura fallida",
            "observaciones",
          ],
        },
        {
          id: "cobrar-comprobante",
          title: "Cobrar un comprobante desde su detalle",
          permission: ["receipts:write", "accounts:read"],
          prerequisites: [
            "Una factura o nota de débito {{Emitido}} con saldo pendiente.",
          ],
          steps: [
            "En el detalle del comprobante, hacé clic en {{Cobrar}}.",
            "Se abre {{Cobrar a cliente}}: el formulario de recibo con el cliente elegido y el comprobante ya imputado por lo que debe. Seguí desde el paso 2 de [[#emitir-recibo]].",
          ],
          related: ["emitir-recibo"],
          keywords: ["cobrar factura", "registrar pago"],
        },
        {
          id: "anular-remito-interno",
          title: "Anular un remito interno",
          summary:
            "Solo los comprobantes internos se anulan. Un comprobante fiscal se compensa con una nota de crédito.",
          permission: "invoices:cancel",
          prerequisites: [
            "Un remito interno {{Emitido}} o {{Fallido}}, que no esté facturado en Ventas.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Anular comprobante",
              description: "Remito interno 0001-00000012",
              footer: [
                { label: "Volver", variant: "ghost" },
                { label: "Anular", variant: "primary", marker: 2 },
              ],
            },
          ],
          steps: [
            "En el detalle del remito interno, hacé clic en {{Anular}}.",
            "Leé el aviso y confirmá con {{Anular}}.",
          ],
          after: [
            "Queda {{Cancelado}} y deja de contar para la cuenta corriente y el aging. Si facturaba un flete o un período de almacenaje, vuelve a quedar para facturar. No se puede deshacer.",
          ],
          errors: [
            {
              message:
                "El comprobante tiene recibos imputados. Anulá esos recibos antes de anularlo.",
              fix: "Anulá o editá los recibos que lo cobran ([[#anular-recibo]]) y volvé a intentar.",
            },
            {
              message:
                "El comprobante tiene notas de crédito o débito emitidas. Anulá esas notas antes de anularlo.",
              fix: "Anulá primero esas notas.",
            },
            {
              message:
                "El comprobante está saldado por el saldo inicial del cliente. Recalculá el saldo inicial antes de anularlo.",
              fix: "Pedile al owner que vuelva a registrar o borre el ajuste de saldo ([[#ajustar-saldo-cliente]]).",
            },
            {
              message:
                "Un comprobante fiscal no se anula: emití una nota de crédito para compensarlo.",
              fix: "Usá [[#emitir-nota-de-credito]].",
            },
            {
              message: "Solo se puede anular un comprobante emitido o fallido.",
              fix: "Ya está anulado o todavía se está emitiendo: recargá la página.",
            },
            {
              message:
                "El comprobante cambió mientras lo anulabas. Recargá la página.",
              fix: "Otro usuario lo modificó: recargá y revisá su estado.",
            },
            {
              message: "No tenés permiso para anular comprobantes.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["emitir-remito-interno"],
          keywords: ["anular remito", "cancelar remito", "borrar comprobante"],
        },
        {
          id: "facturar-remito-interno",
          title: "Facturar un remito interno en Ventas",
          summary:
            "Convierte un remito interno en una factura fiscal a un cliente de Ventas, sin contar la venta dos veces.",
          permission: "invoices:issue",
          prerequisites: [
            "Un remito interno {{Emitido}} que todavía no se facturó.",
            "Un único canal fiscal activo con un punto de venta habilitado.",
            "El cliente de Ventas (con CUIT) al que se factura.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Detalle del remito interno › Facturar",
              title: "~Facturar Remito interno 0001-00000012",
              fields: [
                {
                  label: "Cliente de Ventas",
                  kind: "picker",
                  value: "Transportes del Sur S.A.",
                  wide: true,
                  marker: 2,
                },
                { label: "IVA", kind: "select", value: "21%", marker: 3 },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Emitir factura", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En el detalle del remito interno, hacé clic en {{Facturar}}.",
            "En {{Cliente de Ventas}}, elegí el cliente fiscal.",
            "Elegí el {{IVA}}: el precio del remito pasa a ser el neto y se le suma el IVA. El punto de venta no se elige: es el único habilitado del canal fiscal.",
            "Revisá Neto, IVA y Total y hacé clic en {{Emitir factura}}.",
          ],
          after: [
            "Se emite una factura en Ventas con los mismos ítems y fecha de hoy. El aviso dice «Factura en cola: con el CAE, el remito se acredita con una nota de crédito interna.»",
            "Con el CAE, el remito se cancela con una nota de crédito interna. Si el remito estaba cobrado, el recibo interno se anula y el cobro pasa a un recibo de Ventas aplicado a la factura: el cliente queda debiendo el IVA.",
            "El remito muestra «Facturado en» con el enlace a la factura, y la factura «Origen: remito interno». Desde ahí el remito ya no admite cobros, ajustes, notas ni anulación.",
            "Mientras se acredita, la factura dice «Acreditando el remito: en unos minutos queda saldado.» Si no se completa, ver [[#reintentar-acreditacion-remito]].",
          ],
          errors: [
            {
              message:
                "El remito ya tiene una nota de crédito: no se puede facturar.",
              fix: "Ese remito ya fue ajustado: facturá con un comprobante nuevo.",
            },
            {
              message:
                "El remito está saldado en parte por un ajuste de saldo: quitá el ajuste antes de facturarlo.",
              fix: "Pedile al owner que borre el ajuste de saldo del cliente ([[#borrar-ajuste-de-saldo]]).",
            },
            {
              message:
                "El remito se cobró con cheques: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.",
              fix: "Seguí esos pasos en ese orden.",
            },
            {
              message:
                "El cobro del remito tiene retenciones: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.",
              fix: "Seguí esos pasos en ese orden.",
            },
            {
              message:
                "Un recibo interno de este remito también paga otros comprobantes: anulalo, facturá el remito y cargá el cobro en Ventas.",
              fix: "Anulá ese recibo interno, facturá y volvé a cargar los cobros.",
            },
            {
              message:
                "Un recibo interno de este remito tiene saldo a cuenta: anulalo, facturá el remito y cargá el cobro en Ventas.",
              fix: "Anulá ese recibo interno, facturá y volvé a cargar el cobro.",
            },
            {
              message:
                "El remito tiene un cobro en otra moneda: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.",
              fix: "Seguí esos pasos en ese orden.",
            },
            {
              message:
                "El remito se cobró en un período contable cerrado: no se puede pasar el cobro a Ventas.",
              fix: "Pedí que reabran el período ([[#reabrir-periodo]]).",
            },
            {
              message: "Elegí el cliente de Ventas.",
              fix: "Elegí el cliente fiscal.",
            },
            {
              message:
                "Elegí un cliente de Ventas, con CUIT y condición de IVA.",
              fix: "Elegí un cliente creado en Ventas.",
            },
            {
              message: "Configurá un único canal fiscal activo para facturar.",
              fix: "Pedile al administrador que revise los canales.",
            },
            {
              message: "No hay un punto de venta fiscal habilitado.",
              fix: "Configurá uno en [[/admin/afip/puntos-de-venta]].",
            },
          ],
          related: ["reintentar-acreditacion-remito", "emitir-remito-interno"],
          keywords: [
            "pasar remito a factura",
            "facturar remito",
            "blanquear venta",
          ],
        },
        {
          id: "reintentar-acreditacion-remito",
          title: "Reintentar la acreditación de un remito facturado",
          permission: "invoices:issue",
          prerequisites: [
            "Una factura que facturó un remito interno y cuya acreditación no se completó: el detalle dice «El remito todavía no se acreditó: la venta figura en Ventas y en Otras ventas hasta que se complete.»",
          ],
          steps: [
            "En el detalle de la factura, hacé clic en {{Reintentar acreditación}}.",
          ],
          after: [
            "El aviso dice «Acreditación en cola.» y en unos minutos se emite la nota de crédito interna del remito (y se pasan los cobros, si los había).",
          ],
          errors: [
            {
              message: "No se pudo encolar la acreditación. Probá de nuevo.",
              fix: "Volvé a hacer clic en unos minutos.",
            },
          ],
          related: ["facturar-remito-interno"],
          keywords: ["remito no acreditado", "venta duplicada"],
        },
        {
          id: "regenerar-pdf",
          title: "Regenerar el PDF de un comprobante",
          permission: "invoices:issue",
          steps: [
            "Si el detalle de un comprobante emitido muestra {{Regenerar PDF}} (pasa cuando falló el paso final de la emisión), hacé clic.",
          ],
          after: [
            "El aviso dice «PDF regenerado.» y el botón desaparece. El botón {{PDF}} siempre genera el PDF al abrirlo.",
          ],
          keywords: ["pdf faltante"],
        },
        {
          id: "clasificar-item-gestion",
          title: "Clasificar un ítem como servicio o venta de bien de uso",
          summary:
            "Solo cambia cómo se agrupa en el Resultado de gestión: no toca el asiento, el Libro IVA ni AFIP.",
          permission: "invoices:issue",
          steps: [
            "En el detalle del comprobante, en la tabla {{Ítems}}, columna {{Gestión}}, elegí {{Servicio}} o {{Venta de bien de uso}}.",
          ],
          after: [
            "El aviso dice «Clasificación guardada.» Se puede cambiar aunque el comprobante esté emitido o anulado.",
          ],
          keywords: ["venta de camión", "bien de uso", "resultado de gestión"],
        },
        {
          id: "adjuntar-archivo-comprobante",
          title: "Adjuntar archivos a un comprobante",
          permission: attachmentPermission("invoice"),
          steps: [
            "En el detalle del comprobante, en {{Adjuntos}}, elegí el {{Tipo:}} ({{Comprobante}}, {{Remito}} u {{Otro}}).",
            "Arrastrá el archivo a {{Arrastrá un archivo o elegí desde el dispositivo}} o hacé clic para elegirlo.",
            "{{Ver adjunto}} lo abre; {{Borrar adjunto}} lo quita (confirmá con {{Borrar}}).",
          ],
          keywords: ["remito firmado", "subir respaldo"],
        },
      ],
    },

    // ── Recibos ────────────────────────────────────────────────────────────
    {
      id: "recibos",
      title: "Recibos",
      menuPath: "Ventas › Recibos / Otras ventas › Recibos internos",
      routes: ["/receipts", "/receipts/[id]"],
      permission: "receipts:read",
      intro: [
        "Cada recibo registra un cobro: junta los medios de pago (en qué cuenta entró la plata), las retenciones sufridas y a qué comprobantes se imputa. La numeración es independiente por canal. Desde {{Otras ventas}} se llaman {{Recibos internos}} e imputan remitos internos.",
        "Columnas de la lista: {{Recibo}} (tachado si está anulado), {{Cliente}}, {{Fecha}}, {{Total}}, {{Estado}} ({{Emitido}} o {{Anulado}}) y {{Acciones}}. Filtros: búsqueda por cliente o número, período y estado; se puede agrupar por día, semana o mes.",
        "El detalle de un recibo (con {{Ver recibo}}) muestra los {{Medios de pago}}, los {{Totales}} ({{Pago real}}, {{Retenciones}}, {{Total}}, {{Imputado}}, {{A cuenta}}), las {{Retenciones / Percepciones}} con su certificado, las {{Imputaciones}}, las notas, el {{PDF}} y los {{Adjuntos}}.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Ventas › Recibos",
          title: "Recibos",
          subtitle:
            "Cobros de clientes con imputación a comprobantes. Numerador independiente por canal.",
          actions: [
            { label: "Lista", variant: "outline" },
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo recibo", variant: "primary" },
          ],
          toolbar: [
            { label: "Buscar por cliente o número", kind: "input" },
            { label: "Todas las fechas", kind: "select" },
            { label: "Cualquier estado", kind: "select" },
          ],
          table: {
            columns: [
              "Recibo",
              "Cliente",
              "Fecha",
              "Total",
              "Estado",
              "Acciones",
            ],
            rows: [
              [
                "~0001-00000045",
                "~Transportes del Sur S.A.",
                "~04/11/2026",
                "~$500.000,00",
                "~Emitido",
                "~👁 ✉ ☑ ✎ ⊘",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Cómo se arma el total",
          body: [
            "{{Total}} = {{Pago real}} (la suma de las líneas de pago) + {{Retenciones}}. Las retenciones cancelan deuda del cliente pero no entran como plata: son crédito fiscal.",
            "{{Imputado}} es lo que el recibo aplica a comprobantes; lo que sobra queda {{A cuenta}} del cliente, baja su saldo y se puede imputar después ([[#imputar-recibo]]).",
          ],
        },
        {
          title: "Imputación",
          body: [
            "{{Automática (los más viejos primero)}}: cancela los comprobantes pendientes del canal, del más viejo al más nuevo; lo que sobre queda a cuenta.",
            "{{Elegir comprobantes}}: elegís qué comprobantes cancela y cuánto de cada uno (también cheques rechazados del cliente).",
            "{{A cuenta (imputar después)}}: el cobro queda a cuenta y se imputa después desde la lista con {{Imputar}}.",
            "Un recibo solo cancela comprobantes de su mismo cliente, canal y moneda.",
          ],
        },
      ],
      tasks: [
        {
          id: "emitir-recibo",
          title: "Emitir un recibo (registrar un cobro)",
          permission: ["receipts:write", "accounts:read"],
          prerequisites: [
            "Un punto de venta habilitado para el canal.",
            "Las cuentas donde entra la plata (banco, caja, cartera de cheques) en [[/accounts]].",
            "Cargar retenciones pide además el permiso `retentions:write`.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Ventas › Recibos › Nuevo recibo",
              title: "Nuevo recibo",
              description:
                "El número se asigna automáticamente al canal. Una vez emitido, podés editar montos, líneas o anular.",
              fields: [
                { label: "Canal", kind: "select", value: "Jouve fiscal" },
                { label: "Número", kind: "input", value: "46" },
                { label: "Fecha", kind: "date", marker: 1 },
                { label: "Moneda", kind: "select", value: "ARS", marker: 1 },
                {
                  label: "Cliente",
                  kind: "picker",
                  value: "Transportes del Sur S.A.",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Imputación",
                  kind: "select",
                  value: "Automática (los más viejos primero)",
                  wide: true,
                  marker: 5,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              table: {
                columns: ["Cuenta", "Monto", "Transferencia"],
                rows: [["~Banco Galicia CC", "~480.000,00", "~TRF 99812"]],
                marker: 3,
              },
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Emitir recibo", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            {
              text: "En [[/receipts]], hacé clic en {{Nuevo recibo}} (desde Otras ventas, {{Nuevo recibo interno}}). También desde la ficha del cliente o con {{Cobrar}} en un comprobante. Revisá el encabezado:",
              substeps: [
                "{{Canal}}: viene el del lado; el {{Número}} se propone solo y no se cambia, salvo en el primer recibo del canal (por si venías numerando en otro sistema).",
                "{{Fecha}} del cobro y {{Moneda}} (ARS o USD). En dólares aparece {{Cotización (ARS por USD)}}, que se completa con la cotización cargada de esa fecha; si no hay, escribila.",
              ],
            },
            "En {{Cliente}}, buscá y elegí el cliente.",
            {
              text: "En {{Líneas de pago}}, cargá cada medio por el que entró la plata ({{Agregar línea}} suma otra, {{Quitar línea}} la saca):",
              substeps: [
                "{{Cuenta}}: la cuenta donde entra (solo las activas de la moneda del recibo).",
                "{{Monto}}.",
                "En una cuenta bancaria, {{Transferencia}} (referencia); en efectivo u otras, {{Referencia (opcional)}}.",
                "En una cartera de cheques ({{Cheques físicos en cartera}} o {{e-cheq en cartera}}): {{Nro de check}} y, en {{Datos del check}}, {{Fecha de emisión}} y {{Fecha de cobro}} (obligatoria), más {{Banco}}, {{Firmante}} y {{CUIT firmante}} si los tenés.",
              ],
            },
            "Si el cliente te retuvo impuestos, cargalos en {{Retenciones / Percepciones}} (ver [[#cargar-retenciones]]).",
            {
              text: "Elegí la {{Imputación}}:",
              substeps: [
                "{{Automática (los más viejos primero)}}: no hay que hacer nada más.",
                "{{Elegir comprobantes}}: en {{Imputar a comprobantes}} tildá cada comprobante (o cheque rechazado); se propone lo que {{Adeudado}} y podés cambiar el importe en {{Imputar}}.",
                "{{A cuenta (imputar después)}}.",
              ],
            },
            "Revisá la franja de totales ({{Pago real}}, {{Retenciones}}, {{Total}}, {{Imputado}}, {{A cuenta}}), agregá {{Notas}} si querés y hacé clic en {{Emitir recibo}}.",
          ],
          after: [
            "El aviso dice «Recibo … emitido.» con su número.",
            "Cada línea de pago genera un ingreso en la cuenta elegida ([[/transactions]]). Una línea en cartera de cheques da de alta el cheque en [[/checks]], en cartera.",
            "En Ventas se registra el asiento contable del cobro (un recibo interno no genera asiento). Los comprobantes imputados bajan su saldo en la cuenta corriente y el aging; si quedan en cero figuran como {{Pagada}}.",
          ],
          errors: [
            {
              message: "Seleccioná un cliente.",
              fix: "Elegí el cliente.",
            },
            {
              message: "Cada línea de pago necesita una cuenta.",
              fix: "Elegí la cuenta de cada línea.",
            },
            {
              message: "Cada línea de pago necesita un monto mayor a cero.",
              fix: "Completá el monto o quitá la línea.",
            },
            {
              message: "Para pagos con check necesitamos la fecha de cobro.",
              fix: "Completá la «Fecha de cobro» del cheque.",
            },
            {
              message:
                "Un cobro en una cartera de cheques necesita su cheque: número, banco y fecha de pago",
              fix: "Completá el número, el banco y la fecha de cobro del cheque.",
            },
            {
              message: "Elegí al menos un comprobante, o cobrá a cuenta.",
              fix: "Tildá un comprobante o cambiá la imputación a «A cuenta (imputar después)».",
            },
            {
              message:
                "La imputación (…) excede el saldo pendiente del comprobante (…).",
              fix: "Bajá el importe a imputar a lo que el comprobante debe.",
            },
            {
              message: "Las imputaciones (…) superan el total del recibo (…).",
              fix: "Imputá como máximo el total del recibo.",
            },
            {
              message:
                "Un comprobante imputado está en otra moneda que el recibo: un recibo solo cancela comprobantes de su misma moneda.",
              fix: "Hacé un recibo en la moneda del comprobante.",
            },
            {
              message:
                "Cargá la cotización del dólar (tiene que ser mayor a 1).",
              fix: "Escribí la cotización del día.",
            },
            {
              message: "El número … ya existe para ese canal/POS.",
              fix: "Otro usuario emitió un recibo al mismo tiempo: volvé a abrir el formulario para tomar el número siguiente.",
            },
            {
              message: "Configurá un POS habilitado para este canal.",
              fix: "Configurá un punto de venta para el canal en [[/admin/afip/puntos-de-venta]].",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto o pedí que lo reabran ([[#reabrir-periodo]]).",
            },
            {
              message: "No tenés permiso para cargar o editar retenciones.",
              fix: "Quitá las retenciones o pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
            {
              message: "No tenés permiso para emitir recibos.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: [
            "cargar-retenciones",
            "imputar-recibo",
            "editar-recibo",
            "cobrar-comprobante",
          ],
          keywords: [
            "cobrar",
            "cobranza",
            "recibo",
            "pago de cliente",
            "cheque recibido",
            "transferencia",
          ],
        },
        {
          id: "cargar-retenciones",
          title: "Cargar retenciones o percepciones en un recibo",
          permission: ["receipts:write", "retentions:write"],
          steps: [
            "En el formulario del recibo, en {{Retenciones / Percepciones}}, hacé clic en {{Agregar}}.",
            {
              text: "Completá:",
              substeps: [
                "{{Tipo}}: {{Retención}} o {{Percepción}}.",
                "{{Impuesto}}: {{Ganancias}}, {{IVA}}, {{IIBB}}, {{SUSS}} u {{Otros}}. Con IIBB aparece {{Jurisdicción}}.",
                "{{Nro. de certificado}} (obligatorio), {{Fecha cert.}} y {{Monto}}.",
                "{{Observaciones}} si hace falta.",
              ],
            },
            "{{Quitar retención}} la saca. Emití o guardá el recibo como siempre.",
          ],
          after: [
            "El monto suma al {{Total}} del recibo y cancela deuda del cliente, pero no entra a ninguna cuenta. Figura en el detalle del recibo con su certificado.",
            "En Otras ventas el editor no aparece: un recibo interno no lleva retenciones.",
          ],
          errors: [
            {
              message: "Cada retención necesita un número de certificado.",
              fix: "Completá el número del certificado.",
            },
            {
              message: "Cada retención necesita un monto mayor a cero.",
              fix: "Completá el monto o quitá la retención.",
            },
            {
              message: "No tenés permiso para cargar o editar retenciones.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["emitir-recibo"],
          keywords: [
            "retención de ganancias",
            "retención IIBB",
            "percepción",
            "certificado",
            "SICORE",
          ],
        },
        {
          id: "editar-recibo",
          title: "Editar un recibo",
          permission: ["receipts:write", "accounts:read"],
          prerequisites: ["Un recibo {{Emitido}} (no anulado)."],
          steps: [
            "En [[/receipts]], en la fila del recibo, hacé clic en el lápiz ({{Editar}}).",
            "Cambiá la {{Fecha}}, las {{Líneas de pago}}, las retenciones, las imputaciones en {{Imputar a comprobantes}} o las {{Notas}}. El canal, el número y la moneda no se cambian.",
            "Hacé clic en {{Guardar cambios}}.",
          ],
          after: [
            "El aviso dice «Recibo actualizado.» Se rehacen sus movimientos de caja, su asiento y sus imputaciones con los datos nuevos.",
            "Sin permiso de retenciones, las retenciones guardadas se conservan como están y no se pueden tocar.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar recibos.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
            {
              message: "No tenés permiso para cargar o editar retenciones.",
              fix: "Dejá las retenciones como estaban.",
            },
            {
              message:
                "La imputación (…) excede el saldo pendiente del comprobante (…).",
              fix: "Bajá el importe imputado.",
            },
          ],
          related: ["emitir-recibo", "anular-recibo"],
          keywords: ["modificar recibo", "corregir cobro"],
        },
        {
          id: "imputar-recibo",
          title: "Imputar el saldo a cuenta de un recibo",
          summary:
            "Aplica lo que un recibo dejó a cuenta a comprobantes pendientes, sin tocar sus líneas de pago.",
          permission: "receipts:write",
          screens: [
            {
              kind: "dialog",
              caption: "Recibos › Imputar saldo a cuenta",
              title: "~Imputar recibo 0001-00000045",
              description:
                "Aplica lo que el recibo tiene a cuenta a comprobantes pendientes del cliente. No cambia las líneas de pago ni los movimientos.",
              fields: [
                {
                  label: "Imputación",
                  kind: "select",
                  value: "Automática (los más viejos primero)",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Imputar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/receipts]], en la fila del recibo, hacé clic en {{Imputar saldo a cuenta}}. Arriba se ve el saldo a cuenta.",
            "Elegí {{Automática (los más viejos primero)}} o {{Elegir comprobantes}} (y tildá los comprobantes con su importe).",
            "Hacé clic en {{Imputar}}.",
          ],
          after: [
            "El aviso dice cuánto se imputó. Los comprobantes bajan su saldo; el recibo baja su {{A cuenta}}.",
            "Un cheque rechazado no se cancela desde acá: se imputa editando el recibo.",
          ],
          errors: [
            {
              message: "El recibo no tiene saldo a cuenta.",
              fix: "Ya está todo imputado.",
            },
            {
              message: "Elegí al menos un comprobante.",
              fix: "Tildá un comprobante o usá «Automática (los más viejos primero)».",
            },
            {
              message:
                "El cliente no tiene comprobantes pendientes en este canal y moneda.",
              fix: "No hay nada para imputar todavía: dejalo a cuenta.",
            },
            {
              message:
                "Un cheque rechazado se cancela editando el recibo, no desde Imputar.",
              fix: "Usá [[#editar-recibo]].",
            },
            {
              message: "La imputación excede el saldo a cuenta del recibo (…)",
              fix: "Imputá como máximo el saldo a cuenta.",
            },
          ],
          related: ["emitir-recibo"],
          keywords: ["aplicar pago", "pago a cuenta", "imputar"],
        },
        {
          id: "anular-recibo",
          title: "Anular un recibo",
          permission: "receipts:write",
          screens: [
            {
              kind: "dialog",
              title: "~Anular recibo 0001-00000045",
              description:
                "El recibo queda como anulado pero conserva el número en el correlativo. Esta acción no se puede deshacer.",
              footer: [
                { label: "Volver", variant: "ghost" },
                { label: "Anular recibo", variant: "destructive", marker: 2 },
              ],
            },
          ],
          steps: [
            "En [[/receipts]], en la fila del recibo, hacé clic en {{Anular}}.",
            "Confirmá con {{Anular recibo}}.",
          ],
          after: [
            "Queda {{Anulado}} (tachado en la lista) y conserva su número. Se borran sus ingresos de caja, se revierte su asiento y los comprobantes que cobraba vuelven a quedar pendientes.",
          ],
          errors: [
            {
              message:
                "El recibo ya estaba anulado o no se encontró. Recargá la página.",
              fix: "Recargá la página.",
            },
            {
              message:
                "Este recibo salda el faltante de una rendición a cargo del chofer: se anula quitando la diferencia de la rendición.",
              fix: "Quitá la diferencia desde la rendición del chofer.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Pedí que reabran el período ([[#reabrir-periodo]]).",
            },
            {
              message: "No tenés permiso para anular recibos.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["editar-recibo"],
          keywords: ["anular cobro", "borrar recibo"],
        },
        {
          id: "descargar-enviar-recibo",
          title: "Descargar o enviar un recibo por email",
          permission: "receipts:read",
          steps: [
            "En [[/receipts]], en la fila del recibo, hacé clic en el ojo ({{Ver recibo}}). En el detalle, el botón {{PDF}} lo abre en otra pestaña; desde ahí lo imprimís o lo bajás.",
            "Para mandarlo, hacé clic en el sobre ({{Enviar por email}}; pide el permiso `email:send` y el recibo no tiene que estar anulado), revisá {{Destinatario}}, {{Asunto}} y {{Mensaje (opcional)}} y hacé clic en {{Enviar}}.",
          ],
          errors: [
            {
              message: "Solo se pueden enviar recibos emitidos.",
              fix: "Un recibo anulado no se envía.",
            },
            {
              message: "No tenés permiso para enviar emails.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          keywords: ["imprimir recibo", "mandar recibo"],
        },
        {
          id: "exportar-recibos",
          title: "Buscar y exportar recibos",
          permission: "receipts:read",
          steps: [
            "En [[/receipts]], filtrá con {{Buscar por cliente o número}}, el período y {{Cualquier estado}} ({{Emitido}} o {{Anulado}}).",
            "Para exportar, hacé clic en {{Exportar}}, elegí {{PDF}} o {{Excel}} y el rango ({{Descargar período}}) o {{Todo el historial}}.",
          ],
          keywords: ["listado de cobranzas", "excel de recibos"],
        },
        {
          id: "adjuntar-archivo-recibo",
          title: "Adjuntar el comprobante de pago a un recibo",
          permission: attachmentPermission("receipt"),
          steps: [
            "Abrí el detalle del recibo ({{Ver recibo}}).",
            "En {{Adjuntos}}, elegí el {{Tipo:}} ({{Comprobante}}, {{Comprobante de pago}} u {{Otro}}) y arrastrá el archivo a {{Arrastrá un archivo o elegí desde el dispositivo}}.",
          ],
          keywords: ["comprobante de transferencia", "foto del pago"],
        },
      ],
    },

    // ── Aging ──────────────────────────────────────────────────────────────
    {
      id: "aging-clientes",
      title: "Aging de clientes",
      menuPath: "Ventas › Aging clientes / Otras ventas › Aging clientes",
      routes: ["/aging"],
      permission: ["clients:read", "invoices:read", "receipts:read"],
      intro: [
        "Lo que deben los clientes del lado elegido, por antigüedad. Arriba hay un recuadro por tramo ({{0–30 días}}, {{30–60 días}}, {{60–90 días}}, {{90+ días}}) y el {{Total deudor}}, con la cantidad de clientes y documentos.",
        "La tabla tiene una fila por cliente con deuda: {{Cliente}} (enlace a su ficha), los cuatro tramos, {{Total}}, {{A cuenta}} (lo que pagó y no está imputado) y {{Documentos}}. Los clientes con más deuda van primero.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Ventas › Aging clientes",
          title: "Aging de clientes",
          actions: [
            { label: "Intereses por mora", variant: "outline" },
            { label: "Exportar", variant: "outline" },
          ],
          stats: [
            { label: "0–30 días", value: "$3.100.000,00" },
            { label: "30–60 días", value: "$820.000,00" },
            { label: "60–90 días", value: "$0,00" },
            { label: "90+ días", value: "$150.000,00" },
            { label: "Total deudor", value: "$4.070.000,00" },
          ],
          table: {
            columns: [
              "Cliente",
              "0–30 días",
              "30–60",
              "60–90",
              "90+",
              "Total",
              "A cuenta",
              "Documentos",
            ],
            rows: [
              [
                "~Transportes del Sur S.A.",
                "~$1.250.000,00",
                "~$820.000,00",
                "",
                "",
                "~$2.070.000,00",
                "",
                "~3",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Qué cuenta y cómo",
          body: [
            "Solo facturas y notas de débito emitidas con saldo abierto, y cheques rechazados del cliente. Las imputaciones de recibos y las notas de crédito descuentan solas.",
            "Una factura o nota de débito de venta vence **7 días después de su fecha**, salvo que traiga un «Vto. pago» posterior. Los días se cuentan desde ese vencimiento hasta hoy. El detalle y el PDF siguen mostrando el «Vto. pago» que informó AFIP.",
            "Si hay deuda en dólares, cada importe se muestra en pesos y en dólares, y el total se consolida en pesos con la última cotización oficial cargada (si no hay, lo avisa).",
            "Se actualiza solo cuando se emite un comprobante o un recibo.",
          ],
        },
      ],
      tasks: [
        {
          id: "exportar-aging",
          title: "Exportar el aging",
          permission: ["clients:read", "invoices:read", "receipts:read"],
          steps: [
            "En [[/aging]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}} y hacé clic en {{Descargar período}} o {{Todo el historial}}.",
          ],
          after: [
            "El aging es una foto de hoy: el rango de fechas no lo cambia. Exporta el lado en que estás.",
          ],
          keywords: ["deudores", "cuentas a cobrar", "antigüedad de saldos"],
        },
      ],
    },

    // ── Intereses por mora ─────────────────────────────────────────────────
    {
      id: "intereses-por-mora",
      title: "Intereses por mora",
      menuPath: "Ventas › Aging clientes › Intereses por mora",
      routes: ["/aging/mora"],
      permission: "invoices:read",
      intro: [
        "Se abre con {{Intereses por mora}} desde el aging. Lista las facturas y notas de débito vencidas con saldo abierto (vencen 7 días después de su fecha, salvo un «Vto. pago» posterior; ver [[#aging-clientes]]) y el interés que cobraría su próxima nota de débito hasta la fecha de {{Calcular hasta}} (hoy por defecto; no admite fechas futuras).",
        "Columnas: {{Cliente}}, {{Comprobante}}, {{Vencimiento}}, {{Saldo}}, {{Cobrado hasta}} (último día ya cobrado por una nota vigente), {{Días}}, {{Tasa mensual}} (la del cliente, o la general marcada «(general)»; {{Sin tasa}} si no hay ninguna) e {{Interés}}.",
        "Nada se cobra solo: cada nota de débito se genera a mano.",
      ],
      concepts: [
        {
          title: "Cómo se calcula",
          body: [
            "Interés simple sobre el saldo de cada día, a la tasa mensual dividida 30 por día, desde el día siguiente al vencimiento (o al último día ya cobrado) hasta la fecha elegida, ambos inclusive. Un pago en el medio baja el saldo desde su fecha.",
            "Un período cobrado no se vuelve a cobrar mientras su nota de débito esté vigente.",
            "En Ventas la nota de débito lleva IVA 21% y se emite con CAE; en Otras ventas es una nota de débito interna, sin IVA.",
          ],
        },
      ],
      tasks: [
        {
          id: "definir-tasa-mora-general",
          title: "Definir la tasa general de mora",
          permission: "credit_debit_notes:issue",
          steps: [
            "En [[/aging/mora]], al lado de «Tasa general», hacé clic en {{Cambiar}}.",
            "En {{Tasa mensual (%)}}, escribí el porcentaje mensual (por ejemplo `3`), entre 0 y 100.",
            "Hacé clic en {{Guardar}}. {{Quitar tasa}} la deja sin definir.",
          ],
          after: ["Se aplica a todos los clientes que no tienen tasa propia."],
          errors: [
            {
              message: "Ingresá una tasa mensual entre 0 y 100.",
              fix: "Escribí un número entre 0 y 100.",
            },
            {
              message:
                "No tenés permiso para cambiar la tasa de interés por mora.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["definir-tasa-mora-cliente"],
          keywords: ["tasa de interés", "punitorio", "recargo por mora"],
        },
        {
          id: "definir-tasa-mora-cliente",
          title: "Definir la tasa de mora de un cliente",
          permission: "clients:write",
          steps: [
            "En [[/aging/mora]], en la fila de un comprobante del cliente, abrí el menú ⋯ ({{Acciones}}) y elegí {{Tasa del cliente}}.",
            "Escribí la {{Tasa mensual (%)}} y hacé clic en {{Guardar}}. {{Usar la general}} le quita la tasa propia.",
          ],
          after: ["El aviso dice «Tasa guardada.» y el interés se recalcula."],
          errors: [
            {
              message: "Ingresá una tasa mensual entre 0 y 100.",
              fix: "Escribí un número entre 0 y 100.",
            },
            {
              message: "No tenés permiso para editar clientes.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["definir-tasa-mora-general"],
          keywords: ["tasa especial", "tasa por cliente"],
        },
        {
          id: "generar-nd-mora",
          title: "Generar la nota de débito por mora de un comprobante",
          permission: ["invoices:issue", "credit_debit_notes:issue"],
          screens: [
            {
              kind: "menu",
              caption: "Intereses por mora › menú de la fila",
              trigger: "⋯",
              items: [
                { label: "Generar ND", marker: 2 },
                { label: "Tasa del cliente" },
              ],
            },
            {
              kind: "dialog",
              title: "Generar nota de débito por mora",
              description:
                "Interés simple sobre el saldo abierto, a la tasa mensual prorrateada por día. El período queda cobrado: no se vuelve a cobrar mientras la nota esté vigente. Lleva IVA 21%.",
              fields: [
                {
                  label: "Tasa mensual (%)",
                  kind: "input",
                  value: "3",
                  marker: 3,
                },
                {
                  label: "Punto de venta",
                  kind: "select",
                  value: "0003",
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Generar ND", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/aging/mora]], elegí la fecha en {{Calcular hasta}}.",
            "En la fila del comprobante, abrí el menú ⋯ y elegí {{Generar ND}} (deshabilitado si no hay días para cobrar).",
            "Revisá el período y el {{Interés (neto)}}. Podés cambiar la {{Tasa mensual (%)}} solo para esta nota. El {{Punto de venta}} viene elegido: es el único habilitado del canal del comprobante.",
            "Hacé clic en {{Generar ND}}.",
          ],
          after: [
            "El aviso dice «Nota de débito por intereses creada.» Se emite una nota de débito con fecha de hoy, motivo «Intereses por mora» y un ítem que detalla el comprobante, el período, los días y la tasa. En Ventas pide el CAE como cualquier nota.",
            "El período queda cobrado: la fila pasa a mostrar {{Cobrado hasta}} con esa fecha.",
          ],
          errors: [
            {
              message: "Ingresá una tasa mayor a 0.",
              fix: "Escribí la tasa.",
            },
            {
              message: "Ya se cobraron los intereses hasta esa fecha.",
              fix: "Elegí una fecha posterior en «Calcular hasta».",
            },
            {
              message:
                "El interés cambió desde la propuesta (cambió el saldo o lo ya cobrado). Volvé a generarla para ver el importe actual.",
              fix: "Cerrá el diálogo y volvé a abrir «Generar ND».",
            },
            {
              message:
                "El comprobante no está vencido o no tiene saldo abierto.",
              fix: "Ya se cobró: recargá la página.",
            },
            {
              message:
                "Falta la cotización del dólar de hoy para la nota en dólares. Cargala en Contabilidad › Cotización USD.",
              fix: "Cargá la cotización en [[/accounting/exchange-rates]].",
            },
            {
              message: "No tenés permiso para emitir notas de débito.",
              fix: "Pedíselo a alguien con rol Finanzas, Admin u Owner.",
            },
          ],
          related: ["generar-varias-nd-mora", "emitir-nota-de-debito"],
          keywords: ["cobrar intereses", "mora", "punitorios", "ND por mora"],
        },
        {
          id: "generar-varias-nd-mora",
          title: "Generar varias notas de débito por mora a la vez",
          permission: ["invoices:issue", "credit_debit_notes:issue"],
          steps: [
            "En [[/aging/mora]], elegí la fecha en {{Calcular hasta}} y hacé clic en {{Generar varias ND}} (se habilita si hay filas con días, tasa e interés).",
            "Tildá o destildá los comprobantes: hasta 50 por vez. Al pie se ven los seleccionados y el total de intereses.",
            "Hacé clic en {{Emitir}}.",
          ],
          after: [
            "Se emite una nota de débito por comprobante, a la tasa del cliente o la general y en el punto de venta del comprobante. Si una falla, las demás siguen: la lista muestra «ND emitida.» o el motivo de cada una. {{Listo}} cierra.",
            "Para cambiar la tasa de uno, usá [[#generar-nd-mora]] en su fila.",
          ],
          errors: [
            {
              message: "Se emitieron … de …: revisá las que fallaron.",
              fix: "Leé el motivo de cada una en la lista y generalas de a una.",
            },
          ],
          related: ["generar-nd-mora"],
          keywords: ["intereses masivos", "ND en lote"],
        },
      ],
    },
  ],
};
